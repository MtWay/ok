import type { PositionState, MaCrossParams, TurtlePositionParams, BollingerParams, GridParams, PivotPositionParams } from './types.js'
import {
  computeMaCrossIndicators, computeTurtleIndicators,
  computeBollingerBands, computeGridBounds, gridLevelPrice,
  computePivotBands,
} from './position-indicators.js'
import { calculateATR } from './shared/indicators.js'

export interface SignalContext {
  candles: string[][]  // [open, close, low, high, volume], oldest → newest
  state: PositionState
  now: number
}

export type SignalAction =
  | { type: 'entry'; side: 'long' | 'short'; price: number; stopPrice: number; takeProfit1: number; takeProfit2: number; reason: string }
  | { type: 'add'; side: 'long' | 'short'; price: number; stopPrice: number; reason: string; unitIndex: number }
  | { type: 'exit'; reason: string }
  | { type: 'grid_entry'; side: 'long'; price: number; stopPrice: number; takeProfit1: number; level: number; reason: string }
  | { type: 'grid_exit'; level: number; price: number; reason: string }
  | { type: 'none' }

// 每个 detect* 的数值都取自 position-indicators 的 compute*Indicators —— 与
// 前端卡片上展示的快照同源。改动策略参数时只改 indicators 那一处。

// ---- MA Cross ----

export function detectMaCross(ctx: SignalContext, params: MaCrossParams): SignalAction {
  const { candles, state } = ctx
  if (candles.length < params.slowPeriod + 2) return { type: 'none' }

  const ind = computeMaCrossIndicators(candles, params, state)

  // Optional ADX filter for entry
  if (params.adxFilter && ind.adx < (params.adxThreshold ?? 25)) {
    return { type: 'none' }
  }

  if (ind.cross === 'golden' && state.status === 'flat') {
    return {
      type: 'entry', side: 'long', price: ind.close, stopPrice: ind.stopPrice,
      takeProfit1: ind.takeProfit1, takeProfit2: ind.takeProfit2,
      reason: 'ma_cross_up',
    }
  }

  if (ind.cross === 'dead' && state.status === 'flat') {
    return {
      type: 'entry', side: 'short', price: ind.close, stopPrice: ind.stopPrice,
      takeProfit1: ind.takeProfit1, takeProfit2: ind.takeProfit2,
      reason: 'ma_cross_down',
    }
  }

  if (ind.cross === 'dead' && state.status === 'long') {
    return { type: 'exit', reason: 'ma_cross_down' }
  }

  if (ind.cross === 'golden' && state.status === 'short') {
    return { type: 'exit', reason: 'ma_cross_up' }
  }

  return { type: 'none' }
}

// ---- Turtle ----

export function detectTurtle(ctx: SignalContext, params: TurtlePositionParams): SignalAction {
  const { candles, state } = ctx
  const lastIdx = candles.length - 1
  if (lastIdx < params.entryBars + 1) return { type: 'none' }

  const ind = computeTurtleIndicators(candles, params, state)
  const { high, low, close, atr, entryHigh, entryLow, exitHigh, exitLow } = ind

  const units = state.units ?? []

  // Check exit first
  if (state.status === 'long' && close < exitLow) {
    return { type: 'exit', reason: 'channel_exit' }
  }
  if (state.status === 'short' && close > exitHigh) {
    return { type: 'exit', reason: 'channel_exit' }
  }

  // Check add (pyramiding)
  if (units.length > 0 && units.length < params.maxUnits) {
    const lastUnit = units[units.length - 1]
    const step = ind.unitStep

    if (state.status === 'long' && high >= lastUnit.price + step) {
      const price = Math.max(parseFloat(candles[lastIdx][0]), lastUnit.price + step)
      const stopPrice = price - params.stopAtr * atr
      return { type: 'add', side: 'long', price, stopPrice, reason: 'pyramid_add', unitIndex: units.length }
    }
    if (state.status === 'short' && low <= lastUnit.price - step) {
      const price = Math.min(parseFloat(candles[lastIdx][0]), lastUnit.price - step)
      const stopPrice = price + params.stopAtr * atr
      return { type: 'add', side: 'short', price, stopPrice, reason: 'pyramid_add', unitIndex: units.length }
    }
  }

  // Check entry
  if (state.status === 'flat') {
    if (high > entryHigh) {
      const price = Math.max(parseFloat(candles[lastIdx][0]), entryHigh)
      const stopPrice = price - params.stopAtr * atr
      const risk = price - stopPrice
      return {
        type: 'entry', side: 'long', price, stopPrice,
        takeProfit1: price + 2 * risk,
        takeProfit2: price + 3 * risk,
        reason: 'breakout_up',
      }
    }
    if (low < entryLow) {
      const price = Math.min(parseFloat(candles[lastIdx][0]), entryLow)
      const stopPrice = price + params.stopAtr * atr
      const risk = stopPrice - price
      return {
        type: 'entry', side: 'short', price, stopPrice,
        takeProfit1: price - 2 * risk,
        takeProfit2: price - 3 * risk,
        reason: 'breakout_down',
      }
    }
  }

  return { type: 'none' }
}

