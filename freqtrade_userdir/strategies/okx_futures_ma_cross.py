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
        Set OKX account leverage BEFORE the first trade.

        OKX stores leverage at the account level per instrument (SWAP).
        ccxt's create_order does NOT call /account/set-leverage on our behalf;
        if the account default is 1x, every order we place will be 1x even
        though our leverage() callback returns the right value.  We fix that
        here by poking OKX's set-leverage API once per whitelisted pair.
        """
        if self.dp is None:
            return
        ex = self.dp.exchange
        if ex is None:
            return
        if getattr(ex, 'id', '') != 'okx':
            return

        target = int(self.max_leverage)
        logger.info('[OkxFuturesMaCross] Setting OKX leverage to %dx for all USDT-SWAP markets', target)

        # ccxt market.id for OKX USDT perpetual = e.g. "BTC-USDT-SWAP"
        swap_ids = []
        try:
            for m in (ex.markets or {}).values():
                if not isinstance(m, dict):
                    continue
                ccxt_id = m.get('id')
                if isinstance(ccxt_id, str) and ccxt_id.endswith('-USDT-SWAP'):
                    swap_ids.append(ccxt_id)
        except Exception as e:
            logger.warning('[OkxFuturesMaCross] Failed to enumerate OKX markets: %s', e)
            return

        if not swap_ids:
            logger.warning('[OkxFuturesMaCross] No USDT-SWAP markets found, skipping leverage setup')
            return

        # OKX limits set-leverage calls — do the whole list once per bot start.
        # We are setting isolated-margin leverage; OKX SWAP supports both
        # isolated and cross, we trade isolated.
        for inst_id in swap_ids:
            try:
                ex.set_leverage(target, inst_id, params={'mgnMode': 'isolated'})
                logger.info('[OkxFuturesMaCross] Leverage set to %dx for %s', target, inst_id)
            except Exception as e:
                code = getattr(e, 'code', '')
                # 51004 = leverage already at target; 51006 = invalid instId.
                logger.warning('[OkxFuturesMaCross] set_leverage(%dx, %s) [%s]: %s', target, inst_id, code, e)

        logger.info('[OkxFuturesMaCross] OKX leverage setup complete (%d markets)', len(swap_ids))
