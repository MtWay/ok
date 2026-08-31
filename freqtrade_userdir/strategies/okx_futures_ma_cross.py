from datetime import datetime
from typing import Optional

import talib.abstract as ta
from pandas import DataFrame

import freqtrade.vendor.qtpylib.indicators as qtpylib
from freqtrade.strategy import IStrategy


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
    max_leverage = 20.0
    fallback_leverage = 10.0
    atr_stop_multiple = 2.0

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
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        common = (dataframe['adx'] > 20) & (dataframe['volume'] > 0)
        dataframe.loc[qtpylib.crossed_above(dataframe['ma_fast'], dataframe['ma_slow']) & common, 'enter_long'] = 1
        dataframe.loc[qtpylib.crossed_below(dataframe['ma_fast'], dataframe['ma_slow']) & common, 'enter_short'] = 1
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
