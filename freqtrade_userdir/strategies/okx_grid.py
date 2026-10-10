"""Self-contained OKX USDT-perp grid strategy for freqtrade.

Architecture: notify-service stays the brain — it scans pairs and writes
grid signals to ``userdir/grid_signals.json``; this strategy is the executor:

- entry: flat pair with an active signal, current candle touches a grid line
- pyramid: ``adjust_trade_position`` adds one layer per touched lower level
  (freqtrade merges them into the single allowed per-pair position)
- take profit: each layer's TP peels one layer off; the final layer exits via
  ``custom_exit`` with a LIMIT order at its TP (no market slippage)
- stop: merged-position stop at the lowest remaining fill minus stopPercent,
  implemented through ``custom_stoploss`` (market exit, like live trading)

Signal file format (notify-service writes, atomic replace)::

    {
      "signals": [
        {"id": "sig-1", "pair": "ONE/USDT:USDT",
         "leverage": 3, "layerMargin": 5,
         "gridCount": 8, "lookback": 120, "stopPercent": 2,
         "minStepPercent": 0.3,
         "createdAt": 1699999999000, "ttlMs": 7200000}
      ]
    }

If the signal file is missing, entries are BLOCKED (fail closed) — the file
is what gates live trading. For ``freqtrade backtest`` (no notify-service),
either set env ``OKX_GRID_ALLOW_ALL=1`` or write the file as
``{"allowAll": true}`` to trade every whitelisted pair with GridParams
defaults.

State (open grid plans) persists to ``userdir/grid_state.json`` so restarts
survive. Logic lives in grid_core.py and is unit-tested offline.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime
from typing import Optional

import pandas as pd

from freqtrade.strategy import IStrategy

import grid_core
from grid_core import GridParams, GridPlan, GridLevel

logger = logging.getLogger(__name__)

USERDIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIGNAL_FILE = os.path.join(USERDIR, 'grid_signals.json')
STATE_FILE = os.path.join(USERDIR, 'grid_state.json')

#: A plan whose heartbeat is older than this is treated as orphaned (the
#: trade closed without us noticing, e.g. after a restart) and gets cleared.
PLAN_STALE_MS = 10 * 60 * 1000


class OkxGrid(IStrategy):
    """Grid executor. All decisions come from grid_core + the signal file."""

    INTERFACE_VERSION = 3
    can_short = False
    timeframe = '1h'
    # Grid reacts to intra-candle touches on the still-forming candle,
    # matching how the notify-service scanner sees the market.
    process_only_new_candles = False
    position_adjustment_enable = True
    startup_candle_count = 300

    stoploss = -0.99
    use_custom_stoploss = True
    minimal_roi = {}

    def __init__(self, config: dict) -> None:
        super().__init__(config)
        self._dfs: dict = {}
        self._signals: Optional[dict] = None
        self._signals_mtime: float = 0.0
        self._plans: Optional[dict] = None
        self._indicator_cache: dict = {}

    # ------------------------------------------------------------ files ----

    def _load_signals(self) -> dict:
        """pair -> signal dict. Missing file means 'allow all with defaults'
        (backtest mode); a parse error means 'allow none' (fail closed)."""
        try:
            mtime = os.path.getmtime(SIGNAL_FILE)
        except OSError:
            self._signals = {}
            self._signals_mtime = -1.0
            return self._signals
        if self._signals is not None and mtime == self._signals_mtime:
            return self._signals
        try:
            with open(SIGNAL_FILE, 'r', encoding='utf-8') as fh:
                raw = json.load(fh)
            signals = {}
            for s in raw.get('signals', []):
                signals[s['pair']] = s
            self._signals = signals
            self._signals_mtime = mtime
        except (ValueError, KeyError, OSError) as exc:
            logger.error('Grid: signal file unreadable (%s) — blocking entries', exc)
            self._signals = {}
        return self._signals

    def _signal_active(self, pair: str) -> Optional[dict]:
        signals = self._load_signals()
        sig = signals.get(pair)
        if sig is None:
            # 实盘 fail-closed：没有信号文件就不允许开新仓。
            # 仅回测/全品种扫描模式显式放开（见模块 docstring）。
            if self._allow_all_pairs():
                return {}
            return None
        now_ms = int(time.time() * 1000)
        if now_ms - int(sig.get('createdAt', 0)) > int(sig.get('ttlMs', 0)):
            return None
        return sig

    @staticmethod
    def _allow_all_pairs() -> bool:
        try:
            with open(SIGNAL_FILE, 'r', encoding='utf-8') as fh:
                return bool(json.load(fh).get('allowAll'))
        except (ValueError, KeyError, OSError):
            return os.environ.get('OKX_GRID_ALLOW_ALL') == '1'

    def _load_plans(self) -> dict:
        if self._plans is not None:
            return self._plans
        plans = {}
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as fh:
                raw = json.load(fh)
            for pair, d in raw.items():
                plans[pair] = GridPlan.from_dict(d)
        except (ValueError, KeyError, OSError):
            plans = {}
        self._plans = plans
        return plans

    def _save_plans(self) -> None:
        if self._plans is None:
            return
        tmp = STATE_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump({p: plan.to_dict() for p, plan in self._plans.items()}, fh)
        os.replace(tmp, STATE_FILE)

    # ------------------------------------------------------------ hooks ----

    def _grid_owns(self, pair: str) -> bool:
        """该品种是否由网格接管（有活跃信号或存在网格计划）。"""
        return self._signal_active(pair) is not None or pair in self._load_plans()

    def populate_indicators(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # process_only_new_candles=False 时每 5 秒就会调进来一次：同一根
        # K 线内直接返回上次结果，避免对 30+ 品种反复跑 TA（合并进主
        # bot 后与 MA 策略共用此路径）。
        pair = metadata['pair']
        self._dfs[pair] = dataframe
        key = dataframe.iloc[-1]['date'] if len(dataframe) else None
        cached = self._indicator_cache.get(pair)
        if cached is not None and cached[0] == key:
            return cached[1]
        parent = getattr(super(), 'populate_indicators', None)
        result = parent(dataframe, metadata) if parent else dataframe
        self._indicator_cache[pair] = (key, result)
        return result

    def populate_entry_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        pair = metadata['pair']
        if not self._grid_owns(pair):
            # 非网格品种交给父策略（MA 为 forceenter-only，不发入场信号）
            parent = getattr(super(), 'populate_entry_trend', None)
            return parent(dataframe, metadata) if parent else dataframe
        dataframe['enter_long'] = 0
        sig = self._signal_active(pair)
        if sig is None:
            return dataframe
        plans = self._load_plans()
        plan = plans.get(pair)
        now_ms = int(time.time() * 1000)
        if plan is not None:
            if now_ms - plan.last_seen_ms < PLAN_STALE_MS:
                return dataframe  # grid still running for this pair
            # stale: trade closed without a callback (restart) — clean up
            plans.pop(pair, None)
            self._save_plans()
        candles = self._df_to_candles(dataframe)
        params = self._params_from_signal(sig)
        hit = grid_core.detect_entry(candles, params)
        if hit:
            # freqtrade opens the position; adjust_trade_position picks the
            # detection up and records it as the first layer.
            self._detections = getattr(self, '_detections', {})
            self._detections.setdefault(pair, []).append(hit)
            dataframe.loc[dataframe.index[-1], 'enter_long'] = 1
            logger.info('Grid: entry signal %s L%d @ %.8f (tp %.8f)',
                        pair, hit['level'], hit['fill'], hit['tp'])
        return dataframe

    def leverage(self, pair: str, current_time: datetime, current_rate: float,
                 proposed_leverage: float, max_leverage: float,
                 entry_tag: Optional[str], side: str, **kwargs) -> float:
        sig = self._signal_active(pair)
        if sig is None:
            # 非网格品种交给父策略（MA 的杠杆逻辑）
            parent = getattr(super(), 'leverage', None)
            if parent:
                return parent(pair, current_time, current_rate, proposed_leverage,
                              max_leverage, entry_tag, side, **kwargs)
            return max(1.0, min(proposed_leverage or 3, max_leverage))
        lev = float(sig.get('leverage', 3))
        return max(1.0, min(lev, max_leverage))

    def custom_stake_amount(self, pair: str, current_time: datetime, current_rate: float,
                            proposed_stake: float, min_stake: Optional[float],
                            max_stake: float, leverage: float, entry_tag: Optional[str],
                            side: str, **kwargs) -> float:
        sig = self._signal_active(pair)
        if sig is None or not sig:
            # 非网格品种交给父策略（MA 的仓位逻辑）
            parent = getattr(super(), 'custom_stake_amount', None)
            if parent:
                return parent(pair, current_time, current_rate, proposed_stake,
                              min_stake, max_stake, leverage, entry_tag, side, **kwargs)
            return proposed_stake
        margin = float(sig.get('layerMargin', 0))
        if margin > 0:
            return max(min_stake or 0, min(margin, max_stake))
        return proposed_stake

    def adjust_trade_position(self, trade, current_time: datetime, current_rate: float,
                              current_profit: float, min_stake: Optional[float],
                              max_stake: float, **kwargs) -> Optional[float]:
        pair = trade.pair
        if not self._grid_owns(pair):
            return None
        plan = self._ensure_plan(trade, current_rate)
        if plan is None:
            return None
        self._reconcile_orders(trade, plan)
        self._heartbeat(plan, trade)

        dataframe = self._dfs.get(pair)
        if dataframe is None or len(dataframe) < 3:
            return None
        candles = self._df_to_candles(dataframe)
        last_high = candles[-1][3]

        # 1) peel the lowest-TP layer when touched (market reduce).
        #    The FINAL layer is handled by custom_exit with a limit order,
        #    so it never goes through this market path.
        if len(plan.levels) > 1:
            layer = grid_core.layer_tp_hit(plan, last_high)
            if layer is not None:
                stake = self._one_layer_stake(trade, plan)
                logger.info('Grid: %s layer TP hit (L%d tp %.8f) — reduce %.2f',
                            pair, layer.level, layer.tp, stake)
                return -stake

        # 2) add one layer on the next touched grid line
        if len(plan.levels) < plan.params.grid_count:
            hit = grid_core.detect_add(candles, plan)
            if hit is not None:
                self._detections.setdefault(pair, []).append(hit)
                stake = self._one_layer_stake(trade, plan)
                logger.info('Grid: %s add layer L%d @ %.8f (tp %.8f)',
                            pair, hit['level'], hit['fill'], hit['tp'])
                return stake
        return None

    def custom_exit(self, pair: str, trade, current_time: datetime,
                    current_rate: float, current_profit: float, **kwargs) -> Optional[str]:
        if not self._grid_owns(pair):
            parent = getattr(super(), 'custom_exit', None)
            return parent(pair, trade, current_time, current_rate, current_profit, **kwargs) if parent else None
        plan = self._load_plans().get(pair)
        if plan is None:
            return None
        self._reconcile_orders(trade, plan)
        self._heartbeat(plan, trade)
        if len(plan.levels) != 1:
            return None
        dataframe = self._dfs.get(pair)
        if dataframe is None or len(dataframe) < 1:
            return None
        last_high = float(dataframe.iloc[-1]['high'])
        layer = plan.last_tp_layer()
        if layer is not None and last_high >= layer.tp:
            logger.info('Grid: %s final layer TP hit — limit exit @ %.8f', pair, layer.tp)
            return 'grid_final_tp'
        return None

    def custom_exit_price(self, pair: str, trade, current_time: datetime,
                          proposed_rate: float, proposed_order_price: float,
                          current_profit: float, **kwargs) -> float:
        if self._grid_owns(pair):
            plan = self._load_plans().get(pair)
            layer = plan.last_tp_layer() if plan else None
            if layer is not None:
                return layer.tp
        parent = getattr(super(), 'custom_exit_price', None)
        if parent:
            return parent(pair, trade, current_time, proposed_rate, proposed_order_price,
                          current_profit, **kwargs)
        return proposed_order_price

    def custom_stoploss(self, pair: str, trade, current_time: datetime,
                        current_rate: float, current_profit: float, **kwargs) -> Optional[float]:
        if not self._grid_owns(pair):
            # 非网格品种回落到静态 stoploss（-0.99，退出由 plan 管线负责），
            # 与合并前 MA 策略的 use_custom_stoploss=False 行为一致
            return None
        plan = self._load_plans().get(pair)
        if plan is None:
            return None
        self._heartbeat(plan, trade)
        stop = plan.stop_price
        if stop is None:
            return None
        # relative stoploss from the current rate
        return stop / current_rate - 1.0

    # ----------------------------------------------------------- helpers ---

    def _params_from_signal(self, sig: dict) -> GridParams:
        return GridParams(
            grid_count=int(sig.get('gridCount', GridParams().grid_count)),
            lookback=int(sig.get('lookback', GridParams().lookback)),
            stop_percent=float(sig.get('stopPercent', GridParams().stop_percent)),
            min_step_percent=float(sig.get('minStepPercent', grid_core.GRID_MIN_STEP_PERCENT)),
        )

    @staticmethod
    def _df_to_candles(dataframe: pd.DataFrame) -> list:
        return [[float(r.open), float(r.close), float(r.low), float(r.high)]
                for r in dataframe.itertuples()]

    def _ensure_plan(self, trade, current_rate: float) -> Optional[GridPlan]:
        plans = self._load_plans()
        plan = plans.get(trade.pair)
        if plan is not None:
            return plan
        sig = self._signal_active(trade.pair) or {}
        plan = GridPlan(pair=trade.pair, params=self._params_from_signal(sig))
        plans[trade.pair] = plan
        return plan

    def _reconcile_orders(self, trade, plan: GridPlan) -> None:
        """Match closed entry orders against detections so each fill becomes a
        layer with its locked TP; drop TP'd layers when reduce orders fill."""
        self._detections = getattr(self, '_detections', {})
        queue = self._detections.get(trade.pair, [])
        entries = [o for o in trade.orders
                   if o.ft_order_side == 'entry' and o.status == 'closed']
        while len(entries) > len(plan.levels):
            order = entries[len(plan.levels)]
            fill = float(order.average)
            hit = queue.pop(0) if queue else None
            if hit is not None:
                level = GridLevel(level=hit['level'], level_price=hit['level_price'],
                                  fill=fill, tp=hit['tp'])
            else:
                # restart between detection and fill: synthesize from the
                # actual fill using current bounds for the step size
                candles = self._df_to_candles(self._dfs[trade.pair])
                closes = [c[1] for c in candles]
                bounds = grid_core.compute_bounds(closes, plan.params.grid_count,
                                                  plan.params.lookback)
                step = bounds.step if bounds else fill * plan.params.min_step_percent / 100
                level = GridLevel(level=0, level_price=fill, fill=fill, tp=fill + step)
                logger.warning('Grid: %s unreconciled fill @ %.8f — synthesized layer',
                               trade.pair, fill)
            plan.levels.append(level)
        exits = [o for o in trade.orders
                 if o.ft_order_side == 'exit' and o.status == 'closed']
        # reduce orders close layers lowest-TP first; the final full exit
        # removes the rest (plan gets cleaned up on the next entry signal)
        for _ in exits:
            if plan.levels:
                plan.levels.sort(key=lambda l: l.tp)
                plan.levels.pop(0)
        if queue or plan.levels:
            self._save_plans()

    def _heartbeat(self, plan: GridPlan, trade) -> None:
        plan.trade_id = trade.id
        plan.last_seen_ms = int(time.time() * 1000)
        self._save_plans()

    @staticmethod
    def _one_layer_stake(trade, plan: GridPlan) -> float:
        """Stake (margin) per layer, derived from the merged position size."""
        entries = [o for o in trade.orders
                   if o.ft_order_side == 'entry' and o.status == 'closed']
        if not entries:
            return float(trade.stake_amount)
        return float(trade.stake_amount) / len(entries)
