import { calculateATR, calculateMA } from './shared/indicators.js'
import type { ScanResult } from './types.js'

export interface EntryMetrics {
  maDistanceAtr: number
  pullbackAtr: number
  structureDistanceAtr?: number
  chandelierStop?: number
  chandelierStopAtr?: number
  rsi?: number
}

// 当前价相对最近窗口极值的回撤深度（单位：ATR）。
// long：从窗口最高点回落了多少；short：从窗口最低点反弹了多少。
// 只衡量"当下"的回撤，价格已反弹/回落回去时不会再误判为回调中。
function pullbackAtr(data: string[][], direction: ScanResult['direction'], currentPrice: number, currentAtr: number): number {
  if (direction === 'neutral' || currentAtr <= 0) return 0
  const window = data.slice(Math.max(0, data.length - 21))
  if (direction === 'long') {
    const highest = Math.max(...window.map(candle => Number(candle[3])))
    return Math.max(0, highest - currentPrice) / currentAtr
  }
  const lowest = Math.min(...window.map(candle => Number(candle[2])))
  return Math.max(0, currentPrice - lowest) / currentAtr
}

function structureDistanceAtr(data: string[][], direction: ScanResult['direction'], currentPrice: number, currentAtr: number): number | undefined {
  if (direction === 'neutral' || currentAtr <= 0 || data.length < 9) return undefined
  const indexField = direction === 'long' ? 2 : 3
  const candidates: number[] = []
  for (let index = Math.max(3, data.length - 100); index < data.length - 3; index++) {
    const price = Number(data[index][indexField])
    const neighbors = data.slice(index - 3, index + 4).map(candle => Number(candle[indexField]))
    const isSwing = direction === 'long' ? price === Math.min(...neighbors) : price === Math.max(...neighbors)
    if (isSwing && (direction === 'long' ? price <= currentPrice : price >= currentPrice)) candidates.push(price)
  }
  return candidates.length ? Math.min(...candidates.map(price => Math.abs(currentPrice - price))) / currentAtr : undefined
}

// RSI(14) 计算：标准 Wilder 平滑
export function calculateRSI(data: string[][], period = 14): number[] {
  const rsi: number[] = []
  const changes: number[] = []

  for (let i = 1; i < data.length; i++) {
    changes.push(Number(data[i][1]) - Number(data[i - 1][1]))
  }

  if (changes.length < period) {
    return data.map(() => 50)
  }

  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period

  rsi.push(50) // 第一根
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }

  return rsi
}

// Chandelier Exit: long = highest(N) - multiplier×ATR, short = lowest(N) + multiplier×ATR
export function calculateChandelierStop(
  data: string[][],
  direction: ScanResult['direction'],
  atr: number,
  lookback = 20,
  multiplier = 3
): number | undefined {
  if (direction === 'neutral' || atr <= 0 || data.length < lookback) return undefined
  const window = data.slice(-lookback)
  if (direction === 'long') {
    const highest = Math.max(...window.map(c => Number(c[3])))
    return highest - multiplier * atr
  }
  const lowest = Math.min(...window.map(c => Number(c[2])))
  return lowest + multiplier * atr
}

export function calculateEntryMetrics(data: string[][], direction: ScanResult['direction']): EntryMetrics {
  const atrSeries = calculateATR(data)
  const currentAtr = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : 0
  const currentPrice = Number(data[data.length - 1][1])
  const ma20 = Number(calculateMA(data, 20)[data.length - 1])
  const rsiSeries = calculateRSI(data)
  const chandelierStop = calculateChandelierStop(data, direction, currentAtr)

  return {
    maDistanceAtr: currentAtr > 0 && Number.isFinite(ma20) ? Math.abs(currentPrice - ma20) / currentAtr : Infinity,
    pullbackAtr: pullbackAtr(data, direction, currentPrice, currentAtr),
    structureDistanceAtr: structureDistanceAtr(data, direction, currentPrice, currentAtr),
    rsi: rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1] : undefined,
    chandelierStop,
    chandelierStopAtr: chandelierStop !== undefined && currentAtr > 0 ? Math.abs(currentPrice - chandelierStop) / currentAtr : undefined,
  }
}
