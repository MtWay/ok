import type { PositionState, MaCrossParams, TurtlePositionParams, BollingerParams, GridParams, PivotPositionParams } from './types.js'
import { calculateMA, calculateATR, calculateADX } from './shared/indicators.js'

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

// ---- MA Cross ----

export function detectMaCross(ctx: SignalContext, params: MaCrossParams): SignalAction {
  const { candles, state } = ctx
  if (candles.length < params.slowPeriod + 2) return { type: 'none' }

  const maFast = calculateMA(candles, params.fastPeriod)
  const maSlow = calculateMA(candles, params.slowPeriod)

  const lastIdx = candles.length - 1
  const prevIdx = lastIdx - 1

  const fastNow = parseFloat(maFast[lastIdx])
  const fastPrev = parseFloat(maFast[prevIdx])
  const slowNow = parseFloat(maSlow[lastIdx])
  const slowPrev = parseFloat(maSlow[prevIdx])

  if (!isFinite(fastNow) || !isFinite(slowNow) || !isFinite(fastPrev) || !isFinite(slowPrev)) {
    return { type: 'none' }
  }

  const crossedAbove = fastPrev <= slowPrev && fastNow > slowNow
  const crossedBelow = fastPrev >= slowPrev && fastNow < slowNow

  // Optional ADX filter for entry
  if (params.adxFilter) {
    const adx = calculateADX(candles, params.adxPeriod ?? 14)
    const adxVal = adx[lastIdx] ?? 0
    if (adxVal < (params.adxThreshold ?? 25)) {
      return { type: 'none' }
    }
  }

  const close = parseFloat(candles[lastIdx][1])
  const atr = calculateATR(candles, 14)
  const atrVal = atr[lastIdx] ?? close * 0.02

  if (crossedAbove && state.status === 'flat') {
    const stopPrice = close - 2 * atrVal
    const risk = close - stopPrice
    return {
      type: 'entry', side: 'long', price: close, stopPrice,
      takeProfit1: close + 2 * risk,
      takeProfit2: close + 3 * risk,
      reason: 'ma_cross_up'
    }
  }

  if (crossedBelow && state.status === 'flat') {
    const stopPrice = close + 2 * atrVal
    const risk = stopPrice - close
    return {
      type: 'entry', side: 'short', price: close, stopPrice,
      takeProfit1: close - 2 * risk,
      takeProfit2: close - 3 * risk,
      reason: 'ma_cross_down'
    }
  }

  if (crossedBelow && state.status === 'long') {
    return { type: 'exit', reason: 'ma_cross_down' }
  }

  if (crossedAbove && state.status === 'short') {
    return { type: 'exit', reason: 'ma_cross_up' }
  }

  return { type: 'none' }
}

// ---- Turtle ----

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

export function detectTurtle(ctx: SignalContext, params: TurtlePositionParams): SignalAction {
  const { candles, state } = ctx
  const lastIdx = candles.length - 1
  if (lastIdx < params.entryBars + 1) return { type: 'none' }

  const entryCh = donchian(candles, params.entryBars, lastIdx)
  const exitCh = donchian(candles, params.exitBars, lastIdx)
  const atr = calculateATR(candles, params.atrPeriod)
  const atrVal = atr[lastIdx - 1] ?? atr[lastIdx] ?? 1

  const high = parseFloat(candles[lastIdx][3])
  const low = parseFloat(candles[lastIdx][2])
  const close = parseFloat(candles[lastIdx][1])

  const units = state.units ?? []

  // Check exit first
  if (state.status === 'long' && close < exitCh.low) {
    return { type: 'exit', reason: 'channel_exit' }
  }
  if (state.status === 'short' && close > exitCh.high) {
    return { type: 'exit', reason: 'channel_exit' }
  }

  // Check add (pyramiding)
  if (units.length > 0 && units.length < params.maxUnits) {
    const lastUnit = units[units.length - 1]
    const step = params.unitStepAtr * atrVal

    if (state.status === 'long' && high >= lastUnit.price + step) {
      const price = Math.max(parseFloat(candles[lastIdx][0]), lastUnit.price + step)
      const allPrices = units.map(u => u.price).concat(price)
      const avgEntry = allPrices.reduce((a, b) => a + b, 0) / allPrices.length
      const stopPrice = price - params.stopAtr * atrVal
      return { type: 'add', side: 'long', price, stopPrice, reason: 'pyramid_add', unitIndex: units.length }
    }
    if (state.status === 'short' && low <= lastUnit.price - step) {
      const price = Math.min(parseFloat(candles[lastIdx][0]), lastUnit.price - step)
      const stopPrice = price + params.stopAtr * atrVal
      return { type: 'add', side: 'short', price, stopPrice, reason: 'pyramid_add', unitIndex: units.length }
    }
  }

  // Check entry
  if (state.status === 'flat') {
    if (high > entryCh.high) {
      const price = Math.max(parseFloat(candles[lastIdx][0]), entryCh.high)
      const stopPrice = price - params.stopAtr * atrVal
      const risk = price - stopPrice
      return {
        type: 'entry', side: 'long', price, stopPrice,
        takeProfit1: price + 2 * risk,
        takeProfit2: price + 3 * risk,
        reason: 'breakout_up'
      }
    }
    if (low < entryCh.low) {
      const price = Math.min(parseFloat(candles[lastIdx][0]), entryCh.low)
      const stopPrice = price + params.stopAtr * atrVal
      const risk = stopPrice - price
      return {
        type: 'entry', side: 'short', price, stopPrice,
        takeProfit1: price - 2 * risk,
        takeProfit2: price - 3 * risk,
        reason: 'breakout_down'
      }
    }
  }

  return { type: 'none' }
}

