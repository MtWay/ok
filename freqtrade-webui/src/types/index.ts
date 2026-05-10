export interface CandleData {
  dates: string[]
  data: number[][]
}

export interface Trade {
  entryIndex: number
  exitIndex: number
  entryPrice: number
  exitPrice: number
  pnl: number
  entryTime: string
  exitTime: string
  direction: 'long' | 'short'
}

export interface Signal {
  index: number
  type: 'buy' | 'sell' | 'short' | 'cover'
  price: number
}

export interface BacktestParams {
  maFast: number
  maSlow: number
  adxThreshold: number
  stopLoss: number
  takeProfit: number
  enableShort: boolean
  initialCapital: number
  stakeAmount: number
}

export interface BacktestResult {
  totalReturn: number
  trades: Trade[]
  winRate: number
  maxDrawdown: number
  equityCurve: number[]
  signals: Signal[]
}

export interface OptimizationResult {
  totalReturn: number
  trades: number
  winRate: number
  maxDrawdown: number
  maFast: number
  maSlow: number
  tradesList: Trade[]
}

export interface ScanResult extends OptimizationResult {
  pair: string
  timeframe: string
  fast: number
  slow: number
  trendSignal: 'long' | 'short' | 'neutral'
  currentAdx: string
  signalAge: number
  score: SignalScore
}

export interface SignalScore {
  score: number
  action: string
  level: 'excellent' | 'good' | 'hold' | 'neutral'
}

export interface PairConfig {
  symbol: string
  name: string
  type: 'SPOT' | 'SWAP'
  isNew?: boolean
  isCustom?: boolean
}
