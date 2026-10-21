import type {
  PositionTask, PositionState, PositionIndicators,
  MaCrossParams, TurtlePositionParams, BollingerParams, GridParams, PivotPositionParams, ConsecutiveCandleParams,
  MaCrossIndicators, TurtleIndicators, BollingerIndicators, GridIndicators, PivotIndicators, ConsecutiveCandleIndicators,
} from './types.js'
import { calculateMA, calculateATR, calculateADX } from './shared/indicators.js'

// 每个 compute*Indicators 同时服务两个用途：detect* 拿它算出的数做判定，
// 调度器把返回值落进 PositionState 供前端展示。两者共用同一份计算，
// 卡上看到的数就是实际触发用的数。

export function computeMaCrossIndicators(
  candles: string[][], params: MaCrossParams, state: PositionState,
): MaCrossIndicators {
  const lastIdx = candles.length - 1
  const prevIdx = Math.max(0, lastIdx - 1)
  const close = parseFloat(candles[lastIdx][1])

  const fast = lastIdx >= params.fastPeriod - 1 ? parseFloat(calculateMA(candles, params.fastPeriod)[lastIdx]) : NaN
  const slow = lastIdx >= params.slowPeriod - 1 ? parseFloat(calculateMA(candles, params.slowPeriod)[lastIdx]) : NaN
  const fastPrev = prevIdx >= params.fastPeriod - 1 ? parseFloat(calculateMA(candles, params.fastPeriod)[prevIdx]) : NaN
  const slowPrev = prevIdx >= params.slowPeriod - 1 ? parseFloat(calculateMA(candles, params.slowPeriod)[prevIdx]) : NaN

  const crossedAbove = fastPrev <= slowPrev && fast > slow
  const crossedBelow = fastPrev >= slowPrev && fast < slow

  const adxPeriod = params.adxPeriod ?? 14
  const adx = calculateADX(candles, adxPeriod)[lastIdx] ?? 0
  const atr = calculateATR(candles, 14)[lastIdx] ?? close * 0.02

  const long = state.status !== 'short'
  const stopPrice = long ? close - 2 * atr : close + 2 * atr
  const risk = long ? close - stopPrice : stopPrice - close

  return {
    kind: 'ma_cross',
    close, fast, slow, fastPrev, slowPrev,
    cross: crossedAbove ? 'golden' : crossedBelow ? 'dead' : 'none',
    adx,
    adxThreshold: params.adxThreshold ?? 25,
    atr,
    stopPrice,
    takeProfit1: long ? close + 2 * risk : close - 2 * risk,
    takeProfit2: long ? close + 3 * risk : close - 3 * risk,
  }
}

export function computeTurtleIndicators(
  candles: string[][], params: TurtlePositionParams, state: PositionState,
): TurtleIndicators {
  const lastIdx = candles.length - 1
  const high = parseFloat(candles[lastIdx][3])
  const low = parseFloat(candles[lastIdx][2])
  const close = parseFloat(candles[lastIdx][1])

  const atr = calculateATR(candles, params.atrPeriod)[lastIdx - 1]
    ?? calculateATR(candles, params.atrPeriod)[lastIdx]
    ?? 1

  const units = state.units ?? []
  const lastUnit = units[units.length - 1]
  const unitStep = params.unitStepAtr * atr
  const long = state.status !== 'short'

  return {
    kind: 'turtle',
    close, high, low,
    entryHigh: donchian(candles, params.entryBars, lastIdx).high,
    entryLow: donchian(candles, params.entryBars, lastIdx).low,
    exitHigh: donchian(candles, params.exitBars, lastIdx).high,
    exitLow: donchian(candles, params.exitBars, lastIdx).low,
    atr,
    lastUnitPrice: lastUnit?.price,
    unitStep,
    nextAddPrice: lastUnit
      ? (long ? lastUnit.price + unitStep : lastUnit.price - unitStep)
      : undefined,
    unitsUsed: units.length,
    maxUnits: params.maxUnits,
    stopPrice: lastUnit
      ? (long ? lastUnit.price - params.stopAtr * atr : lastUnit.price + params.stopAtr * atr)
      : undefined,
  }
}

export interface BollingerBands { middle: number; upper: number; lower: number }

