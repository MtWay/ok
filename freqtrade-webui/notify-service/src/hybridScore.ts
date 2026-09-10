import { calculateADX, calculateMA } from './shared/indicators.js'

/**
 * 前端置信度计算 (基于回测统计质量)
 */
export function calculateFrontendConfidence(params: {
  trades: number
  winRate: number
  maxDrawdown: number
  signalAge: number
}): number {
  const { trades, winRate, maxDrawdown, signalAge } = params
  let confidence = 0.5

  if (trades >= 20) confidence += 0.3
  else if (trades >= 10) confidence += 0.15
  else if (trades < 5) confidence -= 0.3

  if (winRate > 0.55 && winRate < 0.75) confidence += 0.15
  else if (winRate > 0.5) confidence += 0.05
  else if (winRate < 0.4) confidence -= 0.1

  if (maxDrawdown < 0.15) confidence += 0.1
  else if (maxDrawdown < 0.2) confidence += 0.05
  else if (maxDrawdown > 0.3) confidence -= 0.15

  if (signalAge <= 5) confidence += 0.1
  else if (signalAge <= 10) confidence += 0.05
  else if (signalAge > 20) confidence -= 0.1

  return Math.max(0, Math.min(1, confidence))
}

/**
 * MA 排列强度计算
 */
function calculateMAAlignment(data: string[][]): { direction: 'long' | 'short' | 'neutral'; strength: number } {
  const ma5 = calculateMA(data, 5)
  const ma10 = calculateMA(data, 10)
  const ma20 = calculateMA(data, 20)
  const ma50 = calculateMA(data, 50)
  const i = data.length - 1

  const v5 = Number(ma5[i])
  const v10 = Number(ma10[i])
  const v20 = Number(ma20[i])
  const v50 = Number(ma50[i])

  if ([v5, v10, v20, v50].some(v => !Number.isFinite(v))) {
    return { direction: 'neutral', strength: 0 }
  }

  const bullPairs = [v5 > v10, v10 > v20, v20 > v50].filter(Boolean).length
  const bearPairs = [v5 < v10, v10 < v20, v20 < v50].filter(Boolean).length

  if (bullPairs === 0 && bearPairs === 0) return { direction: 'neutral', strength: 0 }
  if (bullPairs >= bearPairs) return { direction: 'long', strength: bullPairs / 3 }
  return { direction: 'short', strength: bearPairs / 3 }
}

/**
 * 效率比计算 (Kaufman ER)
 */
function calculateEfficiencyRatio(data: string[][], period = 20): number {
  const i = data.length - 1
  if (i < period) return 0

  const closeNow = Number(data[i][1])
  const closeStart = Number(data[i - period][1])
  const netChange = Math.abs(closeNow - closeStart)

  let pathSum = 0
  for (let j = i - period + 1; j <= i; j++) {
    pathSum += Math.abs(Number(data[j][1]) - Number(data[j - 1][1]))
  }

  return pathSum > 0 ? netChange / pathSum : 0
}

/**
 * 后端置信度计算 (基于市场状态清晰度)
 */
export function calculateBackendConfidence(data: string[][]): number {
  const alignment = calculateMAAlignment(data)
  const efficiencyRatio = calculateEfficiencyRatio(data, 20)
  const adxSeries = calculateADX(data, 14)
  const adx = adxSeries.length > 0 ? adxSeries[adxSeries.length - 1] : 15

  let confidence = 0.5

  if (alignment.strength === 1.0) confidence += 0.25
  else if (alignment.strength >= 0.67) confidence += 0.15
  else if (alignment.strength < 0.34) confidence -= 0.15

  if (efficiencyRatio > 0.6) confidence += 0.2
  else if (efficiencyRatio > 0.4) confidence += 0.1
  else if (efficiencyRatio < 0.25) confidence -= 0.15

  if (adx > 30) confidence += 0.15
  else if (adx > 20) confidence += 0.05
  else if (adx < 15) confidence -= 0.1

  return Math.max(0, Math.min(1, confidence))
}

/**
 * 混合评分计算 (置信度加权集成)
 */
export function calculateHybridScore(params: {
  frontendScore: number
  backendScore: number
  frontendConfidence: number
  backendConfidence: number
}): { score: number; confidenceLevel: 'high' | 'medium' | 'low' } {
  const { frontendScore, backendScore, frontendConfidence, backendConfidence } = params

  const totalConfidence = frontendConfidence + backendConfidence
  let score: number

  if (totalConfidence > 0) {
    score = (frontendScore * frontendConfidence + backendScore * backendConfidence) / totalConfidence
  } else {
    score = (frontendScore + backendScore) / 2
  }

  // 安全层：两者置信度都很低时施加惩罚
  if (frontendConfidence < 0.3 && backendConfidence < 0.3) {
    score *= 0.7
  }

  let confidenceLevel: 'high' | 'medium' | 'low'
  const avgConfidence = totalConfidence / 2
  if (avgConfidence >= 0.7) {
    confidenceLevel = 'high'
  } else if (avgConfidence >= 0.5) {
    confidenceLevel = 'medium'
  } else {
    confidenceLevel = 'low'
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), confidenceLevel }
}
