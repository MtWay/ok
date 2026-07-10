import { useBacktest } from './useBacktest'
import type { TrendScanEntry } from '../types'

const { calculateMA, calculateADX } = useBacktest()

// ATR(period)，Wilder 平滑
function calculateATR(data: string[][], period = 14): number[] {
  const atr: number[] = []
  const trueRanges: number[] = []

  for (let i = 0; i < data.length; i++) {
    const high = parseFloat(data[i][3])
    const low = parseFloat(data[i][2])
    if (i === 0) {
      trueRanges.push(high - low)
      atr.push(trueRanges[0])
      continue
    }
    const prevClose = parseFloat(data[i - 1][1])
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trueRanges.push(tr)

    if (i < period) {
      const sum = trueRanges.slice(0, i + 1).reduce((a, b) => a + b, 0)
      atr.push(sum / (i + 1))
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period)
    }
  }

  return atr
}

// Kaufman 效率比：|close[i]-close[i-period]| / sum(|close[j]-close[j-1]|)
function calculateEfficiencyRatio(data: string[][], period = 20): number {
  const i = data.length - 1
  if (i < period) return 0

  const closeNow = parseFloat(data[i][1])
  const closeStart = parseFloat(data[i - period][1])
  const netChange = Math.abs(closeNow - closeStart)

  let pathSum = 0
  for (let j = i - period + 1; j <= i; j++) {
    pathSum += Math.abs(parseFloat(data[j][1]) - parseFloat(data[j - 1][1]))
  }

  return pathSum > 0 ? netChange / pathSum : 0
}

// MA5/10/20/50 排列方向与强度（strength: 0~1，完全排列为 1）
function calculateMAAlignment(data: string[][]): { direction: 'long' | 'short' | 'neutral'; strength: number } {
  const ma5 = calculateMA(data, 5)
  const ma10 = calculateMA(data, 10)
  const ma20 = calculateMA(data, 20)
  const ma50 = calculateMA(data, 50)
  const i = data.length - 1

  const v5 = parseFloat(ma5[i])
  const v10 = parseFloat(ma10[i])
  const v20 = parseFloat(ma20[i])
  const v50 = parseFloat(ma50[i])

  if ([v5, v10, v20, v50].some(v => isNaN(v))) {
    return { direction: 'neutral', strength: 0 }
  }

  const bullPairs = [v5 > v10, v10 > v20, v20 > v50].filter(Boolean).length
  const bearPairs = [v5 < v10, v10 < v20, v20 < v50].filter(Boolean).length

  if (bullPairs === 0 && bearPairs === 0) return { direction: 'neutral', strength: 0 }
  if (bullPairs >= bearPairs) return { direction: 'long', strength: bullPairs / 3 }
  return { direction: 'short', strength: bearPairs / 3 }
}

// ATR 相对自身历史分位数，>=90 分位视为异常偏高
function calculateVolatilityState(atrSeries: number[]): 'normal' | 'elevated' {
  const current = atrSeries[atrSeries.length - 1]
  const history = atrSeries.slice(0, -1)
  if (history.length < 20) return 'normal'

  const sorted = [...history].sort((a, b) => a - b)
  const rank = sorted.filter(v => v <= current).length
  const percentile = rank / sorted.length

  return percentile >= 0.9 ? 'elevated' : 'normal'
}

export interface TrendQualityResult {
  score: number
  direction: 'long' | 'short' | 'neutral'
  level: 'strong' | 'moderate' | 'weak' | 'neutral'
  action: string
  adx: number
  efficiencyRatio: number
  volatilityState: 'normal' | 'elevated'
}

