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

  function evaluatePosition(position: Position, fresh: TrendScanResult): PositionReview {
    const scoreDelta = fresh.trendScore - position.entryTrendScore
    let suggestion: 'hold' | 'reduce' | 'close' = 'hold'
    const reasons: string[] = []

    // 规则1: 方向翻转
    if (fresh.direction !== 'neutral' && fresh.direction !== position.direction) {
      suggestion = 'close'
      reasons.push('趋势方向已反转')
    }

    // 规则2: 评分大幅走弱
    if (scoreDelta <= -30) {
      suggestion = 'close'
      reasons.push('趋势评分较建仓时下降超过30分')
    } else if (scoreDelta <= -15) {
      if (suggestion === 'hold') suggestion = 'reduce'
      reasons.push('趋势评分较建仓时下降超过15分')
    }

    // 规则3: 价格触及止损位
    const currentPrice = fresh.currentPrice
    const stopLossWide = position.entryStopLossWide
    const stopLossHit = position.direction === 'long'
      ? currentPrice <= stopLossWide
      : currentPrice >= stopLossWide

    if (stopLossHit) {
      suggestion = 'close'
      reasons.push('价格已触及建仓时的宽止损位')
    }

    // 无命中规则时给默认原因
    if (reasons.length === 0) {
      reasons.push('评分与建仓时相比无明显恶化')
    }

    return {
      reviewTime: Date.now(),
      currentPrice: fresh.currentPrice,
      currentTrendScore: fresh.trendScore,
      currentGridScore: fresh.gridScore,
      scoreDelta,
      suggestion,
      reasons
    }
  }

  function reviewPosition(positionId: string, review: PositionReview): void {
    const position = positions.value.find(p => p.id === positionId)
    if (position) {
      position.lastReview = review
      savePositions()
    }
  }

  return {
    positions,
    addPosition,
    closePosition,
    evaluatePosition,
    reviewPosition,
    loadPositions,
    savePositions
  }
}
