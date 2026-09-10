import { describe, it, expect } from '@jest/globals'
import { calculateKaufmanER, calculateMASlope, compositeTrendScore, calculateTrendQuality } from './trendQuality.js'

describe('trendQuality', () => {
  describe('calculateKaufmanER', () => {
    it('returns 1.0 for perfect straight-line trend', () => {
      // 价格从 100 直线涨到 110（净位移 = 总路径）
      const data = Array.from({ length: 21 }, (_, i) => ['100', String(100 + i * 0.5), '99', '101', '1000'])
      const er = calculateKaufmanER(data, 20)
      expect(er).toBeCloseTo(1.0, 2)
    })

    it('returns near 0 for choppy sideways price', () => {
      // 价格在 100 附近来回震荡（净位移接近 0，总路径很大）
      const data = Array.from({ length: 21 }, (_, i) => ['100', String(100 + (i % 2 === 0 ? 1 : -1)), '99', '101', '1000'])
      const er = calculateKaufmanER(data, 20)
      expect(er).toBeLessThan(0.2)
    })

    it('returns 0 when data length is insufficient', () => {
      const data = [['100', '100', '99', '101', '1000']]
      expect(calculateKaufmanER(data, 20)).toBe(0)
    })
  })

  describe('calculateMASlope', () => {
    it('returns positive slope for uptrending MA', () => {
      // 价格从 100 涨到 120，MA20 应向上倾斜
      const data = Array.from({ length: 50 }, (_, i) => ['100', String(100 + i * 0.5), '99', String(100 + i * 0.5 + 1), '1000'])
      const slope = calculateMASlope(data, 20, 10)
      expect(slope).toBeGreaterThan(0)
    })

    it('returns negative slope for downtrending MA', () => {
      // 价格从 120 跌到 100
      const data = Array.from({ length: 50 }, (_, i) => ['120', String(120 - i * 0.5), '119', String(120 - i * 0.5 + 1), '1000'])
      const slope = calculateMASlope(data, 20, 10)
      expect(slope).toBeLessThan(0)
    })

    it('returns 0 when data is insufficient', () => {
      const data = Array.from({ length: 10 }, () => ['100', '100', '99', '101', '1000'])
      expect(calculateMASlope(data, 20, 10)).toBe(0)
    })
  })

  describe('compositeTrendScore', () => {
    it('scores strong trend (high ER, high ADX, positive slope)', () => {
      const score = compositeTrendScore(0.8, 40, 2.0)
      // 0.4×80 + 0.4×40 + 0.2×(1+tanh(2))×50 ≈ 32 + 16 + ~9.6 ≈ 57+
      expect(score).toBeGreaterThan(50)
    })

    it('scores weak trend (low ER, low ADX, flat slope)', () => {
      const score = compositeTrendScore(0.2, 15, 0)
      // 0.4×20 + 0.4×15 + 0.2×50 = 8 + 6 + 10 = 24
      expect(score).toBeLessThan(30)
    })

    it('handles negative slope (downtrend)', () => {
      const score = compositeTrendScore(0.7, 35, -1.5)
      // tanh(-1.5) ≈ -0.9，tanh_scaled ≈ (1-0.9)×50 = 5
      // 0.4×70 + 0.4×35 + 0.2×5 = 28 + 14 + 1 = 43
      expect(score).toBeGreaterThan(40)
      expect(score).toBeLessThan(50)
    })
  })

  describe('calculateTrendQuality', () => {
    it('returns valid TrendQuality object with all fields', () => {
      const data = Array.from({ length: 50 }, (_, i) => ['100', String(100 + i * 0.3), '99', String(101 + i * 0.3), '1000'])
      const quality = calculateTrendQuality(data, 20, 20)
      expect(quality).toHaveProperty('kaufmanER')
      expect(quality).toHaveProperty('adx')
      expect(quality).toHaveProperty('maSlope')
      expect(quality).toHaveProperty('compositeScore')
      expect(quality.kaufmanER).toBeGreaterThanOrEqual(0)
      expect(quality.kaufmanER).toBeLessThanOrEqual(1)
      expect(quality.adx).toBeGreaterThanOrEqual(0)
      expect(quality.compositeScore).toBeGreaterThanOrEqual(0)
      expect(quality.compositeScore).toBeLessThanOrEqual(100)
    })
  })
})
