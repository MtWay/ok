"""MA 交叉策略的离线回测，与 useBacktest.ts / freqtrade 策略保持一致。"""

from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).parent / 'data' / 'binance'

MA_FAST = 10
MA_SLOW = 30
ADX_PERIOD = 14

DEFAULT_CAPITAL = 1000.0
DEFAULT_STAKE = 100.0
DEFAULT_STOP_LOSS = 0.05
DEFAULT_TAKE_PROFIT = 0.10
DEFAULT_ENABLE_SHORT = True


def _wilder_smooth(values: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(values), np.nan)
    if len(values) < period:
        return out
    total = values[:period].sum()
    out[period - 1] = total
    for i in range(period, len(values)):
        out[i] = out[i - 1] - out[i - 1] / period + values[i]
    return out


def adx(df: pd.DataFrame, period: int = ADX_PERIOD) -> np.ndarray:
    """Wilder ADX，与 talib.ADX 对齐；warmup 长度 2*period-1。"""
    high = df['high'].values.astype(float)
    low = df['low'].values.astype(float)
    close = df['close'].values.astype(float)
    n = len(df)
    out = np.full(n, np.nan)
    if n <= period * 2:
        return out

    prev_close, prev_high, prev_low = close[:-1], high[:-1], low[:-1]
    tr = np.maximum.reduce([
        high[1:] - low[1:],
        np.abs(high[1:] - prev_close),
        np.abs(low[1:] - prev_close),
    ])
    up_move = high[1:] - prev_high
    down_move = prev_low - low[1:]
    dmp = np.where(up_move > down_move, np.maximum(up_move, 0.0), 0.0)
    dmm = np.where(down_move > up_move, np.maximum(down_move, 0.0), 0.0)

    tr_s = _wilder_smooth(tr, period)
    dmp_s = _wilder_smooth(dmp, period)
    dmm_s = _wilder_smooth(dmm, period)

    with np.errstate(divide='ignore', invalid='ignore'):
        dx = np.where(tr_s != 0, np.abs(dmp_s - dmm_s) / tr_s * 100.0, np.nan)

    valid = ~np.isnan(dx)
    if not valid.any():
        return out

    first = int(np.argmax(valid))
    window = dx[first:first + period]
    if np.isnan(window).any():
        return out

    # dx[k] 对应 data[k+1]，ADX 起点再叠加 period 根
    base = first + period - 1
    prev = float(np.nanmean(window))
    out[base + 1] = prev
    for k in range(base + 1, len(dx)):
        if np.isnan(dx[k]):
            break
        prev = prev - prev / period + dx[k] / period
        out[k + 1] = prev

    return out


def load_data(pair: str, data_dir: Path = DATA_DIR) -> pd.DataFrame:
    filepath = data_dir / f'{pair.replace("/", "_")}-1h.feather'
    df = pd.read_feather(filepath)
    df['date'] = pd.to_datetime(df['date'], unit='s')
    df.set_index('date', inplace=True)
    return df


def add_indicators(df: pd.DataFrame, ma_fast: int = MA_FAST, ma_slow: int = MA_SLOW) -> pd.DataFrame:
    df['ma_fast'] = df['close'].rolling(ma_fast).mean()
    df['ma_slow'] = df['close'].rolling(ma_slow).mean()
    df['adx'] = adx(df)
    return df


