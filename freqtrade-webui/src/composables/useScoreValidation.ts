import { ref } from 'vue'
import { useBacktest } from './useBacktest'

export interface ScoreValidationResult {
  pair: string
  timeframe: string
  totalWindows: number
  frontendScore: {
    avgScore: number
    correlation: number
    highScoreWinRate: number
    highScoreAvgReturn: number
    lowScoreFilterAccuracy: number
  }
  backendScore: {
    avgScore: number
    correlation: number
    highScoreWinRate: number
    highScoreAvgReturn: number
    lowScoreFilterAccuracy: number
  }
  winner: 'frontend' | 'backend' | 'tie'
}

export interface WindowScoreRecord {
  windowIndex: number
  timestamp: string
  frontendScore: number
  backendScore: number
  actualReturn: number
  isWin: boolean
}

export function useScoreValidation() {
  const { calculateMA, calculateADX, runBacktestWithParams, calculateSignalScore, getCurrentSignal } = useBacktest()
  const validationResults = ref<ScoreValidationResult[]>([])
  const isValidating = ref(false)

  // 计算后端趋势评分（移植自 notify-service/src/shared/trendScore.ts）
  function calculateBackendTrendScore(data: string[][]): number {
    const alignment = calculateMAAlignment(data)
    const adxSeries = calculateADX(data, 14)
    const adx = adxSeries[adxSeries.length - 1] || 0
    const efficiencyRatio = calculateEfficiencyRatio(data, 20)
    const volatilityState = calculateVolatilityState(data)

    let score = 0
    score += alignment.strength * 35
    score += (Math.min(adx, 50) / 50) * 30
    score += efficiencyRatio * 25

    if (alignment.direction !== 'neutral' && efficiencyRatio < 0.3) {
      score -= 15
    }
    if (volatilityState === 'elevated') {
      score -= 10
    }

    return Math.max(0, Math.min(100, Math.round(score)))
  }

  // MA排列强度计算
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

  // 效率比计算
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

  // ATR 计算
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

  // 波动状态计算
  function calculateVolatilityState(data: string[][]): 'normal' | 'elevated' {
    const atrSeries = calculateATR(data, 14)
    const current = atrSeries[atrSeries.length - 1]
    const history = atrSeries.slice(0, -1)
    if (history.length < 20) return 'normal'

    const sorted = [...history].sort((a, b) => a - b)
    const rank = sorted.filter(v => v <= current).length
    const percentile = rank / sorted.length

    return percentile >= 0.9 ? 'elevated' : 'normal'
  }

  // 计算两个数组的相关系数
  function calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0

    const n = x.length
    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = y.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0)
    const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0)
    const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0)

    const numerator = n * sumXY - sumX * sumY
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

    return denominator === 0 ? 0 : numerator / denominator
  }

  // 主验证函数
  async function validateScores(
    pair: string,
    timeframe: string,
    data: string[][],
    dates: string[],
    optimizeWindow: number,
    predictWindow: number
  ): Promise<ScoreValidationResult | null> {
    const minDataSize = optimizeWindow + predictWindow + 100
    if (data.length < minDataSize) {
      console.warn(`Insufficient data for ${pair} ${timeframe}: ${data.length} < ${minDataSize}`)
      return null
    }

    const windowRecords: WindowScoreRecord[] = []
    let currentIndex = optimizeWindow

    while (currentIndex + predictWindow <= data.length) {
      // 回测窗口数据
      const optimizeData = data.slice(currentIndex - optimizeWindow, currentIndex)
      const optimizeDates = dates.slice(currentIndex - optimizeWindow, currentIndex)

      // 在回测窗口上运行回测获取历史统计
      const backtestResult = runBacktestWithParams(
        optimizeDates,
        optimizeData,
        10, // maFast
        30, // maSlow
        20, // adxThreshold
        0.02, // stopLoss
        0.05, // takeProfit
        10000, // initialCapital
        10000, // stakeAmount
        true, // enableShort
        false // reverseSignals
      )

      // 计算当前窗口末尾的两种评分
      const { trendSignal, signalAge, currentAdx } = getCurrentSignal(optimizeData, 10, 30)

      // 前端评分(基于回测统计)
      const frontendScore = calculateSignalScore({
        trendSignal,
        signalAge,
        adx: currentAdx,
        winRate: backtestResult.winRate,
        maxDrawdown: backtestResult.maxDrawdown,
        totalReturn: backtestResult.totalReturn,
        trades: backtestResult.trades
      }).score

      // 后端评分(基于市场状态)
      const backendScore = calculateBackendTrendScore(optimizeData)

      // 计算预测窗口的实际收益
      const entryPrice = parseFloat(data[currentIndex][1])
      const exitPrice = parseFloat(data[currentIndex + predictWindow - 1][1])
      const actualReturn = (exitPrice - entryPrice) / entryPrice

      windowRecords.push({
        windowIndex: Math.floor((currentIndex - optimizeWindow) / predictWindow),
        timestamp: dates[currentIndex],
        frontendScore,
        backendScore,
        actualReturn,
        isWin: actualReturn > 0
      })

      currentIndex += predictWindow
    }

    if (windowRecords.length === 0) return null

    // 提取数组用于统计计算
    const frontendScores = windowRecords.map(r => r.frontendScore)
    const backendScores = windowRecords.map(r => r.backendScore)
    const actualReturns = windowRecords.map(r => r.actualReturn)

    // 计算相关系数
    const frontendCorrelation = calculateCorrelation(frontendScores, actualReturns)
    const backendCorrelation = calculateCorrelation(backendScores, actualReturns)

    // 高分(≥70)胜率和平均收益
    const frontendHighScoreRecords = windowRecords.filter(r => r.frontendScore >= 70)
    const backendHighScoreRecords = windowRecords.filter(r => r.backendScore >= 70)

    const frontendHighScoreWinRate = frontendHighScoreRecords.length > 0
      ? frontendHighScoreRecords.filter(r => r.isWin).length / frontendHighScoreRecords.length
      : 0
    const backendHighScoreWinRate = backendHighScoreRecords.length > 0
      ? backendHighScoreRecords.filter(r => r.isWin).length / backendHighScoreRecords.length
      : 0

    const frontendHighScoreAvgReturn = frontendHighScoreRecords.length > 0
      ? frontendHighScoreRecords.reduce((sum, r) => sum + r.actualReturn, 0) / frontendHighScoreRecords.length
      : 0
    const backendHighScoreAvgReturn = backendHighScoreRecords.length > 0
      ? backendHighScoreRecords.reduce((sum, r) => sum + r.actualReturn, 0) / backendHighScoreRecords.length
      : 0

    // 低分(≤30)过滤准确率(低分时避免交易的准确性)
    const frontendLowScoreRecords = windowRecords.filter(r => r.frontendScore <= 30)
    const backendLowScoreRecords = windowRecords.filter(r => r.backendScore <= 30)

    const frontendLowScoreFilterAccuracy = frontendLowScoreRecords.length > 0
      ? frontendLowScoreRecords.filter(r => !r.isWin).length / frontendLowScoreRecords.length
      : 0
    const backendLowScoreFilterAccuracy = backendLowScoreRecords.length > 0
      ? backendLowScoreRecords.filter(r => !r.isWin).length / backendLowScoreRecords.length
      : 0

    // 判断胜者(优先相关系数,次看高分胜率)
    let winner: 'frontend' | 'backend' | 'tie'
    const corrDiff = Math.abs(frontendCorrelation - backendCorrelation)
    if (corrDiff > 0.1) {
      winner = frontendCorrelation > backendCorrelation ? 'frontend' : 'backend'
    } else {
      const wrDiff = Math.abs(frontendHighScoreWinRate - backendHighScoreWinRate)
      if (wrDiff > 0.1) {
        winner = frontendHighScoreWinRate > backendHighScoreWinRate ? 'frontend' : 'backend'
      } else {
        winner = 'tie'
      }
    }

    return {
      pair,
      timeframe,
      totalWindows: windowRecords.length,
      frontendScore: {
        avgScore: frontendScores.reduce((a, b) => a + b, 0) / frontendScores.length,
        correlation: frontendCorrelation,
        highScoreWinRate: frontendHighScoreWinRate,
        highScoreAvgReturn: frontendHighScoreAvgReturn,
        lowScoreFilterAccuracy: frontendLowScoreFilterAccuracy
      },
      backendScore: {
        avgScore: backendScores.reduce((a, b) => a + b, 0) / backendScores.length,
        correlation: backendCorrelation,
        highScoreWinRate: backendHighScoreWinRate,
        highScoreAvgReturn: backendHighScoreAvgReturn,
        lowScoreFilterAccuracy: backendLowScoreFilterAccuracy
      },
      winner
    }
  }

  // 计算前端置信度 (基于回测统计质量)
  function calculateFrontendConfidence(params: {
    trades: number
    winRate: number
    maxDrawdown: number
    signalAge: number
  }): number {
    const { trades, winRate, maxDrawdown, signalAge } = params
    let confidence = 0.5 // 基础置信度

    // 交易次数充足性 (最重要)
    if (trades >= 20) confidence += 0.3
    else if (trades >= 10) confidence += 0.15
    else if (trades < 5) confidence -= 0.3

    // 胜率可靠性
    if (winRate > 0.55 && winRate < 0.75) confidence += 0.15
    else if (winRate > 0.5) confidence += 0.05
    else if (winRate < 0.4) confidence -= 0.1

    // 回撤控制
    if (maxDrawdown < 0.15) confidence += 0.1
    else if (maxDrawdown < 0.2) confidence += 0.05
    else if (maxDrawdown > 0.3) confidence -= 0.15

    // 信号新鲜度
    if (signalAge <= 5) confidence += 0.1
    else if (signalAge <= 10) confidence += 0.05
    else if (signalAge > 20) confidence -= 0.1

    return Math.max(0, Math.min(1, confidence))
  }

  // 计算后端置信度 (基于市场状态清晰度)
  function calculateBackendConfidence(data: string[][]): number {
    const alignment = calculateMAAlignment(data)
    const efficiencyRatio = calculateEfficiencyRatio(data, 20)
    const adxSeries = calculateADX(data, 14)
    const adx = adxSeries[adxSeries.length - 1] || 0

    let confidence = 0.5 // 基础置信度

    // MA 排列清晰度
    if (alignment.strength === 1.0) confidence += 0.25
    else if (alignment.strength >= 0.67) confidence += 0.15
    else if (alignment.strength < 0.34) confidence -= 0.15

    // 趋势效率
    if (efficiencyRatio > 0.6) confidence += 0.2
    else if (efficiencyRatio > 0.4) confidence += 0.1
    else if (efficiencyRatio < 0.25) confidence -= 0.15

    // ADX 强度
    if (adx > 30) confidence += 0.15
    else if (adx > 20) confidence += 0.05
    else if (adx < 15) confidence -= 0.1

    return Math.max(0, Math.min(1, confidence))
  }

  // 计算混合评分 (置信度加权集成)
  function calculateHybridScore(params: {
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
      // 两者置信度都为 0 时，取平均
      score = (frontendScore + backendScore) / 2
    }

    // 安全层：两者置信度都很低时施加惩罚
    if (frontendConfidence < 0.3 && backendConfidence < 0.3) {
      score *= 0.7
    }

    // 判断整体置信度等级
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

  return {
    validationResults,
    isValidating,
    validateScores,
    calculateFrontendConfidence,
    calculateBackendConfidence,
    calculateHybridScore
  }
}
