import sys
sys.path.insert(0, r'C:\Users\Administrator\AppData\Local\Programs\Python\Python313\Lib\site-packages')

import pandas as pd
import numpy as np
from datetime import datetime
import talib


def load_data(pair: str) -> pd.DataFrame:
    filepath = f'f:/work1/k/freqtrade_userdir/data/binance/{pair.replace("/", "_")}-1h.feather'
    df = pd.read_feather(filepath)
    df['date'] = pd.to_datetime(df['date'], unit='s')
    df.set_index('date', inplace=True)
    return df


def ma_cross_strategy(df: pd.DataFrame) -> pd.DataFrame:
    df['ma_fast'] = talib.SMA(df['close'].values, timeperiod=10)
    df['ma_slow'] = talib.SMA(df['close'].values, timeperiod=30)
    df['adx'] = talib.ADX(df['high'].values, df['low'].values, df['close'].values, timeperiod=14)

    df['signal'] = 0
    df['position'] = 0

    for i in range(1, len(df)):
        if pd.isna(df['ma_fast'].iloc[i]) or pd.isna(df['ma_slow'].iloc[i]) or pd.isna(df['adx'].iloc[i]):
            continue

        if df['ma_fast'].iloc[i-1] <= df['ma_slow'].iloc[i-1] and df['ma_fast'].iloc[i] > df['ma_slow'].iloc[i] and df['adx'].iloc[i] > 20:
            df.loc[df.index[i], 'signal'] = 1
        elif df['ma_fast'].iloc[i-1] >= df['ma_slow'].iloc[i-1] and df['ma_fast'].iloc[i] < df['ma_slow'].iloc[i]:
            df.loc[df.index[i], 'signal'] = -1

    position = 0
    positions = []
    for s in df['signal']:
        if s == 1:
            position = 1
        elif s == -1:
            position = 0
        positions.append(position)
    df['position'] = positions

    return df


def backtest(df: pd.DataFrame, initial_capital: float = 1000, stake_amount: float = 100) -> dict:
    df['returns'] = df['close'].pct_change()
    df['strategy_returns'] = df['position'].shift(1) * df['returns']

    trades = []
    in_position = False
    entry_price = 0
    entry_time = None

    for i in range(1, len(df)):
        if df['signal'].iloc[i] == 1 and not in_position:
            in_position = True
            entry_price = df['close'].iloc[i]
            entry_time = df.index[i]
        elif df['signal'].iloc[i] == -1 and in_position:
            exit_price = df['close'].iloc[i]
            exit_time = df.index[i]
            pnl = (exit_price - entry_price) / entry_price
            trades.append({
                'entry_time': entry_time,
                'exit_time': exit_time,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'pnl': pnl,
                'duration_hours': (exit_time - entry_time).total_seconds() / 3600
            })
            in_position = False

    df['cum_returns'] = (1 + df['strategy_returns'].fillna(0)).cumprod()
    total_return = df['cum_returns'].iloc[-1] - 1

    if trades:
        trades_df = pd.DataFrame(trades)
        win_rate = (trades_df['pnl'] > 0).mean()
        avg_profit = trades_df['pnl'].mean()
        max_drawdown = (df['cum_returns'] / df['cum_returns'].cummax() - 1).min()
    else:
        win_rate = 0
        avg_profit = 0
        max_drawdown = 0
        trades_df = pd.DataFrame()

    return {
        'total_return': total_return,
        'win_rate': win_rate,
        'avg_profit': avg_profit,
        'max_drawdown': max_drawdown,
        'total_trades': len(trades),
        'trades': trades_df
    }


def main():
    pairs = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT']

    print("=" * 60)
    print("Freqtrade OKX 回测报告 (离线模式)")
    print("策略: MA10/MA30 均线交叉 + ADX > 20")
    print("时间范围: 2024-01-01 至 2025-05-01")
    print("时间周期: 1小时")
    print("=" * 60)

    all_results = []

    for pair in pairs:
        df = load_data(pair)
        df = ma_cross_strategy(df)
        result = backtest(df)

        print(f"\n【{pair.replace('_', '/')}】")
        print(f"  总收益率: {result['total_return']*100:.2f}%")
        print(f"  交易次数: {result['total_trades']}")
        print(f"  胜率: {result['win_rate']*100:.2f}%")
        print(f"  平均收益: {result['avg_profit']*100:.2f}%")
        print(f"  最大回撤: {result['max_drawdown']*100:.2f}%")

        all_results.append({
            'pair': pair,
            **result
        })

    print("\n" + "=" * 60)
    print("汇总")
    print("=" * 60)
    total_trades = sum(r['total_trades'] for r in all_results)
    avg_return = np.mean([r['total_return'] for r in all_results])
    print(f"总交易次数: {total_trades}")
    print(f"平均收益率: {avg_return*100:.2f}%")


if __name__ == '__main__':
    main()
