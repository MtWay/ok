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
  currentPrice: number
}

export interface GridQualityResult {
  score: number
  rangeUpper: number
  rangeLower: number
  rangeAmplitude: number
  stability: number
  suggestedCount: number
  profitPerGrid: number
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
    trailingStopPercent,
    currentPrice
  }
}

// 计算网格交易适配性
export function calculateGridQuality(data: string[][]): GridQualityResult {
  const lookback = Math.min(90, data.length)
  const recent = data.slice(-lookback)

  // 计算价格范围（支撑阻力）
  const closes = recent.map(d => parseFloat(d[1]))

  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length

  // 使用 20/80 分位作为区间边界（过滤极端值）
  const sortedCloses = [...closes].sort((a, b) => a - b)
  const p20Index = Math.floor(sortedCloses.length * 0.2)
  const p80Index = Math.floor(sortedCloses.length * 0.8)
  const rangeLower = sortedCloses[p20Index]
  const rangeUpper = sortedCloses[p80Index]
  const rangeAmplitude = ((rangeUpper - rangeLower) / avgPrice) * 100

  // 计算震荡稳定性：价格在区间内的时间占比
  let inRangeCount = 0
  for (const close of closes) {
    if (close >= rangeLower && close <= rangeUpper) {
      inRangeCount++
    }
  }
  const stability = inRangeCount / closes.length

  // 计算突破后回归次数（假突破）
  let falseBreakouts = 0
  for (let i = 1; i < recent.length; i++) {
    const prevClose = parseFloat(recent[i - 1][1])
    const currHigh = parseFloat(recent[i][3])
    const currLow = parseFloat(recent[i][2])
    const currClose = parseFloat(recent[i][1])

    // 向上假突破：高点突破上界但收盘回到区间内
    if (currHigh > rangeUpper && currClose < rangeUpper && prevClose < rangeUpper) {
      falseBreakouts++
    }
    // 向下假突破：低点跌破下界但收盘回到区间内
    if (currLow < rangeLower && currClose > rangeLower && prevClose > rangeLower) {
      falseBreakouts++
    }
  }
  const falseBreakoutRate = falseBreakouts / lookback

  // 计算 ADX（低 ADX 表示无趋势，适合网格）
  const adxSeries = calculateADX(data, 14)
  const adx = adxSeries[adxSeries.length - 1] || 25

  // 计算波动率（ATR/价格）
  const atrSeries = calculateATR(data, 14)
  const currentAtr = atrSeries[atrSeries.length - 1] || avgPrice * 0.02
  const volatilityPercent = (currentAtr / avgPrice) * 100

  // 网格评分逻辑
  let score = 0

  // 1. 低 ADX 加分（无趋势）：ADX < 20 最佳
  if (adx < 15) score += 30
  else if (adx < 20) score += 25
  else if (adx < 25) score += 15
  else if (adx < 30) score += 5
  else score -= 10 // ADX 太高扣分

  // 2. 高震荡稳定性加分
  score += stability * 30

  // 3. 假突破率加分（频繁假突破说明区间有效）
  if (falseBreakoutRate > 0.15) score += 20
  else if (falseBreakoutRate > 0.1) score += 15
  else if (falseBreakoutRate > 0.05) score += 10
  else score += 5

  // 4. 振幅适中加分（3%-15% 最佳）
  if (rangeAmplitude >= 3 && rangeAmplitude <= 6) score += 15
  else if (rangeAmplitude > 6 && rangeAmplitude <= 10) score += 10
  else if (rangeAmplitude > 10 && rangeAmplitude <= 15) score += 5
  else if (rangeAmplitude < 3) score -= 10 // 振幅太小，网格利润低
  else if (rangeAmplitude > 20) score -= 15 // 振幅太大，风险高

  // 5. 波动率适中加分（1%-3% 最佳）
  if (volatilityPercent >= 1 && volatilityPercent <= 3) score += 5
  else if (volatilityPercent > 3 && volatilityPercent <= 5) score += 3
  else if (volatilityPercent > 5) score -= 5

  score = Math.max(0, Math.min(100, Math.round(score)))

  // 建议网格数：振幅越大，网格数可以越多
  let suggestedCount = 10
  if (rangeAmplitude < 3) suggestedCount = 5
  else if (rangeAmplitude < 6) suggestedCount = 8
  else if (rangeAmplitude < 10) suggestedCount = 12
  else if (rangeAmplitude < 15) suggestedCount = 15
  else suggestedCount = 20

  // 单网格利润 = 振幅 / 网格数 - 手续费 (假设 0.1% 双边)
  const profitPerGrid = (rangeAmplitude / suggestedCount) - 0.2

  return {
    score,
    rangeUpper,
    rangeLower,
    rangeAmplitude,
    stability,
    suggestedCount,
    profitPerGrid
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
  const grid = calculateGridQuality(data)

  // 策略推荐逻辑
  let strategyRecommendation: 'trend' | 'grid' | 'mixed' | 'avoid'
  if (quality.score >= 60 && grid.score < 40) {
    strategyRecommendation = 'trend'
  } else if (grid.score >= 60 && quality.score < 40) {
    strategyRecommendation = 'grid'
  } else if (quality.score < 30 && grid.score < 30) {
    strategyRecommendation = 'avoid'
  } else {
    strategyRecommendation = 'mixed'
  }

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
    currentPrice: sltp.currentPrice,
    isRealData,
    insufficientData: false,
    // 网格交易相关
    gridScore: grid.score,
    gridRangeUpper: grid.rangeUpper,
    gridRangeLower: grid.rangeLower,
    gridRangeAmplitude: grid.rangeAmplitude,
    gridStability: grid.stability,
    gridSuggestedCount: grid.suggestedCount,
    gridProfitPerGrid: grid.profitPerGrid,
    strategyRecommendation
  }
}