export function calculateTrendQuality(data: string[][]): TrendQualityResult {
  const alignment = calculateMAAlignment(data)
  const adxSeries = calculateADX(data, 14)
  const adx = adxSeries[adxSeries.length - 1] || 0
  const efficiencyRatio = calculateEfficiencyRatio(data, 20)
  const atrSeries = calculateATR(data, 14)
  const volatilityState = calculateVolatilityState(atrSeries)

  let score = 0
  score += alignment.strength * 35
  score += (Math.min(adx, 50) / 50) * 30
  score += efficiencyRatio * 25

  // 均线排列有方向但效率比很低：趋势不干净，扣分而非报错
  if (alignment.direction !== 'neutral' && efficiencyRatio < 0.3) {
    score -= 15
  }
  if (volatilityState === 'elevated') {
    score -= 10
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let level: 'strong' | 'moderate' | 'weak' | 'neutral'
  let action: string
  if (score >= 70) {
    level = 'strong'
    action = '趋势稳定，适合操作'
  } else if (score >= 50) {
    level = 'moderate'
    action = '趋势尚可，谨慎参与'
  } else if (score >= 30) {
    level = 'weak'
    action = '趋势尚可，谨慎参与'
  } else {
    level = 'neutral'
    action = '趋势不明，观望'
  }

  return { score, direction: alignment.direction, level, action, adx, efficiencyRatio, volatilityState }
}

interface SwingPoint {
  index: number
  price: number
  type: 'high' | 'low'
  touchCount: number
}

// 局部极值 + 后续被触碰/受阻次数过滤，过滤掉随手就有的噪声摆动点
function findSwingPoints(data: string[][], lookback: number, fractalWidth = 3): SwingPoint[] {
  const start = Math.max(fractalWidth, data.length - lookback)
  const highs = data.map(d => parseFloat(d[3]))
  const lows = data.map(d => parseFloat(d[2]))
  const candidates: SwingPoint[] = []

  for (let i = start; i < data.length - fractalWidth; i++) {
    const windowHighs = highs.slice(i - fractalWidth, i + fractalWidth + 1)
    const windowLows = lows.slice(i - fractalWidth, i + fractalWidth + 1)
    if (highs[i] === Math.max(...windowHighs)) {
      candidates.push({ index: i, price: highs[i], type: 'high', touchCount: 0 })
    }
    if (lows[i] === Math.min(...windowLows)) {
      candidates.push({ index: i, price: lows[i], type: 'low', touchCount: 0 })
    }
  }

  const tolerance = 0.003
  for (const point of candidates) {
    for (let j = point.index + 1; j < data.length; j++) {
      const high = highs[j]
      const low = lows[j]
      if (point.type === 'high' && high >= point.price * (1 - tolerance) && high < point.price * 1.01) {
        point.touchCount++
      } else if (point.type === 'low' && low <= point.price * (1 + tolerance) && low > point.price * 0.99) {
        point.touchCount++
      }
    }
  }

  return candidates.filter(p => p.touchCount >= 1)
}

// 统计该品种历史上"刺穿摆动点又收回"的插针幅度，取 80 分位作为缓冲依据
function calculatePierceDepth(data: string[][], swingPoints: SwingPoint[]): number {
  const depths: number[] = []

  for (const point of swingPoints) {
    for (let j = point.index + 1; j < data.length; j++) {
      const high = parseFloat(data[j][3])
      const low = parseFloat(data[j][2])
      const close = parseFloat(data[j][1])
      if (point.type === 'high' && high > point.price && close < point.price) {
        depths.push((high - point.price) / point.price)
      } else if (point.type === 'low' && low < point.price && close > point.price) {
        depths.push((point.price - low) / point.price)
      }
    }
  }

  if (depths.length === 0) return 0
  depths.sort((a, b) => a - b)
  const idx = Math.min(Math.floor(depths.length * 0.8), depths.length - 1)
  return depths[idx]
}

export interface SwingSLTPResult {
  stopLossTight: number
  stopLossWide: number
  takeProfit: number
  closeConfirmPrice: number
  riskRewardTight: number
  riskRewardWide: number
  isSwingBased: boolean
  trailingStopPercent: number
}

export function calculateSwingSLTP(data: string[][], direction: 'long' | 'short'): SwingSLTPResult {
  const currentPrice = parseFloat(data[data.length - 1][1])
  const atrSeries = calculateATR(data, 14)
  const currentAtr = atrSeries[atrSeries.length - 1] || currentPrice * 0.02

  const lookback = Math.min(150, data.length - 10)
  const swingPoints = lookback > 10 ? findSwingPoints(data, lookback) : []
  const stopType = direction === 'long' ? 'low' : 'high'
  const targetType = direction === 'long' ? 'high' : 'low'
  const stopCandidates = swingPoints.filter(p => p.type === stopType)
  const targetCandidates = swingPoints.filter(p => p.type === targetType)

  // 离当前价最近的、方向正确一侧的摆动点
  let stopBase: number | null = null
  for (const p of stopCandidates) {
    const isOnCorrectSide = direction === 'long' ? p.price < currentPrice : p.price > currentPrice
    if (!isOnCorrectSide) continue
    if (stopBase === null || Math.abs(p.price - currentPrice) < Math.abs(stopBase - currentPrice)) {
      stopBase = p.price
    }
  }

  const pierceDepthRatio = calculatePierceDepth(data, stopCandidates)
  const minBuffer = currentAtr * 0.3
  const wideBuffer = Math.max(currentAtr * 2.5, pierceDepthRatio * currentPrice)

  let stopLossTight: number
  let stopLossWide: number
  let isSwingBased: boolean

  if (stopBase !== null) {
    isSwingBased = true
    stopLossTight = direction === 'long' ? stopBase - minBuffer : stopBase + minBuffer
    stopLossWide = direction === 'long' ? stopBase - wideBuffer : stopBase + wideBuffer
  } else {
    isSwingBased = false
    stopLossTight = direction === 'long' ? currentPrice - currentAtr * 2 : currentPrice + currentAtr * 2
    stopLossWide = direction === 'long' ? currentPrice - currentAtr * 3 : currentPrice + currentAtr * 3
  }

  let takeProfit: number | null = null
  for (const p of targetCandidates) {
    const isOnCorrectSide = direction === 'long' ? p.price > currentPrice : p.price < currentPrice
    if (!isOnCorrectSide) continue
    if (takeProfit === null || Math.abs(p.price - currentPrice) < Math.abs(takeProfit - currentPrice)) {
      takeProfit = p.price
    }
  }
  if (takeProfit === null) {
    takeProfit = direction === 'long' ? currentPrice + currentAtr * 3 : currentPrice - currentAtr * 3
  }

  const closeConfirmPrice = stopLossWide

  const riskTight = Math.abs(currentPrice - stopLossTight)
  const riskWide = Math.abs(currentPrice - stopLossWide)
  const reward = Math.abs(takeProfit - currentPrice)

  // 移动止损建议：2倍ATR占当前价的百分比，随行情波动自动跟踪，不依赖固定摆动点
  const trailingStopPercent = currentPrice > 0 ? (currentAtr * 2 / currentPrice) * 100 : 0

  return {
    stopLossTight,
    stopLossWide,
    takeProfit,
    closeConfirmPrice,
    riskRewardTight: riskTight > 0 ? reward / riskTight : 0,
    riskRewardWide: riskWide > 0 ? reward / riskWide : 0,
    isSwingBased,
    trailingStopPercent
  }
}

const MIN_CANDLES_REQUIRED = 100

export function scoreSymbol(pair: string, timeframe: string, data: string[][], isRealData: boolean): TrendScanEntry {
  if (data.length < MIN_CANDLES_REQUIRED) {
    return { pair, timeframe, insufficientData: true }
  }

  const quality = calculateTrendQuality(data)
  const sltpDirection = quality.direction === 'neutral' ? 'long' : quality.direction
  const sltp = calculateSwingSLTP(data, sltpDirection)

  return {
    pair,
    timeframe,
    trendScore: quality.score,
    direction: quality.direction,
    level: quality.level,
    action: quality.action,
    adx: quality.adx,
    efficiencyRatio: quality.efficiencyRatio,
    volatilityState: quality.volatilityState,
    stopLossTight: sltp.stopLossTight,
    stopLossWide: sltp.stopLossWide,
    takeProfit: sltp.takeProfit,
    closeConfirmPrice: sltp.closeConfirmPrice,
    riskRewardTight: sltp.riskRewardTight,
    riskRewardWide: sltp.riskRewardWide,
    isSwingBased: sltp.isSwingBased,
    trailingStopPercent: sltp.trailingStopPercent,
    isRealData,
    insufficientData: false
  }
}
