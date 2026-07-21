export interface NotifyTask {
  id: string
  name: string
  enabled: boolean
  email: string
  interval: '1h' | '4h' | '12h' | '24h'
  filters: {
    minTrendScore: number
    minRiskReward: number
    maxTrailingStop: number
  }
  pairs: string[]  // ['BTC-USDT', 'ETH-USDT'] or ['*'] for all
  timeframes: string[]  // ['1H', '4H', '1D']
  lastRun?: number
  lastResult?: {
    count: number
    pairs: string[]
  }
  createdAt: number
  updatedAt: number
  autoApproveSimulation?: boolean
}

export interface TrendScanEntry {
  pair: string
  timeframe: string
  insufficientData: boolean
  trendScore?: number
  direction?: 'long' | 'short' | 'neutral'
  riskRewardTight?: number
  riskRewardWide?: number
  trailingStopPercent?: number
  currentPrice?: number
  stopLossTight?: number
  stopLossWide?: number
  takeProfit?: number
  strategyRecommendation?: 'trend' | 'grid' | 'mixed' | 'avoid'
}

export interface ScanResult extends TrendScanEntry {
  trendScore: number
  direction: 'long' | 'short' | 'neutral'
  riskRewardTight: number
  riskRewardWide: number
  trailingStopPercent: number
  currentPrice: number
  stopLossTight: number
  stopLossWide: number
  takeProfit: number
  strategyRecommendation: 'trend' | 'grid' | 'mixed' | 'avoid'
  insufficientData: false
}
