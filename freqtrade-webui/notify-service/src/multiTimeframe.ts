import { calculateMA } from './shared/indicators.js'
import { calculateRSI } from './entryMetrics.js'
import type { ScanResult } from './types.js'

export type LowerPhase = 'pullback' | 'reversal' | 'overshoot' | 'neutral'

/**
 * 检测小周期是否在回调中（逆小势入场）
 * long 回调: RSI < 30 且 pullbackAtr >= minPullback 且价格在 MA20 上方
 * short 回调: RSI > 70 且 pullbackAtr >= minPullback 且价格在 MA20 下方
 */
function isPullback(
  data: string[][],
  direction: ScanResult['direction'],
  pullbackAtr: number,
  minPullback: number,
  rsi?: number
): boolean {
  if (direction === 'neutral' || pullbackAtr < minPullback || !rsi) return false
  const currentPrice = Number(data[data.length - 1][1])
  const ma20 = Number(calculateMA(data, 20)[data.length - 1])
  if (!Number.isFinite(ma20)) return false

  if (direction === 'long') {
    return rsi < 30 && currentPrice > ma20
  }
  return rsi > 70 && currentPrice < ma20
}

function detectLowerPhase(
  data: string[][],
  higherDirection: ScanResult['direction'],
  pullbackAtr: number,
  minPullback: number,
  rsi?: number
): LowerPhase {
  if (higherDirection === 'neutral' || data.length < 21) return 'neutral'

  // 检查是否在回调
  if (isPullback(data, higherDirection, pullbackAtr, minPullback, rsi)) {
    return 'pullback'
  }

  // 保留原有的 reversal 检测逻辑（兼容性）
  const fast = calculateMA(data, 5).map(Number)
  const slow = calculateMA(data, 20).map(Number)
  const last = data.length - 1
  const previous = last - 1
  const bullishCross = fast[previous] <= slow[previous] && fast[last] > slow[last]
  const bearishCross = fast[previous] >= slow[previous] && fast[last] < slow[last]
  const currentClose = Number(data[last][1])
  const recentFast = fast.slice(Math.max(0, last - 5), last)
  const hadCounterMove = higherDirection === 'long'
    ? recentFast.some(value => value <= slow[last])
    : recentFast.some(value => value >= slow[last])
  const resumed = higherDirection === 'long'
    ? bullishCross || (hadCounterMove && currentClose > slow[last])
    : bearishCross || (hadCounterMove && currentClose < slow[last])

  if (resumed) return 'reversal'

  // overshoot: 价格超调（背离大周期方向且未回调到位）
  if (higherDirection === 'long' && currentClose < slow[last]) return 'overshoot'
  if (higherDirection === 'short' && currentClose > slow[last]) return 'overshoot'

  return 'neutral'
}

export function lowerTimeframePhase(data: string[][], direction: ScanResult['direction']): LowerPhase {
  if (direction === 'neutral' || data.length < 21) return 'neutral'
  const fast = calculateMA(data, 5).map(Number)
  const slow = calculateMA(data, 20).map(Number)
  const last = data.length - 1
  const previous = last - 1
  const bullishCross = fast[previous] <= slow[previous] && fast[last] > slow[last]
  const bearishCross = fast[previous] >= slow[previous] && fast[last] < slow[last]
  const currentClose = Number(data[last][1])
  const recentFast = fast.slice(Math.max(0, last - 5), last)
  const hadCounterMove = direction === 'long'
    ? recentFast.some(value => value <= slow[last])
    : recentFast.some(value => value >= slow[last])
  const resumed = direction === 'long' ? bullishCross || (hadCounterMove && currentClose > slow[last]) : bearishCross || (hadCounterMove && currentClose < slow[last])
  if (resumed) return 'reversal'
  if (hadCounterMove) return 'pullback'
  return 'neutral'
}

export function evaluateMultiTimeframe(
  higher: ScanResult,
  lower: ScanResult,
  lowerCandles: string[][],
  minHigherTrendScore: number,
  minHigherTrendQuality?: number,
  pullbackAtrMin?: number,
  lowerPullbackAtr?: number,
  lowerRsi?: number
): { passed: boolean; detail: string; phase: LowerPhase } {
  const minQuality = minHigherTrendQuality ?? 60
  const minPullback = pullbackAtrMin ?? 0.8

  // 优先使用趋势质量评分，fallback 到旧的 trendScore
  const higherQualityValid = higher.trendQuality
    ? higher.trendQuality.compositeScore >= minQuality
    : higher.trendScore >= minHigherTrendScore

  const phase = detectLowerPhase(
    lowerCandles,
    higher.direction,
    lowerPullbackAtr ?? 0,
    minPullback,
    lowerRsi
  )

  const higherValid = higher.direction !== 'neutral' && higherQualityValid
  const lowerValid = phase === 'pullback'
  const passed = higherValid && lowerValid

  const qualityDesc = higher.trendQuality
    ? `质量 ${higher.trendQuality.compositeScore.toFixed(0)}`
    : `评分 ${higher.trendScore}`

  return {
    passed,
    phase,
    detail: `4H ${higher.direction} ${qualityDesc}；1H ${phase}${lowerPullbackAtr ? ` 回调${lowerPullbackAtr.toFixed(1)}ATR` : ''}${lowerRsi ? ` RSI${lowerRsi.toFixed(0)}` : ''}`,
  }
}
