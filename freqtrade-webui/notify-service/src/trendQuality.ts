import { calculateADX, calculateATR, calculateMA } from './shared/indicators.js'

export interface TrendQuality {
  kaufmanER: number
  adx: number
  maSlope: number
  compositeScore: number
}

/**
 * Kaufman Efficiency Ratio: 净位移 / 总路径长度
 * ER = |close[n] - close[0]| / sum(|close[i] - close[i-1]|)
 * 范围 [0, 1]，值越大表示趋势越流畅
 */
export function calculateKaufmanER(data: string[][], window = 20): number {
  if (data.length < window + 1) return 0
  const slice = data.slice(-window - 1)
  const prices = slice.map(c => Number(c[1]))
  const netChange = Math.abs(prices[prices.length - 1] - prices[0])
  let totalPath = 0
  for (let i = 1; i < prices.length; i++) {
    totalPath += Math.abs(prices[i] - prices[i - 1])
  }
  return totalPath > 0 ? netChange / totalPath : 0
}

/**
 * MA 斜率 (ATR 归一化): (MA_now - MA_10bars_ago) / (10 × ATR)
 * 正值表示上升趋势，负值表示下降趋势
 */
export function calculateMASlope(data: string[][], period = 20, lookback = 10): number {
  if (data.length < period + lookback) return 0
  const maSeries = calculateMA(data, period)
  const atrSeries = calculateATR(data)
  const currentMA = Number(maSeries[maSeries.length - 1])
  const pastMA = Number(maSeries[maSeries.length - 1 - lookback])
  const currentATR = atrSeries[atrSeries.length - 1]
  if (!Number.isFinite(currentMA) || !Number.isFinite(pastMA) || currentATR <= 0) return 0
  return (currentMA - pastMA) / (lookback * currentATR)
}

/**
 * 复合趋势评分: 加权组合 ER、ADX、MA 斜率
 * 公式: 0.4×ER×100 + 0.4×ADX + 0.2×tanh_scaled(slope)
 * tanh_scaled = (1 + tanh(slope)) × 50，将斜率映射到 [0, 100]
 */
export function compositeTrendScore(er: number, adx: number, slope: number): number {
  const tanhScaled = (1 + Math.tanh(slope)) * 50
  return 0.4 * er * 100 + 0.4 * adx + 0.2 * tanhScaled
}

/**
 * 计算趋势质量指标（用于大周期趋势过滤）
 */
export function calculateTrendQuality(data: string[][], erWindow = 20, maPeriod = 20): TrendQuality {
  const kaufmanER = calculateKaufmanER(data, erWindow)
  const adxSeries = calculateADX(data, 14)
  const adx = adxSeries.length > 0 ? adxSeries[adxSeries.length - 1] : 15
  const maSlope = calculateMASlope(data, maPeriod, 10)
  const compositeScore = compositeTrendScore(kaufmanER, adx, maSlope)
  return { kaufmanER, adx, maSlope, compositeScore }
}
