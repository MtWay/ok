import { describe, expect, test } from 'vitest'
import { runConsecutiveCandleBacktest } from './useStrategyEngines'

// OHLCV 布局：[open, close, low, high, volume]
type Ohlc = [open: number, close: number, low: number, high: number]

function runWith(candles: Ohlc[], stopAtrMult = 2) {
  const dates = candles.map((_, i) => `2026-01-01 ${String(i).padStart(2, '0')}:00:00`)
  const data = candles.map(([o, c, l, h]) => [o, c, l, h, 1000].map(String))
  return runConsecutiveCandleBacktest(dates, data, {
    initialCapital: 10_000,
    stakeAmount: 1_000,
    consecutiveCount: 3,
    atrPeriod: 14,
    stopAtrMult,
    pair: 'BTC-USDT',
  })
}

const longEntry: Ohlc[] = [
  [100, 100, 99.5, 100.5],
  [100, 101, 100, 101],
  [101, 102, 101, 102],
  [102, 103, 102, 103], // 连续 3 根阳线，收于 103 时全仓做多；ATR=1
]

const shortEntry: Ohlc[] = [
  [100, 100, 99.5, 100.5],
  [100, 99, 99, 100],
  [99, 98, 98, 99],
  [98, 97, 97, 98], // 连续 3 根阴线，收于 97 时全仓做空；ATR=1
]

function expectSingleTrade(result: ReturnType<typeof runWith>) {
  expect(result.trades).toBe(1)
  expect(result.tradesList).toHaveLength(1)
  return result.tradesList[0]
}

describe('连续单边K线：状态失效即全仓出场', () => {
  test('多头在第一根阴线收盘价退出', () => {
    const result = runWith([
      ...longEntry,
      [103, 104, 103, 104],
      [104, 103.5, 103.5, 104], // 未破前低 103，仅触发收盘状态退出
    ])
    const trade = expectSingleTrade(result)
    expect(trade.direction).toBe('long')
    expect(trade.exitIndex).toBe(5)
    expect(trade.exitPrice).toBe(103.5)
    expect(trade.closeReason).toBe('cc_state_exit')
  })

  test('空头在第一根阳线收盘价退出', () => {
    const result = runWith([
      ...shortEntry,
      [97, 96, 96, 97],
      [96, 96.5, 96, 96.5], // 未破前高 97，仅触发收盘状态退出
    ])
    const trade = expectSingleTrade(result)
    expect(trade.direction).toBe('short')
    expect(trade.exitIndex).toBe(5)
    expect(trade.exitPrice).toBe(96.5)
    expect(trade.closeReason).toBe('cc_state_exit')
  })

  test('十字星使当前状态失效并按收盘价退出', () => {
    const result = runWith([
      ...longEntry,
      [104, 104, 104, 104],
    ])
    const trade = expectSingleTrade(result)
    expect(trade.exitIndex).toBe(4)
    expect(trade.exitPrice).toBe(104)
    expect(trade.closeReason).toBe('cc_state_exit')
  })

  test('同向K线延续时不触发状态退出', () => {
    const result = runWith([
      ...longEntry,
      [103, 104, 103, 104],
    ])
    const trade = expectSingleTrade(result)
    expect(trade.exitIndex).toBe(4)
    expect(trade.exitPrice).toBe(104)
    expect(trade.closeReason).toBe('backtest_end')
  })
})

describe('连续单边K线：固定 ATR 与前K线价格保护', () => {
  test('ATR 比前低更紧时触发 cc_stop', () => {
    const result = runWith([
      ...longEntry,
      [103, 102, 100, 103],
    ], 0.5) // ATR 止损=102.5，比前低 102 更紧
    const trade = expectSingleTrade(result)
    expect(trade.exitIndex).toBe(4)
    expect(trade.exitPrice).toBe(102.5)
    expect(trade.closeReason).toBe('cc_stop')
  })

  test('多头当前根仍收阳但 low 破前低时立即退出', () => {
    const result = runWith([
      ...longEntry,
      [103, 103.5, 101.5, 104], // 前低 102 比 ATR 止损 101 更紧，且未触及 ATR
    ])
    const trade = expectSingleTrade(result)
    expect(trade.exitIndex).toBe(4)
    expect(trade.exitPrice).toBe(102)
    expect(trade.closeReason).toBe('cc_prev_candle_stop')
  })

  test('空头当前根仍收阴但 high 破前高时立即退出', () => {
    const result = runWith([
      ...shortEntry,
      [97, 96.5, 96, 98.2], // 前高 98 比 ATR 止损 99 更紧，且未触及 ATR
    ])
    const trade = expectSingleTrade(result)
    expect(trade.exitIndex).toBe(4)
    expect(trade.exitPrice).toBe(98)
    expect(trade.closeReason).toBe('cc_prev_candle_stop')
  })

  test('价格保护优先于反色收盘状态退出', () => {
    const result = runWith([
      ...longEntry,
      [103, 102.5, 101.5, 103],
    ])
    const trade = expectSingleTrade(result)
    expect(trade.exitIndex).toBe(4)
    expect(trade.exitPrice).toBe(102)
    expect(trade.closeReason).toBe('cc_prev_candle_stop')
  })

  test('多头跳空跌破前低时按开盘价成交', () => {
    const result = runWith([
      ...longEntry,
      [101.5, 102, 101, 102.5],
    ])
    const trade = expectSingleTrade(result)
    expect(trade.exitIndex).toBe(4)
    expect(trade.exitPrice).toBe(101.5)
    expect(trade.closeReason).toBe('cc_prev_candle_stop')
  })
})
