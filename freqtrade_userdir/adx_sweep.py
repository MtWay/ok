"""扫描不同 ADX 门槛对胜率与收益的影响。

对比三种入场方式：
  none        纯 MA 交叉，不用 ADX（基线）
  same-bar    交叉当根要求 ADX > 阈值（原始写法）
  confirm-N   交叉后最多等 N 根，期间首次 ADX > 阈值才入场
"""

import numpy as np
import pandas as pd

from offline_backtest import add_indicators, backtest, load_data

PAIRS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT']
THRESHOLDS = [5, 8, 10, 12, 15, 20, 25, 30]
CONFIRM_WINDOWS = [6, 12, 24]


def adx_at_cross(df: pd.DataFrame) -> np.ndarray:
    """返回每次快慢线交叉当根的 ADX，用于说明门槛为何难以满足。"""
    f, s, a = df['ma_fast'].values, df['ma_slow'].values, df['adx'].values
    up = (f[:-1] <= s[:-1]) & (f[1:] > s[1:])
    down = (f[:-1] >= s[:-1]) & (f[1:] < s[1:])
    mask = up | down
    return a[1:][mask]


def sweep(dfs: dict[str, pd.DataFrame], threshold, confirm_bars) -> dict:
    rows = []
    for pair, df in dfs.items():
        kw = {} if threshold is None else {'adx_threshold': threshold, 'adx_confirm_bars': confirm_bars}
        r = backtest(df, **kw)
        rows.append(r)
    trades = sum(r['total_trades'] for r in rows)
    active = [r for r in rows if r['total_trades']]
    return {
        'trades': trades,
        'avg_return': float(np.mean([r['total_return'] for r in rows])),
        'win_rate': float(np.mean([r['win_rate'] for r in active])) if active else 0.0,
        'avg_pnl': float(np.mean([r['avg_profit'] for r in active])) if active else 0.0,
        'max_dd': float(np.mean([r['max_drawdown'] for r in rows])),
        'per_pair': [r['total_return'] for r in rows],
    }


def print_row(label: str, s: dict) -> None:
    per = ' '.join(f'{v * 100:+6.1f}' for v in s['per_pair'])
    print(f'{label:<22}{s["trades"]:>6}{s["avg_return"] * 100:>9.2f}%{s["win_rate"] * 100:>8.1f}%'
          f'{s["avg_pnl"] * 100:>8.2f}%{s["max_dd"] * 100:>8.1f}%   {per}')


def main():
    dfs = {p: add_indicators(load_data(p)) for p in PAIRS}

    print('=' * 96)
    print('ADX 门槛对 MA 交叉策略的影响（MA10/MA30，1h，止损 5% / 止盈 10%，含做空）')
    print('=' * 96)

    print('\n【为什么 same-bar 门槛几乎无法成交】')
    print('各标的在快慢线交叉当根的 ADX 分布：')
    print(f'{"标的":<12}{"交叉次数":>10}{"中位数":>10}{"p75":>8}{"p90":>8}{"最大值":>9}')
    for pair, df in dfs.items():
        vals = adx_at_cross(df)
        vals = vals[~np.isnan(vals)]
        print(f'{pair:<12}{len(vals):>10}{np.median(vals):>10.1f}{np.percentile(vals, 75):>8.1f}'
              f'{np.percentile(vals, 90):>8.1f}{vals.max():>9.1f}')

    header = f'\n{"入场方式":<22}{"笔数":>6}{"均收益":>10}{"均胜率":>9}{"均单笔":>9}{"均回撤":>9}   各标的收益%'
    print(header)
    print('-' * 96)

    print_row('none (基线)', sweep(dfs, None, 0))
    print()

    for t in THRESHOLDS:
        print_row(f'same-bar ADX>{t}', sweep(dfs, t, 0))
    print()

    for n in CONFIRM_WINDOWS:
        for t in THRESHOLDS:
            print_row(f'confirm-{n} ADX>{t}', sweep(dfs, t, n))
        print()

    print('=' * 96)
    print('列含义：笔数=五标的成交总数；均收益=各标的收益率的算术平均（未按资金加权）')
    print('      均胜率/均单笔为有成交标的的平均；均回撤取各标的最大回撤的平均')


if __name__ == '__main__':
    main()
