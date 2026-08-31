import { calculateATR, calculateMA } from './shared/indicators.js'
import type { ScanResult } from './types.js'

export interface EntryMetrics {
  maDistanceAtr: number
  pullbackAtr: number
  structureDistanceAtr?: number
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

export function calculateEntryMetrics(data: string[][], direction: ScanResult['direction']): EntryMetrics {
  const atrSeries = calculateATR(data)
  const currentAtr = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : 0
  const currentPrice = Number(data[data.length - 1][1])
  const ma20 = Number(calculateMA(data, 20)[data.length - 1])
  return {
    maDistanceAtr: currentAtr > 0 && Number.isFinite(ma20) ? Math.abs(currentPrice - ma20) / currentAtr : Infinity,
    pullbackAtr: pullbackAtr(data, direction, currentPrice, currentAtr),
    structureDistanceAtr: structureDistanceAtr(data, direction, currentPrice, currentAtr),
  }
}