def backtest(
    df: pd.DataFrame,
    initial_capital: float = DEFAULT_CAPITAL,
    stake_amount: float = DEFAULT_STAKE,
    stop_loss: float = DEFAULT_STOP_LOSS,
    take_profit: float = DEFAULT_TAKE_PROFIT,
    enable_short: bool = DEFAULT_ENABLE_SHORT,
    adx_threshold: float | None = None,
    adx_confirm_bars: int = 0,
) -> dict:
    """单标的回测。

    入场由快慢线交叉触发；出场由反向交叉、止损或止盈触发，出场后回到空仓。

    adx_threshold 为 None 时不使用 ADX 过滤。
    否则要求 ADX 超过阈值才入场，判定方式取决于 adx_confirm_bars：
      - 0：交叉当根即要求 ADX > 阈值（原始写法，ADX 此刻结构性偏低，几乎无法成交）
      - >0：交叉后最多等待 N 根，期间首次 ADX > 阈值才在该根收盘价入场
    """
    capital = float(initial_capital)
    position = 0  # 0: 空仓, 1: 多头, -1: 空头
    entry_price = 0.0
    entry_time = None
    pending = None  # (方向, 过期下标)，仅在延迟确认模式下使用

    trades = []
    equity_curve = [initial_capital]

    closes = df['close'].values
    fast = df['ma_fast'].values
    slow = df['ma_slow'].values
    adx_values = df['adx'].values if 'adx' in df.columns else None
    gated = adx_threshold is not None
    index = df.index

    def adx_ok(i: int) -> bool:
        if not gated:
            return True
        v = adx_values[i]
        return not np.isnan(v) and v > adx_threshold

    for i in range(1, len(df)):
        close = float(closes[i])
        if np.isnan(fast[i]) or np.isnan(slow[i]) or np.isnan(fast[i - 1]) or np.isnan(slow[i - 1]):
            equity_curve.append(capital)
            continue

        cross_up = fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]
        cross_down = fast[i - 1] >= slow[i - 1] and fast[i] < slow[i]

        exited = False
        if position == 0:
            if cross_up:
                pending = (1, i + adx_confirm_bars) if gated else None
            elif enable_short and cross_down:
                pending = (-1, i + adx_confirm_bars) if gated else None

            if not gated:
                direction = 1 if cross_up else (-1 if (enable_short and cross_down) else None)
            elif pending is not None:
                d, expiry = pending
                if i > expiry:
                    pending = None  # 等待窗口内 ADX 未达标，放弃该信号
                    direction = None
                else:
                    direction = d if adx_ok(i) else None
                    if direction is not None:
                        pending = None
            else:
                direction = None

            if direction is not None:
                position = direction
                entry_price = close
                entry_time = index[i]
        elif position == 1:
            pnl = (close - entry_price) / entry_price
            if cross_down or pnl <= -stop_loss or pnl >= take_profit:
                trades.append(_close_trade(1, entry_time, index[i], entry_price, close))
                capital += stake_amount * pnl
                position = 0
                pending = None
                exited = True
        else:
            pnl = (entry_price - close) / entry_price
            if cross_up or pnl <= -stop_loss or pnl >= take_profit:
                trades.append(_close_trade(-1, entry_time, index[i], entry_price, close))
                capital += stake_amount * pnl
                position = 0
                pending = None
                exited = True

        if exited:
            equity_curve.append(capital)
            continue

        if position == 1:
            equity_curve.append(capital + stake_amount * (close - entry_price) / entry_price)
        elif position == -1:
            equity_curve.append(capital + stake_amount * (entry_price - close) / entry_price)
        else:
            equity_curve.append(capital)

    # 收尾：按最后一根 K 线平掉未了结仓位
    if position != 0 and len(df) > 0:
        last_time = index[-1]
        close = float(closes[-1])
        if position == 1:
            pnl = (close - entry_price) / entry_price
            trades.append(_close_trade(1, entry_time, last_time, entry_price, close))
        else:
            pnl = (entry_price - close) / entry_price
            trades.append(_close_trade(-1, entry_time, last_time, entry_price, close))
        capital += stake_amount * pnl
        equity_curve[-1] = capital

    trades_df = pd.DataFrame(trades)
    total_return = (capital - initial_capital) / initial_capital

    if not trades_df.empty:
        win_rate = float((trades_df['pnl'] > 0).mean())
        avg_profit = float(trades_df['pnl'].mean())
    else:
        win_rate = 0.0
        avg_profit = 0.0

    curve = pd.Series(equity_curve)
    max_drawdown = float((curve / curve.cummax() - 1).min()) if len(curve) else 0.0

    return {
        'total_return': total_return,
        'final_capital': capital,
        'win_rate': win_rate,
        'avg_profit': avg_profit,
        'max_drawdown': max_drawdown,
        'total_trades': len(trades_df),
        'trades': trades_df,
        'equity_curve': curve,
    }


def _close_trade(direction: int, entry_time, exit_time, entry_price: float, exit_price: float) -> dict:
    pnl = (exit_price - entry_price) / entry_price if direction == 1 else (entry_price - exit_price) / entry_price
    return {
        'direction': 'long' if direction == 1 else 'short',
        'entry_time': entry_time,
        'exit_time': exit_time,
        'entry_price': entry_price,
        'exit_price': exit_price,
        'pnl': pnl,
        'duration_hours': (exit_time - entry_time).total_seconds() / 3600,
    }


def main():
    pairs = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT']

    print('=' * 60)
    print('Freqtrade OKX 回测报告 (离线模式)')
    print('策略: MA10/MA30 均线交叉（ADX 仅用于展示/评分，不参与入场）')
    print(f'止损: {DEFAULT_STOP_LOSS:.0%}  止盈: {DEFAULT_TAKE_PROFIT:.0%}  做空: {DEFAULT_ENABLE_SHORT}')
    print('=' * 60)

    all_results = []

    for pair in pairs:
        df = add_indicators(load_data(pair))
        result = backtest(df)

        print(f'\n【{pair.replace("_", "/")}】')
        print(f'  总收益率: {result["total_return"] * 100:.2f}%')
        print(f'  交易次数: {result["total_trades"]}')
        print(f'  胜率: {result["win_rate"] * 100:.2f}%')
        print(f'  平均收益: {result["avg_profit"] * 100:.2f}%')
        print(f'  最大回撤: {result["max_drawdown"] * 100:.2f}%')

        all_results.append({'pair': pair, **result})

    print('\n' + '=' * 60)
    print('汇总')
    print('=' * 60)
    total_trades = sum(r['total_trades'] for r in all_results)
    avg_return = np.mean([r['total_return'] for r in all_results])
    print(f'总交易次数: {total_trades}')
    print(f'平均收益率: {avg_return * 100:.2f}%')


if __name__ == '__main__':
    main()
