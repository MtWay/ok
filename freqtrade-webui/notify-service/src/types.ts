export interface NotifyTask {
  id: string
  name: string
  enabled: boolean
  email: string
  emailEnabled?: boolean
  interval: '15m' | '1h' | '4h' | '12h' | '24h'
  filters: {
    minTrendScore: number
    minRiskReward: number
    maxTrailingStop: number
    minOptionalHits?: number
    optionalRules?: {
      maDistance?: { enabled: boolean; maxAtr: number }
      pullback?: { enabled: boolean; minAtr: number }
      supportResistance?: { enabled: boolean; maxAtr: number }
      trendScore?: { enabled: boolean; min: number }
      riskReward?: { enabled: boolean; min: number }
      trailingStop?: { enabled: boolean; maxPercent: number }
    }
    multiTimeframe?: {
      enabled: boolean
      higherTimeframe: string
      lowerTimeframe: string
      minHigherTrendScore: number
    }
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
  ruleChecks?: Array<{ id: string; label: string; passed: boolean; detail: string; hard?: boolean }>
  hardRulesPassed?: number
  optionalRulesPassed?: number
  optionalRulesTotal?: number
  multiTimeframe?: {
    higherTimeframe: string
    higherDirection: 'long' | 'short' | 'neutral'
    higherTrendScore: number
    lowerTimeframe: string
    lowerPhase: 'pullback' | 'reversal' | 'trend' | 'neutral'
  }
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

export interface ScanHistoryEntry {
  id: string
  taskId: string
  taskName: string
  trigger: 'manual' | 'scheduled'
  startedAt: number
  completedAt: number
  resultCount: number
  pairs: string[]
  error?: string
}
