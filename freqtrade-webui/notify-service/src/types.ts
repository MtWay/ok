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
      /** 大周期趋势质量阈值（复合评分 0-100，默认 60） */
      minHigherTrendQuality?: number
      /** 小周期最小回调深度（ATR，默认 0.8） */
      pullbackAtrMin?: number
      /** 使用 Chandelier Exit 替代固定止损（默认 true） */
      useChandelierStop?: boolean
      /** Chandelier 倍数（默认 3.0） */
      chandelierMultiplier?: number
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
  /**
   * Regime 仓位调节（regime.ts）：按市场状态调整仓位系数，不切换入场规则。
   * range（震荡）：sizeRange（默认 0.5）；trend_*（趋势）：sizeTrend（默认 1.5）。
   */
  regimeRouting?: {
    enabled: boolean
    sizeRange?: number
    sizeTrend?: number
  }
  /**
   * 权益熔断（circuit-breaker.ts）：滚动胜率/回撤触发后停开真实仓，
   * 信号改开影子仓；冷却期满且影子 PF 达标后半仓试探恢复，再触发冷却翻倍。
   */
  circuitBreaker?: {
    enabled: boolean
    /** 滚动胜率窗口（笔），默认 20 */
    windowTrades?: number
    /** 滚动胜率阈值（%），默认 35 */
    minWinRate?: number
    /** 相对初始权益的回撤阈值（%），默认 15 */
    maxDrawdownPct?: number
    /** 冷却时长（小时），默认 24；再触发翻倍 */
    cooldownHours?: number
    /** 恢复所需影子样本数，默认 10 */
    shadowMinTrades?: number
    /** 恢复所需影子盈亏比，默认 1.2 */
    shadowMinPF?: number
    /** 半仓试探笔数，默认 5 */
    probeTrades?: number
    /** 冷却翻倍上限（小时），默认 168（7 天）——无上限会让 64 天冷却错过整个趋势段 */
    maxCooldownHours?: number
  }
  /**
   * 信号新鲜度：评分达标是"状态"不是"事件"（NIGHT 30 天 15 连亏的根源）。
   * risingEdge：仅"未命中→命中"的上升沿才开仓；
   * cooldownAfterStopHours：止损/移动止损平仓后该品种冷却 N 小时（双向）。
   */
  freshness?: {
    risingEdge?: boolean
    cooldownAfterStopHours?: number
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
    lowerPhase: 'pullback' | 'reversal' | 'overshoot' | 'neutral'
    higherTrendQuality?: {
      kaufmanER: number
      adx: number
      maSlope: number
      compositeScore: number
    }
    pullbackAtr?: number
    rsi?: number
  }
  hybridScore?: number
  confidenceLevel?: 'high' | 'medium' | 'low'
  frontendConfidence?: number
  backendConfidence?: number
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
  trendQuality?: {
    kaufmanER: number
    adx: number
    maSlope: number
    compositeScore: number
  }
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
  /** 仓位系数（regime 路由：range=0.5 / trend=1.0），pnl 已含该系数 */
  sizeFactor?: number
}

export type MarketRegime = 'range' | 'trend_up' | 'trend_down'

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
  /** regime 路由开启时：被压制风格的影子交易（模拟成交，未计入 summary） */
  shadowTrades?: BacktestTrade[]
  /** regime 状态切换日志（含初始状态） */
  regimeLog?: Array<{ time: number; state: MarketRegime }>
  /** 熔断事件日志（trip/cooldown/probe/recovered） */
  breakerLog?: Array<{ time: number; event: 'trip' | 'cooldown' | 'probe' | 'recovered'; detail: string }>
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

// ---- 振荡度筛选 ----

export interface OscillationWeights {
  er: number
  adx: number
  atr: number
  touch: number
}

export interface OscillationParams {
  lookbackBars: number
  donchianBars: number
  /** ADX ≥ 该阈值时 ADX 分量得 0 分；默认 25（注意：shared/indicators.ts 的
   *  calculateADX 是简化版单窗口 DX，非 Wilder 平滑，阈值按此调） */
  adxThreshold: number
  atrPctMin: number
  atrPctMax: number
  weights: OscillationWeights
}

export interface OscillationScore {
  total: number
  er: number
  adx: number
  atrPct: number
  touchFreq: number
  erScore: number
  adxScore: number
  atrScore: number
  touchScore: number
  bars: number
}