// ---- Bollinger ----

function bollingerBands(candles: string[][], period: number, stdDevMult: number, endIdx: number) {
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

export function detectBollinger(ctx: SignalContext, params: BollingerParams): SignalAction {
  const { candles, state } = ctx
  const lastIdx = candles.length - 1
  if (lastIdx < params.period + 1) return { type: 'none' }

  const bands = bollingerBands(candles, params.period, params.stdDev, lastIdx)
  if (!bands) return { type: 'none' }

  const close = parseFloat(candles[lastIdx][1])
  const low = parseFloat(candles[lastIdx][2])
  const atr = calculateATR(candles, 14)
  const atrVal = atr[lastIdx] ?? close * 0.02

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
      : price - 2 * atrVal
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

  const { upperPrice, lowerPrice, gridCount } = params
  const step = (upperPrice - lowerPrice) / gridCount
  if (step <= 0) return []

  const close = parseFloat(candles[lastIdx][1])
  const prevClose = parseFloat(candles[lastIdx - 1][1])
  const actions: SignalAction[] = []

  const gridLevels = state.gridLevels ?? []
  const occupiedLevels = new Set(gridLevels.map(gl => gl.level))

  // Check each grid level for entry (price crosses downward)
  for (let k = gridCount; k >= 1; k--) {
    const levelPrice = lowerPrice + k * step
    if (occupiedLevels.has(k)) continue

    if (prevClose > levelPrice && close <= levelPrice) {
      actions.push({
        type: 'grid_entry', side: 'long', price: levelPrice,
        stopPrice: lowerPrice,
        takeProfit1: levelPrice + step,
        level: k,
        reason: `grid_entry_l${k}`
      })
    }
  }

  // Check existing positions for exit (price rises one step)
  for (const gl of gridLevels) {
    const tpPrice = gl.price + step
    if (prevClose < tpPrice && close >= tpPrice) {
      actions.push({
        type: 'grid_exit', level: gl.level, price: tpPrice,
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
  const { pivotPeriod, threshold, stopPercent } = params
  if (lastIdx < pivotPeriod + 1) return { type: 'none' }

  const thresholdFrac = threshold / 100
  const stopFrac = stopPercent / 100

  const start = Math.max(0, lastIdx - pivotPeriod)
  let hi = -Infinity, lo = Infinity
  for (let j = start; j < lastIdx; j++) {
    hi = Math.max(hi, parseFloat(candles[j][3]))
    lo = Math.min(lo, parseFloat(candles[j][2]))
  }
  const close = parseFloat(candles[lastIdx - 1][1])
  const pp = (hi + lo + close) / 3
  const s1 = 2 * pp - hi
  const s2 = pp - (hi - lo)
  const r1 = 2 * pp - lo
  const r2 = pp + (hi - lo)

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
