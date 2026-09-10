import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateKaufmanER, calculateMASlope, compositeTrendScore, calculateTrendQuality } from './trendQuality.js'

test('calculateKaufmanER: returns 1.0 for perfect straight-line trend', () => {
  // 价格从 100 直线涨到 110（净位移 = 总路径）
  const data = Array.from({ length: 21 }, (_, i) => ['100', String(100 + i * 0.5), '99', '101', '1000'])
  const er = calculateKaufmanER(data, 20)
  assert.ok(Math.abs(er - 1.0) < 0.01, `expected ~1.0, got ${er}`)
})

test('calculateKaufmanER: returns near 0 for choppy sideways price', () => {
  // 价格在 100 附近来回震荡（净位移接近 0，总路径很大）
  const data = Array.from({ length: 21 }, (_, i) => ['100', String(100 + (i % 2 === 0 ? 1 : -1)), '99', '101', '1000'])
  const er = calculateKaufmanER(data, 20)
  assert.ok(er < 0.2, `expected < 0.2, got ${er}`)
})

test('calculateKaufmanER: returns 0 when data length is insufficient', () => {
  const data = [['100', '100', '99', '101', '1000']]
  assert.equal(calculateKaufmanER(data, 20), 0)
})

test('calculateMASlope: returns positive slope for uptrending MA', () => {
  // 价格从 100 涨到 120，MA20 应向上倾斜
  const data = Array.from({ length: 50 }, (_, i) => ['100', String(100 + i * 0.5), '99', String(100 + i * 0.5 + 1), '1000'])
  const slope = calculateMASlope(data, 20, 10)
  assert.ok(slope > 0, `expected > 0, got ${slope}`)
})

test('calculateMASlope: returns negative slope for downtrending MA', () => {
  // 价格从 120 跌到 100
  const data = Array.from({ length: 50 }, (_, i) => ['120', String(120 - i * 0.5), '119', String(120 - i * 0.5 + 1), '1000'])
  const slope = calculateMASlope(data, 20, 10)
  assert.ok(slope < 0, `expected < 0, got ${slope}`)
})

test('calculateMASlope: returns 0 when data is insufficient', () => {
  const data = Array.from({ length: 10 }, () => ['100', '100', '99', '101', '1000'])
  assert.equal(calculateMASlope(data, 20, 10), 0)
})

test('compositeTrendScore: scores strong trend (high ER, high ADX, positive slope)', () => {
  const score = compositeTrendScore(0.8, 40, 2.0)
  // 0.4×80 + 0.4×40 + 0.2×(1+tanh(2))×50 ≈ 32 + 16 + ~9.6 ≈ 57+
  assert.ok(score > 50, `expected > 50, got ${score}`)
})

test('compositeTrendScore: scores weak trend (low ER, low ADX, flat slope)', () => {
  const score = compositeTrendScore(0.2, 15, 0)
  // 0.4×20 + 0.4×15 + 0.2×50 = 8 + 6 + 10 = 24
  assert.ok(score < 30, `expected < 30, got ${score}`)
})

test('compositeTrendScore: handles negative slope (downtrend)', () => {
  const score = compositeTrendScore(0.7, 35, -1.5)
  // tanh(-1.5) ≈ -0.9，tanh_scaled ≈ (1-0.9)×50 = 5
  // 0.4×70 + 0.4×35 + 0.2×5 = 28 + 14 + 1 = 43
  assert.ok(score > 40, `expected > 40, got ${score}`)
  assert.ok(score < 50, `expected < 50, got ${score}`)
})

test('calculateTrendQuality: returns valid TrendQuality object with all fields', () => {
  const data = Array.from({ length: 50 }, (_, i) => ['100', String(100 + i * 0.3), '99', String(101 + i * 0.3), '1000'])
  const quality = calculateTrendQuality(data, 20, 20)
  assert.ok('kaufmanER' in quality)
  assert.ok('adx' in quality)
  assert.ok('maSlope' in quality)
  assert.ok('compositeScore' in quality)
  assert.ok(quality.kaufmanER >= 0)
  assert.ok(quality.kaufmanER <= 1)
  assert.ok(quality.adx >= 0)
  assert.ok(quality.compositeScore >= 0)
  assert.ok(quality.compositeScore <= 100)
})
