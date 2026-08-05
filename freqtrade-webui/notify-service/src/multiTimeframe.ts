import { calculateMA } from './shared/indicators.js'
import type { ScanResult } from './types.js'

export type LowerPhase = 'pullback' | 'reversal' | 'trend' | 'neutral'

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
  return direction === 'long' ? (fast[last] > slow[last] ? 'trend' : 'neutral') : (fast[last] < slow[last] ? 'trend' : 'neutral')
}

export function evaluateMultiTimeframe(
  higher: ScanResult,
  lower: ScanResult,
  lowerCandles: string[][],
  minHigherTrendScore: number,
): { passed: boolean; detail: string; phase: LowerPhase } {
  const phase = lowerTimeframePhase(lowerCandles, higher.direction)
  const higherValid = higher.direction !== 'neutral' && higher.trendScore >= minHigherTrendScore
  const lowerValid = lower.direction === higher.direction && phase === 'reversal'
  const passed = higherValid && lowerValid
  return {
    passed,
    phase,
    detail: `大周期 ${higher.timeframe} ${higher.direction} (${higher.trendScore})；小周期 ${lower.timeframe} ${phase}`,
  }
}
