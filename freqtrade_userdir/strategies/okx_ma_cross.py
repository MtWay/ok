from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib


class OkxMaCross(IStrategy):
    INTERFACE_VERSION = 3

    minimal_roi = {
        "0": 0.1
    }

    stoploss = -0.1

    trailing_stop = False

    timeframe = '1h'

    process_only_new_candles = True

    startup_candle_count = 30

    order_types = {
        'entry': 'limit',
        'exit': 'limit',
        'stoploss': 'market',
        'stoploss_on_exchange': False
    }

    order_time_in_force = {
        'entry': 'GTC',
        'exit': 'GTC'
    }

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['ma_fast'] = ta.SMA(dataframe, timeperiod=10)
        dataframe['ma_slow'] = ta.SMA(dataframe, timeperiod=30)
        dataframe['adx'] = ta.ADX(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
                (qtpylib.crossed_above(dataframe['ma_fast'], dataframe['ma_slow'])) &
                (dataframe['adx'] > 20) &
                (dataframe['volume'] > 0)
            ),
            'enter_long'] = 1

        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
                (qtpylib.crossed_below(dataframe['ma_fast'], dataframe['ma_slow'])) &
                (dataframe['volume'] > 0)
            ),
            'exit_long'] = 1

        return dataframe
