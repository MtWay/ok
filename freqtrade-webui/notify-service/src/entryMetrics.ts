import { calculateMA } from './shared/indicators.js'
import type { ScanResult } from './types.js'

export interface EntryMetrics {
  maDistanceAtr: number
  pullbackAtr: number
  structureDistanceAtr?: number
}

function calculateAtr(data: string[][], period = 14): number {
  const start = Math.max(1, data.length - period)
  let total = 0
  for (let index = start; index < data.length; index++) {
    const high = Number(data[index][3])
    const low = Number(data[index][2])
    const previousClose = Number(data[index - 1][1])
    total += Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose))
  }
  return total / Math.max(1, data.length - start)
}

function pullbackAtr(data: string[][], direction: ScanResult['direction'], currentAtr: number): number {
  if (direction === 'neutral' || currentAtr <= 0) return 0
  const window = data.slice(Math.max(0, data.length - 21))
  if (direction === 'long') {
    const highIndex = window.reduce((best, candle, index) => Number(candle[3]) > Number(window[best][3]) ? index : best, 0)
    return Math.max(0, Number(window[highIndex][3]) - Math.min(...window.slice(highIndex).map(candle => Number(candle[2])))) / currentAtr
  }
  const lowIndex = window.reduce((best, candle, index) => Number(candle[2]) < Number(window[best][2]) ? index : best, 0)
  return Math.max(0, Math.max(...window.slice(lowIndex).map(candle => Number(candle[3]))) - Number(window[lowIndex][2])) / currentAtr
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
  const currentAtr = calculateAtr(data)
  const currentPrice = Number(data[data.length - 1][1])
  const ma20 = Number(calculateMA(data, 20)[data.length - 1])
  return {
    maDistanceAtr: currentAtr > 0 && Number.isFinite(ma20) ? Math.abs(currentPrice - ma20) / currentAtr : Infinity,
    pullbackAtr: pullbackAtr(data, direction, currentAtr),
    structureDistanceAtr: structureDistanceAtr(data, direction, currentPrice, currentAtr),
  }
}