// ---- Bollinger ----

export function detectBollinger(ctx: SignalContext, params: BollingerParams): SignalAction {
  const { candles, state } = ctx
  const lastIdx = candles.length - 1
  if (lastIdx < params.period + 1) return { type: 'none' }

  const bands = computeBollingerBands(candles, params.period, params.stdDev, lastIdx)
  if (!bands) return { type: 'none' }

  const close = parseFloat(candles[lastIdx][1])
  const low = parseFloat(candles[lastIdx][2])
  const atr = calculateATR(candles, 14)[lastIdx] ?? close * 0.02

  // Exit: return to middle band
  if (state.status === 'long' && close >= bands.middle) {
    return { type: 'exit', reason: 'bollinger_middle' }
  }

  // Optional stop loss
  if (state.status === 'long' && params.stopLossPct) {
    const entryPrice = state.entryPrice ?? 0
    if (close < entryPrice * (1 - params.stopLossPct / 100)) {
      return { type: 'exit', reason: 'stop_loss' }
    }
  }

  // Entry: touch lower band
  if (state.status === 'flat' && low <= bands.lower) {
    const price = bands.lower
    const stopPrice = params.stopLossPct
      ? price * (1 - params.stopLossPct / 100)
      : price - 2 * atr
    const risk = price - stopPrice
    return {
      type: 'entry', side: 'long', price, stopPrice,
      takeProfit1: bands.middle,
      takeProfit2: bands.upper,
      reason: 'bollinger_lower_touch'
    }
  }

  return { type: 'none' }
}

// ---- Grid ----

/**
 * 网格单格步长下限（%）：一格的预期收益至少要盖过往返 taker 手续费
 * （0.05%×2 = 0.1%）加滑点缓冲（0.2%）。步长不足时开仓即负期望，
 * 表现为止盈触发却亏损成交。杠杆对两边同比例缩放、比较时约掉，
 * 所以这里用价格百分比口径。与前端回测 runGridBacktest 保持一致。
 */
export const GRID_MIN_STEP_PERCENT = 0.3

/** |slope| 超过此值（%/bar）判定为趋势行情，网格暂停入场。 */
export const GRID_TREND_SLOPE_PERCENT = 0.1

/**
 * lookback 窗口收盘价线性回归斜率（%/bar）。窗口必须与回测
 * （runGridBacktest 用整个 lookback 窗口回归）一致，用更短的窗口会让
 * 斜率噪声变大，两边 isTrending 判定不一致。窗口不足 20 根返回 0。
 */
export function gridSlopePercent(candles: string[][], lookback: number): number {
  const lastIdx = candles.length - 1
  const trendWindow = Math.min(lookback, lastIdx + 1)
  if (trendWindow < 20) return 0
  const recentCloses: number[] = []
  for (let j = lastIdx - trendWindow + 1; j <= lastIdx; j++) recentCloses.push(parseFloat(candles[j][1]))
  const n = recentCloses.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let j = 0; j < n; j++) {
    sumX += j
    sumY += recentCloses[j]
    sumXY += j * recentCloses[j]
    sumX2 += j * j
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const avgPrice = sumY / n
  if (avgPrice === 0) return 0
  return Math.abs(slope / avgPrice * 100)
}

