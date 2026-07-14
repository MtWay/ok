import { ref } from 'vue'
import type { TrendScanResult } from '../types'

const STORAGE_KEY = 'trendscan_positions'

export interface Position {
  id: string
  pair: string
  timeframe: string
  direction: 'long' | 'short'
  entryPrice: number
  entryTime: number
  entryTrendScore: number
  entryGridScore: number
  entryStrategyRecommendation: 'trend' | 'grid' | 'mixed' | 'avoid'
  entryStopLossWide: number
  status: 'open' | 'closed'
  closedTime?: number
  lastReview?: PositionReview
}

export interface PositionReview {
  reviewTime: number
  currentPrice: number
  currentTrendScore: number
  currentGridScore: number
  scoreDelta: number
  suggestion: 'hold' | 'reduce' | 'close'
  reasons: string[]
}

export function usePositions() {
  const positions = ref<Position[]>([])

  function loadPositions(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        positions.value = JSON.parse(stored)
      }
    } catch (e) {
      console.error('Failed to load positions from localStorage:', e)
      positions.value = []
    }
  }

  function savePositions(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions.value))
    } catch (e) {
      console.error('Failed to save positions to localStorage:', e)
    }
  }

  function addPosition(result: TrendScanResult): void {
    const id = `${result.pair}-${result.timeframe}-${Date.now()}`
    const newPosition: Position = {
      id,
      pair: result.pair,
      timeframe: result.timeframe,
      direction: result.direction === 'short' ? 'short' : 'long',
      entryPrice: result.currentPrice,
      entryTime: Date.now(),
      entryTrendScore: result.trendScore,
      entryGridScore: result.gridScore,
      entryStrategyRecommendation: result.strategyRecommendation,
      entryStopLossWide: result.stopLossWide,
      status: 'open'
    }
    positions.value.push(newPosition)
    savePositions()
  }

  function closePosition(positionId: string): void {
    const position = positions.value.find(p => p.id === positionId)
    if (position) {
      position.status = 'closed'
      position.closedTime = Date.now()
      savePositions()
    }
  }

  return {
    positions,
    addPosition,
    closePosition,
    loadPositions,
    savePositions
  }
}