export function computeBollingerBands(
  candles: string[][], period: number, stdDevMult: number, endIdx: number,
): BollingerBands | null {
  const closes: number[] = []
  for (let i = endIdx - period; i < endIdx; i++) {
    if (i < 0) continue
    closes.push(parseFloat(candles[i][1]))
  }
  if (closes.length < period) return null
  const mean = closes.reduce((a, b) => a + b, 0) / period
  const variance = closes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / period
  const stddev = Math.sqrt(variance)
  return { middle: mean, upper: mean + stdDevMult * stddev, lower: mean - stdDevMult * stddev }
}

export function computeBollingerIndicators(
  candles: string[][], params: BollingerParams, state: PositionState,
): BollingerIndicators {
  const lastIdx = candles.length - 1
  const close = parseFloat(candles[lastIdx][1])
  const atr = calculateATR(candles, 14)[lastIdx] ?? close * 0.02
  const bands = computeBollingerBands(candles, params.period, params.stdDev, lastIdx)
    ?? { middle: close, upper: close, lower: close }

  const entryPrice = state.entryPrice ?? bands.lower
  const stopPrice = params.stopLossPct
    ? entryPrice * (1 - params.stopLossPct / 100)
    : bands.lower - 2 * atr

  return {
    kind: 'bollinger',
    close,
    upper: bands.upper,
    middle: bands.middle,
    lower: bands.lower,
    bandwidth: bands.middle !== 0 ? (bands.upper - bands.lower) / bands.middle : 0,
    atr,
    entryTrigger: bands.lower,
    stopPrice,
  }
}

export interface GridBounds { lowerPrice: number; upperPrice: number; step: number }

export function computeGridBounds(candles: string[][], params: GridParams): GridBounds | null {
  const lb = Math.min(params.lookback, candles.length)
  if (lb < 2) return null
  const sorted = candles.slice(-lb).map(c => parseFloat(c[1])).sort((a, b) => a - b)
  const lowerPrice = sorted[Math.floor(sorted.length * 0.2)]
  const upperPrice = sorted[Math.floor(sorted.length * 0.8)]
  const step = (upperPrice - lowerPrice) / params.gridCount
  if (step <= 0) return null
  return { lowerPrice, upperPrice, step }
}

/** 网格层号 k 的成交价；k 从 1 到 gridCount，k=1 最靠近下界。 */
export function gridLevelPrice(bounds: GridBounds, gridCount: number, level: number): number {
  return bounds.lowerPrice + level * ((bounds.upperPrice - bounds.lowerPrice) / gridCount)
}

export function computeGridIndicators(
  candles: string[][], params: GridParams, state: PositionState,
): GridIndicators {
  const lastIdx = candles.length - 1
  const close = parseFloat(candles[lastIdx][1])
  const prevClose = parseFloat(candles[Math.max(0, lastIdx - 1)][1])
  const bounds = computeGridBounds(candles, params) ?? { lowerPrice: close, upperPrice: close, step: 0 }

  const gridLevels = state.gridLevels ?? []
  const occupied = new Set(gridLevels.map(gl => gl.level))

  // 下一层 = 尚未占用的、离当前价最近的那一层。价格下行时先触发高层。
  let nextLevel: number | undefined
  let nextLevelPrice: number | undefined
  for (let k = params.gridCount; k >= 1; k--) {
    if (occupied.has(k)) continue
    nextLevel = k
    nextLevelPrice = gridLevelPrice(bounds, params.gridCount, k)
    break
  }

  return {
    kind: 'grid',
    lookback: params.lookback,
    gridCount: params.gridCount,
    lower: bounds.lowerPrice,
    upper: bounds.upperPrice,
    step: bounds.step,
    close,
    prevClose,
    nextLevel,
    nextLevelPrice,
    levels: gridLevels.map(gl => ({ level: gl.level, price: gl.price, tpPrice: gl.tpPrice })),
  }
}

export interface PivotBands { pp: number; s1: number; s2: number; r1: number; r2: number }

export function computePivotBands(candles: string[][], pivotPeriod: number, endIdx: number): PivotBands | null {
  const start = Math.max(0, endIdx - pivotPeriod)
  let hi = -Infinity, lo = Infinity
  for (let j = start; j < endIdx; j++) {
    hi = Math.max(hi, parseFloat(candles[j][3]))
    lo = Math.min(lo, parseFloat(candles[j][2]))
  }
  if (!isFinite(hi) || !isFinite(lo)) return null
  const close = parseFloat(candles[endIdx - 1][1])
  const pp = (hi + lo + close) / 3
  return {
    pp,
    s1: 2 * pp - hi,
    s2: pp - (hi - lo),
    r1: 2 * pp - lo,
    r2: pp + (hi - lo),
  }
}

