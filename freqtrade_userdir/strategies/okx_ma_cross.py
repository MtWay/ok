from freqtrade.strategy import IStrategy
import numpy as np
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

    # ADX 延迟确认门槛，数值来自 offline_backtest.py 的扫描（confirm-24 & >12）
    adx_threshold = 12.0
    adx_confirm_bars = 24

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

        # ADX 在快慢线交叉当根处于结构性低谷（实测中位数约 8），直接用
        # crossed_above & (adx > threshold) 会让策略几乎不开仓。改为在交叉后
        # adx_confirm_bars 根内等待 ADX 回升过阈值再入场。窗口内若出现多次
        # 交叉，以最近一次的方向为准。全程用 ndarray 计算：dataframe 的索引
        # 是 DatetimeIndex，与位置数组做布尔运算会按索引对齐而全部落空。
        bar = np.arange(len(dataframe))
        cross_up = qtpylib.crossed_above(dataframe['ma_fast'], dataframe['ma_slow']).to_numpy()
        cross_down = qtpylib.crossed_below(dataframe['ma_fast'], dataframe['ma_slow']).to_numpy()
        last_up = np.maximum.accumulate(np.where(cross_up, bar, -1))
        last_down = np.maximum.accumulate(np.where(cross_down, bar, -1))
        trending = (dataframe['adx'] > self.adx_threshold).to_numpy()
        dataframe['adx_confirmed_up'] = (
            (last_up > last_down) & (bar - last_up <= self.adx_confirm_bars) & trending
        )
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
                dataframe['adx_confirmed_up'] &
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