export function detectGrid(ctx: SignalContext, params: GridParams): SignalAction[] {
  const { candles, state } = ctx
  const lastIdx = candles.length - 1
  if (lastIdx < 2) return []

  const bounds = computeGridBounds(candles, params)
  if (!bounds) return []

  const o = parseFloat(candles[lastIdx][0])
  const h = parseFloat(candles[lastIdx][3])
  const l = parseFloat(candles[lastIdx][2])
  const prevClose = parseFloat(candles[lastIdx - 1][1])
  const actions: SignalAction[] = []

  const gridLevels = state.gridLevels ?? []
  const occupiedLevels = new Set(gridLevels.map(gl => gl.level))
  const maxLevels = params.maxLevels ?? params.gridCount

  // 趋势过滤：lookback 窗口收盘价线性回归斜率 > 0.1%/bar 认为是趋势行情。
  const trendFilter = params.trendFilter ?? true
  const isTrending = trendFilter && gridSlopePercent(candles, params.lookback) > GRID_TREND_SLOPE_PERCENT

  // 检查价格向下触及各网格线，触发开仓（低点触及即成交，与回测对齐）
  // 趋势行情中暂停入场，避免在单边行情中不断加仓
  const minStepPercent = params.minStepPercent ?? GRID_MIN_STEP_PERCENT
  if (!isTrending && gridLevels.length < maxLevels) {
    for (let k = params.gridCount; k >= 1; k--) {
      const levelPrice = gridLevelPrice(bounds, params.gridCount, k)
      if (occupiedLevels.has(k)) continue
      // 预期收益校验：一格步长盖不住手续费+滑点时跳过（步长全格共享，
      // 被挡时所有层一起挡，不存在"换一层开"）
      if (bounds.step / levelPrice * 100 < minStepPercent) continue

      if (prevClose > levelPrice && l <= levelPrice) {
        const fill = Math.min(o, levelPrice)
        const stopPercent = params.stopPercent ?? 2
        const stopPrice = fill * (1 - stopPercent / 100)
        actions.push({
          type: 'grid_entry', side: 'long', price: fill,
          stopPrice,
          takeProfit1: levelPrice + bounds.step,
          level: k,
          reason: `grid_entry_l${k}`
        })
      }
    }
  }

  // 检查持仓是否触及止盈（高点触及即成交，与回测对齐）
  for (const gl of gridLevels) {
    const tp = gl.tpPrice ?? (gl.price + bounds.step)
    if (h >= tp) {
      actions.push({
        type: 'grid_exit', level: gl.level, price: tp,
        reason: `grid_tp_l${gl.level}`
      })
    }
  }

  return actions
}

// ---- Pivot Range Reversal ----

export function detectPivot(ctx: SignalContext, params: PivotPositionParams): SignalAction {
  const { candles, state } = ctx
  const lastIdx = candles.length - 1
  if (lastIdx < params.pivotPeriod + 1) return { type: 'none' }

  const bands = computePivotBands(candles, params.pivotPeriod, lastIdx)
  if (!bands) return { type: 'none' }
  const { pp, s1, s2, r1, r2 } = bands

  const thresholdFrac = params.threshold / 100
  const stopFrac = params.stopPercent / 100

  const o = parseFloat(candles[lastIdx][0])
  const h = parseFloat(candles[lastIdx][3])
  const l = parseFloat(candles[lastIdx][2])

  if (state.status === 'long') {
    const stopPrice = (state.entryPrice ?? 0) * (1 - stopFrac)
    if (l <= stopPrice) return { type: 'exit', reason: 'pivot_stop' }
    if (h >= r1) return { type: 'exit', reason: 'pivot_tp' }
    return { type: 'none' }
  }

  if (state.status === 'short') {
    const stopPrice = (state.entryPrice ?? 0) * (1 + stopFrac)
    if (h >= stopPrice) return { type: 'exit', reason: 'pivot_stop' }
    if (l <= s1) return { type: 'exit', reason: 'pivot_tp' }
    return { type: 'none' }
  }

  const nearS1 = l <= s1 * (1 + thresholdFrac) && l >= s2 * (1 - thresholdFrac)
  const nearS2 = l <= s2 * (1 + thresholdFrac)
  const nearR1 = h >= r1 * (1 - thresholdFrac) && h <= r2 * (1 + thresholdFrac)
  const nearR2 = h >= r2 * (1 - thresholdFrac)

  if (nearS2) {
    const fill = Math.min(o, s2)
    return { type: 'entry', side: 'long', price: fill, stopPrice: fill * (1 - stopFrac), takeProfit1: pp, takeProfit2: r1, reason: 'pivot_S2' }
  }
  if (nearS1) {
    const fill = Math.min(o, s1)
    return { type: 'entry', side: 'long', price: fill, stopPrice: fill * (1 - stopFrac), takeProfit1: pp, takeProfit2: r1, reason: 'pivot_S1' }
  }
  if (nearR2) {
    const fill = Math.max(o, r2)
    return { type: 'entry', side: 'short', price: fill, stopPrice: fill * (1 + stopFrac), takeProfit1: pp, takeProfit2: s1, reason: 'pivot_R2' }
  }
  if (nearR1) {
    const fill = Math.max(o, r1)
    return { type: 'entry', side: 'short', price: fill, stopPrice: fill * (1 + stopFrac), takeProfit1: pp, takeProfit2: s1, reason: 'pivot_R1' }
  }

  return { type: 'none' }
}
