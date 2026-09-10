import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateMultiTimeframe } from './multiTimeframe.js'
import type { ScanResult } from './types.js'

const createMockScore = (direction: ScanResult['direction'], trendScore: number, trendQuality?: any): ScanResult => ({
  pair: 'BTC-USDT',
  timeframe: '4H',
  direction,
  trendScore,
  trendQuality,
  riskRewardTight: 2.0,
  riskRewardWide: 3.0,
  trailingStopPercent: 3.5,
  currentPrice: 50000,
  stopLossTight: 48000,
  stopLossWide: 47000,
  takeProfit: 54000,
  strategyRecommendation: 'trend',
  insufficientData: false,
})

const createLowerCandles = (direction: 'long' | 'short', rsi: number): string[][] => {
  // 前 29 根价格稳定在 ma20Price，使 MA20 ≈ ma20Price；最后一根收盘在 MA20 正确侧
  const ma20Price = direction === 'long' ? 49000 : 51000
  const currentPrice = direction === 'long' ? ma20Price + 200 : ma20Price - 200 // 价格在 MA20 正确侧
  return Array.from({ length: 30 }, (_, i) => {
    const price = i === 29 ? currentPrice : ma20Price
    return [String(ma20Price), String(price), String(price - 100), String(price + 100), '1000']
  })
}

test('evaluateMultiTimeframe: passes when 4H trend quality is high and 1H shows pullback', () => {
  const higher = createMockScore('long', 65, { kaufmanER: 0.7, adx: 35, maSlope: 1.5, compositeScore: 65 })
  const lower = createMockScore('long', 55)
  const lowerCandles = createLowerCandles('long', 25) // RSI < 30 表示超卖回调

  const result = evaluateMultiTimeframe(higher, lower, lowerCandles, 60, 60, 0.8, 1.0, 25)

  assert.equal(result.passed, true)
  assert.equal(result.phase, 'pullback')
  assert.ok(result.detail.includes('4H long'))
  assert.ok(result.detail.includes('质量 65'))
})

test('evaluateMultiTimeframe: fails when 4H trend quality is below threshold', () => {
  const higher = createMockScore('long', 55, { kaufmanER: 0.3, adx: 20, maSlope: 0.5, compositeScore: 45 })
  const lower = createMockScore('long', 55)
  const lowerCandles = createLowerCandles('long', 25)

  const result = evaluateMultiTimeframe(higher, lower, lowerCandles, 60, 60, 0.8, 1.0, 25)

  assert.equal(result.passed, false)
})

test('evaluateMultiTimeframe: fails when 1H pullback depth is insufficient', () => {
  const higher = createMockScore('long', 65, { kaufmanER: 0.7, adx: 35, maSlope: 1.5, compositeScore: 65 })
  const lower = createMockScore('long', 55)
  const lowerCandles = createLowerCandles('long', 25)

  const result = evaluateMultiTimeframe(higher, lower, lowerCandles, 60, 60, 0.8, 0.5, 25) // pullbackAtr 只有 0.5

  assert.equal(result.passed, false)
  assert.notEqual(result.phase, 'pullback')
})

test('evaluateMultiTimeframe: fails when 1H RSI does not indicate oversold (long)', () => {
  const higher = createMockScore('long', 65, { kaufmanER: 0.7, adx: 35, maSlope: 1.5, compositeScore: 65 })
  const lower = createMockScore('long', 55)
  const lowerCandles = createLowerCandles('long', 50) // RSI = 50，不是超卖

  const result = evaluateMultiTimeframe(higher, lower, lowerCandles, 60, 60, 0.8, 1.0, 50)

  assert.equal(result.passed, false)
  assert.notEqual(result.phase, 'pullback')
})

test('evaluateMultiTimeframe: passes for short direction with overbought RSI', () => {
  const higher = createMockScore('short', 65, { kaufmanER: 0.7, adx: 35, maSlope: -1.5, compositeScore: 65 })
  const lower = createMockScore('short', 55)
  const lowerCandles = createLowerCandles('short', 75) // RSI > 70 表示超买反弹

  const result = evaluateMultiTimeframe(higher, lower, lowerCandles, 60, 60, 0.8, 1.0, 75)

  assert.equal(result.passed, true)
  assert.equal(result.phase, 'pullback')
})

test('evaluateMultiTimeframe: falls back to trendScore when trendQuality is missing', () => {
  const higher = createMockScore('long', 65) // 无 trendQuality
  const lower = createMockScore('long', 55)
  const lowerCandles = createLowerCandles('long', 25)

  const result = evaluateMultiTimeframe(higher, lower, lowerCandles, 60, 60, 0.8, 1.0, 25)

  assert.ok(result.detail.includes('评分 65'))
  assert.ok(!result.detail.includes('质量'))
})

test('evaluateMultiTimeframe: fails when higher direction is neutral', () => {
  const higher = createMockScore('neutral', 65, { kaufmanER: 0.7, adx: 35, maSlope: 0, compositeScore: 65 })
  const lower = createMockScore('neutral', 55)
  const lowerCandles = createLowerCandles('long', 25)

  const result = evaluateMultiTimeframe(higher, lower, lowerCandles, 60, 60, 0.8, 1.0, 25)

  assert.equal(result.passed, false)
})
