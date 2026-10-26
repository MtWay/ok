import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backtestConsecutiveCandle, DEFAULT_CC_PARAMS } from './consecutiveCandleBacktest.js'

// 构造 K 线 [open, close, low, high, volume]
function candle(o: number, c: number, l?: number, h?: number): string[] {
  return [String(o), String(c), String(l ?? Math.min(o, c)), String(h ?? Math.max(o, c)), '1']
}

test('连续 5 根阳线后下一根收盘入场做多', () => {
  // 前 20 根平盘（ATR 预热），再 5 根阳线
  const candles: string[][] = []
  for (let i = 0; i < 20; i++) candles.push(candle(100, 100, 99.5, 100.5))
  for (let i = 0; i < 5; i++) candles.push(candle(100 + i, 101 + i))
  // 第 6 根仍阳（streak=6，持仓中不动）；第 7 根转阴但低点不破前根 low
  // （105.5 > 105），不触止损 → 连续中断按收盘退出
  candles.push(candle(105, 106))
  candles.push(candle(106, 105.5))

  const trades = backtestConsecutiveCandle(candles, DEFAULT_CC_PARAMS, 1000)
  assert.equal(trades.length, 1)
  assert.equal(trades[0].side, 'long')
  assert.equal(trades[0].reason, 'streak_end')
  // 入场价 = 第 5 根阳线收盘 105，出场 = 105.5 → 毛盈 0.5×qty，扣费后仍为正
  assert.ok(trades[0].pnl > 0)
})

test('持仓中低点触发止损（固定 ATR 与前根 low 较紧者）', () => {
  const candles: string[][] = []
  for (let i = 0; i < 20; i++) candles.push(candle(100, 100, 99.5, 100.5))
  for (let i = 0; i < 6; i++) candles.push(candle(100 + i, 101 + i)) // 入场@105
  // 大阴线直接击穿前根 low 与固定止损
  candles.push(candle(105, 95, 94, 105.5))
  const trades = backtestConsecutiveCandle(candles, DEFAULT_CC_PARAMS, 1000)
  assert.equal(trades.length, 1)
  assert.equal(trades[0].reason, 'stop')
})

test('无连续信号时不交易', () => {
  const candles: string[][] = []
  for (let i = 0; i < 60; i++) candles.push(i % 2 === 0 ? candle(100, 101) : candle(101, 100))
  const trades = backtestConsecutiveCandle(candles, DEFAULT_CC_PARAMS, 1000)
  assert.equal(trades.length, 0)
})

console.log('consecutiveCandleBacktest.test.ts: all assertions passed')
