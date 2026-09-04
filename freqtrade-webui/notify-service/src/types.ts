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
    /** @deprecated Use rules + minRuleHits instead */
    minOptionalHits?: number
    /** @deprecated Use rules instead */
    optionalRules?: {
      maDistance?: { enabled: boolean; maxAtr: number }
      pullback?: { enabled: boolean; minAtr: number }
      supportResistance?: { enabled: boolean; maxAtr: number }
      trendScore?: { enabled: boolean; min: number }
      riskReward?: { enabled: boolean; min: number }
      trailingStop?: { enabled: boolean; maxPercent: number }
    }
    rules?: {
      maDirection?: { enabled: boolean }
      trend?: { enabled: boolean; minScore?: number }
      htfLtf?: { enabled: boolean }
      maDistance?: { enabled: boolean; maxAtr: number }
      pullback?: { enabled: boolean; minAtr: number }
      supportResistance?: { enabled: boolean; maxAtr: number }
      trendScore?: { enabled: boolean; min: number }
      riskReward?: { enabled: boolean; min: number }
      trailingStop?: { enabled: boolean; maxPercent: number }
    }
    minRuleHits?: number
    multiTimeframe?: {
      enabled: boolean
      /** @deprecated Ignored — the higher timeframe is the task's checked
       *  时间周期 (task.timeframes); this field only remains in stored tasks. */
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
  /**
   * Per-task cap on the entry-to-stop distance for auto-created plans.
   * 'percent' uses a fixed fraction (percent/100, default 8%); 'atr' uses
   * 2x the signal's ATR (i.e. its trailingStopPercent). Plans whose swing
   * stop sits beyond the cap are rejected by calculatePlan.
   */
  stopCap?: {
    mode: 'percent' | 'atr'
    percent?: number
  }
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

export interface ScanDebugEntry {
  pair: string
  timeframe: string
  insufficientData: boolean
  trendScore?: number
  direction?: 'long' | 'short' | 'neutral'
  riskRewardTight?: number
  trailingStopPercent?: number
  multiTimeframe?: TrendScanEntry['multiTimeframe']
  ruleChecks?: Array<{ id: string; label: string; passed: boolean; detail: string; hard?: boolean }>
  hardRulesPassed?: number
  hardRulesTotal?: number
  optionalRulesPassed?: number
  optionalRulesTotal?: number
  minOptionalHits?: number
  matched: boolean
  rejectReason?: string
}

/** 回测成交记录：一次完整的开平仓 */
export interface BacktestTrade {
  pair: string
  timeframe: string
  side: 'long' | 'short'
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  stopPrice: number
  takeProfit: number
  trailingStopPercent: number
  /** 扣除双边手续费后的盈亏 (USDT) */
  pnl: number
  /** 相对保证金 (fixedMargin) 的盈亏百分比 */
  pnlPct: number
  closeReason: 'plan_stoploss' | 'plan_take_profit' | 'plan_trailing_stop' | 'backtest_end'
  /** 入场时命中的规则标签 */
  matchedRules: string[]
}

export interface BacktestResult {
  taskId: string
  taskName: string
  /** 回测区间（毫秒时间戳） */
  start: number
  end: number
  startedAt: number
  completedAt: number
  /** 回测时的交易设置快照 */
  settings: { fixedMargin: number; leverage: number; equity: number }
  summary: {
    totalPnl: number
    /** 相对 equity 的收益百分比 */
    returnPct: number
    tradeCount: number
    winRate: number
    profitFactor: number
    /** 最大回撤 (USDT)，按平仓点资金曲线计算 */
    maxDrawdown: number
    avgWin: number
    avgLoss: number
  }
  trades: BacktestTrade[]
  equityCurve: Array<{ time: number; equity: number }>
  warnings: string[]
}

export interface BacktestJob {
  status: 'running' | 'completed' | 'failed'
  taskId: string
  start: number
  end: number
  startedAt: number
  completedAt?: number
  progress?: { message: string; percent: number }
  error?: string
  result?: BacktestResult
}
