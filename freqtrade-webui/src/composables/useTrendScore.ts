import { useBacktest } from '@/composables/useBacktest'

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