export function computePivotIndicators(
  candles: string[][], params: PivotPositionParams, state: PositionState,
): PivotIndicators {
  const lastIdx = candles.length - 1
  const close = parseFloat(candles[lastIdx][1])
  const bands = computePivotBands(candles, params.pivotPeriod, lastIdx)
    ?? { pp: close, s1: close, s2: close, r1: close, r2: close }
  const stopFrac = params.stopPercent / 100
  const entry = state.entryPrice
  // ATR(14) 供利润回吐保护计算自适应移动止损（trailingStopAtrMultiple × ATR%）
  const atr = calculateATR(candles, 14)[lastIdx] ?? close * 0.02

  return {
    kind: 'pivot',
    close,
    atr,
    ...bands,
    thresholdPct: params.threshold,
    stopPct: params.stopPercent,
    stopPrice: entry === undefined ? undefined
      : state.status === 'short' ? entry * (1 + stopFrac) : entry * (1 - stopFrac),
    takeProfitPrice: entry === undefined ? undefined
      : state.status === 'short' ? bands.s1 : bands.r1,
  }
}

export function computeConsecutiveCandleIndicators(
  candles: string[][], params: ConsecutiveCandleParams, state: PositionState,
): ConsecutiveCandleIndicators {
  const lastIdx = candles.length - 1
  const close = parseFloat(candles[lastIdx][1])
  const atrArr = calculateATR(candles, params.atrPeriod)
  const atr = atrArr[lastIdx] ?? close * 0.02

  let bullCount = 0
  let bearCount = 0
  for (let i = lastIdx; i >= 0; i--) {
    const o = parseFloat(candles[i][0])
    const c = parseFloat(candles[i][1])
    if (c > o) {
      if (bearCount > 0) break
      bullCount++
    } else if (c < o) {
      if (bullCount > 0) break
      bearCount++
    } else {
      break
    }
  }

  const direction: 'bullish' | 'bearish' | 'none' =
    bullCount >= params.consecutiveCount ? 'bullish'
    : bearCount >= params.consecutiveCount ? 'bearish'
    : 'none'

  const count = Math.max(bullCount, bearCount)
  const stopDistance = params.stopAtrMult * atr
  const entry = state.entryPrice ?? close
  const stopPrice = state.status === 'long'
    ? entry - stopDistance
    : state.status === 'short'
      ? entry + stopDistance
      : direction === 'bullish'
        ? close - stopDistance
        : close + stopDistance
  const risk = stopDistance
  const takeProfit1 = state.status === 'long'
    ? entry + params.tpRiskMult * risk
    : state.status === 'short'
      ? entry - params.tpRiskMult * risk
      : direction === 'bullish'
        ? close + params.tpRiskMult * risk
        : close - params.tpRiskMult * risk
  const takeProfit2 = state.status === 'long'
    ? takeProfit1 + risk
    : state.status === 'short'
      ? takeProfit1 - risk
      : direction === 'bullish'
        ? takeProfit1 + risk
        : takeProfit1 - risk

  return {
    kind: 'consecutive_candle',
    close,
    consecutiveCount: count,
    direction,
    atr,
    stopPrice,
    takeProfit1,
    takeProfit2,
  }
}

export function computeIndicators(
  task: PositionTask, candles: string[][], state: PositionState,
): PositionIndicators | null {
  if (candles.length < 2) return null
  switch (task.strategy) {
    case 'ma_cross': return computeMaCrossIndicators(candles, task.params as MaCrossParams, state)
    case 'turtle': return computeTurtleIndicators(candles, task.params as TurtlePositionParams, state)
    case 'bollinger': return computeBollingerIndicators(candles, task.params as BollingerParams, state)
    case 'grid': return computeGridIndicators(candles, task.params as GridParams, state)
    case 'pivot': return computePivotIndicators(candles, task.params as PivotPositionParams, state)
    case 'consecutive_candle': return computeConsecutiveCandleIndicators(candles, task.params as ConsecutiveCandleParams, state)
    default: return null
  }
}

function donchian(candles: string[][], period: number, endIdx: number): { high: number; low: number } {
  let high = -Infinity
  let low = Infinity
  for (let i = endIdx - period; i < endIdx; i++) {
    if (i < 0) continue
    const h = parseFloat(candles[i][3])
    const l = parseFloat(candles[i][2])
    if (h > high) high = h
    if (l < low) low = l
  }
  return { high, low }
}
