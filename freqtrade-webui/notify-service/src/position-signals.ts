import type { PositionState, MaCrossParams, TurtlePositionParams, BollingerParams, GridParams, PivotPositionParams } from './types.js'
import {
  computeMaCrossIndicators, computeTurtleIndicators,
  computeBollingerBands, computeGridBounds, gridLevelPrice,
  computePivotBands,
} from './position-indicators.js'
import { calculateATR, calculateADX } from './shared/indicators.js'

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

export function detectGrid(ctx: SignalContext, params: GridParams): SignalAction[] {
  const { candles, state } = ctx
  const lastIdx = candles.length - 1
  if (lastIdx < 2) return []

  const bounds = computeGridBounds(candles, params)
  if (!bounds) return []

  const close = parseFloat(candles[lastIdx][1])
  const prevClose = parseFloat(candles[lastIdx - 1][1])
  const actions: SignalAction[] = []

  const gridLevels = state.gridLevels ?? []
  const occupiedLevels = new Set(gridLevels.map(gl => gl.level))
  const maxLevels = params.maxLevels ?? params.gridCount

  // 趋势过滤：ADX > 25 认为是趋势行情，暂停入场
  const trendFilter = params.trendFilter ?? true
  let isTrending = false
  if (trendFilter && lastIdx >= 14) {
    const adx = calculateADX(candles, 14)[lastIdx] ?? 0
    isTrending = adx > 25
  }

  // 检查价格向下穿越各网格线，触发开仓
  // 趋势行情中暂停入场，避免在单边行情中不断加仓
  if (!isTrending && gridLevels.length < maxLevels) {
    for (let k = params.gridCount; k >= 1; k--) {
      const levelPrice = gridLevelPrice(bounds, params.gridCount, k)
      if (occupiedLevels.has(k)) continue

      if (prevClose > levelPrice && close <= levelPrice) {
        const stopPercent = params.stopPercent ?? 2
        const stopPrice = levelPrice * (1 - stopPercent / 100)
        actions.push({
          type: 'grid_entry', side: 'long', price: levelPrice,
          stopPrice,
          takeProfit1: levelPrice + bounds.step,
          level: k,
          reason: `grid_entry_l${k}`
        })
      }
    }
  }

  // 检查持仓是否触及止盈（用建仓时锁定的 tpPrice，兼容旧数据回退到 price+step）
  for (const gl of gridLevels) {
    const tp = gl.tpPrice ?? (gl.price + bounds.step)
    if (prevClose < tp && close >= tp) {
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