export interface OscillationEntry extends OscillationScore {
  pair: string
  insufficientData: boolean
}

export interface OscillationScanFile {
  generatedAt: number
  timeframe: string
  lookbackBars: number
  pool: 'popular' | 'whitelist'
  results: OscillationEntry[]
}

// ---- 海龟策略 ----

export type TurtleSystemId = 'S1' | 'S2'

export interface TurtleParams {
  system: TurtleSystemId
  entryBars: number
  exitBars: number
  atrPeriod: number
  riskPct: number
  maxUnits: number
  unitStepAtr: number
  stopAtr: number
  skipLastLossFilter: boolean
  allowLong: boolean
  allowShort: boolean
}

export interface TurtleBar {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface TurtleAction {
  kind: 'entry' | 'add' | 'exit'
  side: 'long' | 'short'
  units: number
  price: number
  qty: number
  stopPrice: number
  reason: 'breakout_entry' | 'channel_exit' | 'stop_2n' | 'backtest_end'
}

export interface TurtleTrade {
  pair: string
  system: TurtleSystemId
  side: 'long' | 'short'
  entryTime: number
  entryAvgPrice: number
  exitTime: number
  exitPrice: number
  units: number
  unitEntries: number[]
  qty: number
  pnl: number
  pnlPct: number
  closeReason: 'breakout_entry' | 'channel_exit' | 'stop_2n' | 'backtest_end'
  bars: number
}

export interface TurtleSummary {
  totalPnl: number
  returnPct: number
  tradeCount: number
  winRate: number
  profitFactor: number
  maxDrawdown: number
  avgWin: number
  avgLoss: number
}

export interface TurtleBacktestResult {
  start: number
  end: number
  startedAt: number
  completedAt: number
  timeframe: string
  pairs: string[]
  initialEquity: number
  summary: TurtleSummary
  bySystem: { S1: TurtleSummary; S2: TurtleSummary }
  trades: TurtleTrade[]
  equityCurve: Array<{ time: number; equity: number }>
  warnings: string[]
}

export interface TurtleBacktestConfig {
  start: number
  end: number
  timeframe: string
  pairs?: string[]
  fromOscillation?: { topN: number; timeframe?: string }
  params?: Partial<TurtleParams>
}

export interface TurtleBacktestJob {
  status: 'running' | 'completed' | 'failed'
  start: number
  end: number
  startedAt: number
  completedAt?: number
  progress?: { message: string; percent: number }
  error?: string
  result?: TurtleBacktestResult
}

// ---- 策略建仓任务 ----

export type PositionStrategy = 'ma_cross' | 'turtle' | 'bollinger' | 'grid' | 'pivot'
export type PositionInterval = '5m' | '15m' | '1H' | '4H'
export type PositionStatus = 'flat' | 'long' | 'short'

export interface MaCrossParams {
  fastPeriod: number
  slowPeriod: number
  adxFilter?: boolean
  adxPeriod?: number
  adxThreshold?: number
}

export interface TurtlePositionParams {
  entryBars: number
  exitBars: number
  atrPeriod: number
  maxUnits: number
  unitStepAtr: number
  stopAtr: number
}

export interface BollingerParams {
  period: number
  stdDev: number
  stopLossPct?: number
}

export interface GridParams {
  upperPrice: number
  lowerPrice: number
  gridCount: number
}

export interface PivotPositionParams {
  pivotPeriod: number
  threshold: number
  stopPercent: number
}

export interface PositionTask {
  id: string
  name: string
  enabled: boolean
  pair: string
  strategy: PositionStrategy
  interval: PositionInterval
  params: MaCrossParams | TurtlePositionParams | BollingerParams | GridParams | PivotPositionParams
  margin?: number
  leverage?: number
  createdAt: number
  updatedAt: number
  lastRun?: number
  lastResult?: {
    actions: string[]
    price: number
  }
}

export interface PositionUnit {
  price: number
  planId: string
  qty: number
}

export interface GridLevel {
  level: number
  price: number
  planId: string
}

export interface PositionState {
  taskId: string
  status: PositionStatus
  entryPrice?: number
  entryTime?: number
  planId?: string
  units?: PositionUnit[]
  gridLevels?: GridLevel[]
  lastSignalBar?: number
  updatedAt: number
}
