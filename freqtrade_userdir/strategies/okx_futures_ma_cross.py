from datetime import datetime
from typing import Optional

import talib.abstract as ta
from pandas import DataFrame

import freqtrade.vendor.qtpylib.indicators as qtpylib
from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy, stoploss_from_absolute

from futures_risk import calculate_position_plan


class OkxFuturesMaCross(IStrategy):
    """Dry-run-first MA/ADX strategy for isolated USDT perpetual futures."""

    INTERFACE_VERSION = 3
    can_short = True
    timeframe = '1h'
    process_only_new_candles = True
    startup_candle_count = 50

    # The stop is tightened dynamically from ATR.  This remains a final
    # fallback if indicator data is temporarily unavailable.
    stoploss = -0.04
    use_custom_stoploss = True
    minimal_roi = {'0': 0.04}
    trailing_stop = False

    risk_fraction = 0.005
    max_notional_per_trade = 2500.0
    max_leverage = 2.0
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
        volume = dataframe['volume'] > 0
        dataframe.loc[qtpylib.crossed_below(dataframe['ma_fast'], dataframe['ma_slow']) & volume, 'exit_long'] = 1
        dataframe.loc[qtpylib.crossed_above(dataframe['ma_fast'], dataframe['ma_slow']) & volume, 'exit_short'] = 1
        return dataframe

    def leverage(
        self, pair: str, current_time: datetime, current_rate: float,
        proposed_leverage: float, max_leverage: float, entry_tag: Optional[str],
        side: str, **kwargs,
    ) -> float:
        return min(self.max_leverage, max_leverage)

    def custom_stake_amount(
        self, pair: str, current_time: datetime, current_rate: float,
        proposed_stake: float, min_stake: Optional[float], max_stake: float,
        leverage: float, entry_tag: Optional[str], side: str, **kwargs,
    ) -> float:
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        if dataframe.empty or not dataframe.iloc[-1]['atr']:
            return min(proposed_stake, max_stake)

        atr = float(dataframe.iloc[-1]['atr'])
        stop_distance = max(atr * self.atr_stop_multiple, current_rate * 0.01)
        stop_price = current_rate - stop_distance if side == 'long' else current_rate + stop_distance
        equity = self.wallets.get_total_stake_amount()
        plan = calculate_position_plan(
            equity=equity,
            risk_fraction=self.risk_fraction,
            entry_price=current_rate,
            stop_price=stop_price,
            leverage=leverage,
            max_notional=self.max_notional_per_trade,
            available_margin=max_stake,
        )
        return max(min_stake or 0, min(plan.margin, max_stake))

    def custom_stoploss(
        self, pair: str, trade: Trade, current_time: datetime, current_rate: float,
        current_profit: float, after_fill: bool, **kwargs,
    ) -> Optional[float]:
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        if dataframe.empty or not dataframe.iloc[-1]['atr']:
            return None
        distance = max(float(dataframe.iloc[-1]['atr']) * self.atr_stop_multiple, current_rate * 0.01)
        stop_price = current_rate - distance if not trade.is_short else current_rate + distance
        return stoploss_from_absolute(stop_price, current_rate, is_short=trade.is_short, leverage=trade.leverage)
