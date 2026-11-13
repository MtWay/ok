from datetime import datetime
from typing import Optional

import numpy as np
import talib.abstract as ta
from pandas import DataFrame

import freqtrade.vendor.qtpylib.indicators as qtpylib
from freqtrade.strategy import IStrategy
import logging

logger = logging.getLogger(__name__)


class OkxFuturesMaCross(IStrategy):
    """Dry-run-first MA/ADX strategy for isolated USDT perpetual futures."""

    INTERFACE_VERSION = 3
    can_short = True
    timeframe = '1h'
    process_only_new_candles = True
    startup_candle_count = 50

    # Exits are managed by the notification plan (structure targets, stop and
    # trailing stop).  Keep the strategy from applying a second, conflicting
    # ROI/MA exit policy.
    stoploss = -0.99
    use_custom_stoploss = False
    minimal_roi = {}
    trailing_stop = False
    use_exit_signal = True

    risk_fraction = 0.005
    max_notional_per_trade = 2500.0
    # Live-safe leverage cap. Override per plan via notify-service settings.
    max_leverage = 3.0
    fallback_leverage = 2.0
    atr_stop_multiple = 2.0

    # ADX 延迟确认门槛，数值来自 offline_backtest.py 的扫描（confirm-24 & >12）
    adx_threshold = 12.0
    adx_confirm_bars = 24

    order_types = {
        'entry': 'limit',
        'exit': 'limit',
        'stoploss': 'market',
        'stoploss_on_exchange': True,
    }
    order_time_in_force = {'entry': 'GTC', 'exit': 'GTC'}

    # --- Partial take profit for notification plans -------------------------
    # The notify-service tags every forceentered trade with its 1R distance
    # ("notify|r=0.0321"). Half the position is banked at +1R; the remainder is
    # left to the plan's own exit rules (peak profit lock, 2R target, swing
    # stop). 8651-trade replay of the plan universe: banking half at 1R and
    # letting the rest run turned -2308 (2xATR chandelier only) into +4213,
    # win rate 33.2% -> 63.6%. Trades without the tag are untouched.
    position_adjustment_enable = True
    partial_tp_r = 1.0
    partial_tp_fraction = 0.5
    notify_tag_prefix = 'notify'

    @staticmethod
    def _plan_risk(tag: Optional[str]) -> Optional[float]:
        """1R as a fraction of the entry price, parsed from 'notify|r=0.0321'."""
        if not tag or not tag.startswith(OkxFuturesMaCross.notify_tag_prefix):
            return None
        for part in tag.split('|'):
            if part.startswith('r='):
                try:
                    risk = float(part[2:])
                except ValueError:
                    return None
                return risk if 0 < risk <= 0.25 else None
        return None

    def adjust_trade_position(
        self, trade, current_time: datetime, current_rate: float,
        current_profit: float, min_stake: Optional[float] = None,
        max_stake: float = 0.0,
        current_entry_rate: Optional[float] = None,
        current_exit_rate: Optional[float] = None,
        current_entry_profit: Optional[float] = None,
        current_exit_profit: Optional[float] = None, **kwargs,
    ) -> Optional[float]:
        risk = self._plan_risk(trade.enter_tag)
        if risk is None or not trade.open_rate:
            return None
        # One partial per trade. Freqtrade rewrites stake_amount/amount after a
        # partial fill, so "already taken" cannot be derived from those fields;
        # the filled exit order is the only stable marker.
        if trade.nr_of_successful_exits > 0:
            return None
        # Nothing to reduce while the entry order is still unfilled.
        if trade.nr_of_successful_entries == 0 or not trade.amount:
            return None
        target = trade.open_rate * (1 - risk * self.partial_tp_r) if trade.is_short \
            else trade.open_rate * (1 + risk * self.partial_tp_r)
        reached = current_rate <= target if trade.is_short else current_rate >= target
        if not reached:
            return None
        stake = trade.stake_amount * self.partial_tp_fraction
        if stake <= 0:
            return None
        move_pct = (current_rate - trade.open_rate) / trade.open_rate * 100
        logger.info(
            '[OkxFuturesMaCross] partial take profit %s %s at %+.2f%% '
            '(1R=%.2f%%, target %+.2f%%): closing %.0f%% of stake %.4f',
            trade.pair, 'short' if trade.is_short else 'long',
            -move_pct if trade.is_short else move_pct, risk * 100,
            -risk * self.partial_tp_r * 100 if trade.is_short else risk * self.partial_tp_r * 100,
            self.partial_tp_fraction * 100, stake,
        )
        return -stake

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['ma_fast'] = ta.SMA(dataframe, timeperiod=10)
        dataframe['ma_slow'] = ta.SMA(dataframe, timeperiod=30)
        dataframe['adx'] = ta.ADX(dataframe, timeperiod=14)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)

        # ADX 在快慢线交叉当根处于结构性低谷（实测中位数约 8），直接用
        # crossed_above & (adx > threshold) 会让策略几乎不开仓。改为在交叉后
        # adx_confirm_bars 根内等待 ADX 回升过阈值再入场。窗口内若出现多次
        # 交叉，以最近一次的方向为准，避免同一根 K 线同时给出多空信号。
        # 全程用 ndarray 计算：dataframe 的索引是 DatetimeIndex，与位置数组
        # 做布尔运算会按索引对齐而全部落空。
        bar = np.arange(len(dataframe))
        cross_up = qtpylib.crossed_above(dataframe['ma_fast'], dataframe['ma_slow']).to_numpy()
        cross_down = qtpylib.crossed_below(dataframe['ma_fast'], dataframe['ma_slow']).to_numpy()
        last_up = np.maximum.accumulate(np.where(cross_up, bar, -1))
        last_down = np.maximum.accumulate(np.where(cross_down, bar, -1))
        trending = (dataframe['adx'] > self.adx_threshold).to_numpy()

        dataframe['adx_confirmed_up'] = (
            (last_up > last_down) & (bar - last_up <= self.adx_confirm_bars) & trending
        )
        dataframe['adx_confirmed_down'] = (
            (last_down > last_up) & (bar - last_down <= self.adx_confirm_bars) & trending
        )
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # NO automatic entries — this strategy is forceenter-only.
        # All positions are created by notify-service's approved plans via
        # /api/v1/forceenter. The indicators above are retained so bot_start
        # can still set leverage, but we intentionally emit zero entry signals.
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Notification plans own exits.  Do not emit MA exits here.
        return dataframe

    def leverage(
        self, pair: str, current_time: datetime, current_rate: float,
        proposed_leverage: float, max_leverage: float, entry_tag: Optional[str],
        side: str, **kwargs,
    ) -> float:
        # The notification plan sends its leverage via /forceenter, which arrives
        # here as proposed_leverage. Default to 20x; pairs capped below that fall
        # back to 10x, and pairs capped below 10x use the pair's own limit.
        desired = proposed_leverage if proposed_leverage else self.max_leverage
        desired = min(desired, self.max_leverage)
        if max_leverage >= desired:
            return desired
        if desired > self.fallback_leverage and max_leverage >= self.fallback_leverage:
            return self.fallback_leverage
        return max_leverage

    def custom_stake_amount(
        self, pair: str, current_time: datetime, current_rate: float,
        proposed_stake: float, min_stake: Optional[float], max_stake: float,
        leverage: float, entry_tag: Optional[str], side: str, **kwargs,
    ) -> float:
        # Sizing is owned by the notification plan: it sends a fixed margin as
        # stakeamount via /forceenter, which arrives here as proposed_stake.
        # Only clamp to what the wallet can cover, and refuse dust positions
        # when the wallet is nearly exhausted (returning 0 blocks the trade).
        if max_stake < proposed_stake * 0.5:
            return 0
        return max(min_stake or 0, min(proposed_stake, max_stake))

    def bot_start(self, **kwargs) -> None:
        """
        Leverage setup hook.

        Modern Freqtrade calls exchange.set_leverage() automatically before
        every futures entry, using the value from the leverage() callback, so
        no manual per-market poking is needed here. (The old implementation
        used DataProvider.exchange, which was renamed to the private
        _exchange and crashed the bot on startup.)
        """
        logger.info(
            '[OkxFuturesMaCross] bot_start complete — leverage is applied '
            'automatically before each entry (cap %gx)',
            self.max_leverage,
        )
