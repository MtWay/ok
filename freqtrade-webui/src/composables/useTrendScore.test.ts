import { describe, expect, test } from 'vitest'
import { calculateMADurations } from './useTrendScore'

// OHLCV 布局：[open, close, low, high, volume]
function toData(candles: Array<[number, number, number, number]>): string[][] {
  return candles.map(([o, c, l, h]) => [o, c, l, h, 1000].map(String))
}

describe('calculateMADurations', () => {
  test('持续上涨时返回正持续K线数', () => {
    const candles: Array<[number, number, number, number]> = []
    for (let i = 0; i < 25; i++) {
      candles.push([i + 1, i + 2, i + 1, i + 2])
    }
    const result = calculateMADurations(toData(candles))
    expect(result.ma5Duration).toBeGreaterThan(0)
    expect(result.ma10Duration).toBeGreaterThan(0)
    expect(result.ma20Duration).toBeGreaterThan(0)
  })

  test('持续下跌时返回负持续K线数', () => {
    const candles: Array<[number, number, number, number]> = []
    for (let i = 0; i < 25; i++) {
      const v = 50 - i
      candles.push([v, v - 1, v - 1, v])
    }
    const result = calculateMADurations(toData(candles))
    expect(result.ma5Duration).toBeLessThan(0)
    expect(result.ma10Duration).toBeLessThan(0)
    expect(result.ma20Duration).toBeLessThan(0)
  })

  test('数据不足时返回 0', () => {
    const candles: Array<[number, number, number, number]> = []
    for (let i = 0; i < 5; i++) {
      candles.push([i + 1, i + 2, i + 1, i + 2])
    }
    const result = calculateMADurations(toData(candles))
    expect(result.ma20Duration).toBe(0)
  })

  test('最近一根方向改变时持续数为 1', () => {
    const candles: Array<[number, number, number, number]> = []
    // 前 20 根缓慢下跌
    for (let i = 0; i < 20; i++) {
      const v = 40 - i * 0.5
      candles.push([v, v - 0.5, v - 0.5, v])
    }
    // 最后 1 根反转向上涨
    const last = candles[candles.length - 1]
    candles.push([last[1], last[1] + 2, last[1], last[1] + 2])
    const result = calculateMADurations(toData(candles))
    // MA20 尚未掉头，MA5 已经掉头
    expect(result.ma5Duration).toBe(1)
  })
})
