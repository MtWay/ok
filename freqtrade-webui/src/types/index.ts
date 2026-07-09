// 数据类型定义

export interface CandleData {
  dates: string[]
  data: string[][] // [open, close, low, high, volume]
}

export interface Trade {
  entryIndex: number
  exitIndex: number
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlAmount?: number
  entryTime: string
  exitTime: string
  direction: 'long' | 'short'
  closeReason?: string
  holdingPeriod?: number
  round?: number
}

export interface BacktestResult {
  totalReturn: number
  trades: number
  winRate: number
  maxDrawdown: number
  maFast: number
  maSlow: number
  tradesList: Trade[]
  equityCurve: number[]
}

export interface ScanResult {
  pair: string
  timeframe: string
  maFast: number
  maSlow: number
  totalReturn: number
  trades: number
  winRate: number
  maxDrawdown: number
  trendSignal: 'long' | 'short' | 'neutral'
  signalAge: number
  currentAdx: number
  score: ScoreResult
}

export interface ScoreResult {
  score: number
  action: string
  level: string
}

export interface ValidationRound {
  round: number
  optimizeStart: string
  optimizeEnd: string
  predictStart: string
  predictEnd: string
  params: BacktestResult & {
    trendSignal: string
    signalAge: number
    currentAdx: string
    score: ScoreResult
  }
  signal: {
    trendSignal: string
    signalAge: number
    currentAdx: string
  }
  score: ScoreResult
  scoreValid: boolean
  trade: Trade | null
  capital: number
}

// 用于 ValidateTab 的简化类型
export interface ValidationRoundDetail {
  round: number
  optimizeStart: string
  optimizeEnd: string
  predictStart: string
  predictEnd: string
  params: {
    maFast: number
    maSlow: number
    trendSignal?: string
    signalAge?: number
    currentAdx?: string
    score?: ScoreResult
  }
  signal: {
    trendSignal: string
    signalAge: number
    currentAdx: string
  }
  score?: ScoreResult
  scoreValid: boolean
  trade: Trade | null
  capital: number
}

export interface ValidationResult {
  pair: string
  timeframe: string
  initialCapital: number
  finalCapital: number
  totalReturn: number
  trades: Trade[]
  equityCurve: Array<{
    index: number
    time: string
    capital: number
    position: number
    unrealizedPnl?: number
  }>
  positionHistory: Array<{
    index: number
    time: string
    position: number
    price: number
    signal: string
    score: number
    open: number
    high: number
    low: number
    close: number
  }>
  roundDetails: ValidationRound[]
  fullDates: string[]
  fullData: string[][]
  config: {
    windowSize: number
    stepSize: number
    predictSize: number
    stakeAmount: number
  }
}

export interface DataCache {
  pair: string
  timeframe: string
  limit: string
  data: CandleData
  timestamp: number
}

export interface HotPairInfo {
  instId: string
  last: number
  open24h: number
  change24h: number
  volCcy24h: number
  listTime: number
}

export interface HotPairsResult {
  byVolume: HotPairInfo[]
  byChange: HotPairInfo[]
  byListTime: HotPairInfo[]
}

export interface TrendScanResult {
  pair: string
  timeframe: string
  trendScore: number
  direction: 'long' | 'short' | 'neutral'
  level: 'strong' | 'moderate' | 'weak' | 'neutral'
  action: string
  adx: number
  efficiencyRatio: number
  volatilityState: 'normal' | 'elevated'
  stopLossTight: number
  stopLossWide: number
  takeProfit: number
  closeConfirmPrice: number
  riskRewardTight: number
  riskRewardWide: number
  isSwingBased: boolean
  trailingStopPercent: number
  isRealData: boolean
  insufficientData: false
}

export interface TrendScanInsufficientData {
  pair: string
  timeframe: string
  insufficientData: true
}

export type TrendScanEntry = TrendScanResult | TrendScanInsufficientData
