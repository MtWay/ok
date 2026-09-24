import type { BacktestResult, Trade } from '../types'

// ---- 指标 ----

// ATR(period)，Wilder 平滑。移植自 notify-service/src/shared/indicators.ts，
// K 线布局：[open, close, low, high, volume]
export function calculateATR(data: string[][], period = 20): number[] {
  const atr: number[] = []
  const trueRanges: number[] = []

  for (let i = 0; i < data.length; i++) {
    const high = parseFloat(data[i][3])
    const low = parseFloat(data[i][2])
    if (i === 0) {
      trueRanges.push(high - low)
      atr.push(trueRanges[0])
      continue
    }
    const prevClose = parseFloat(data[i - 1][1])
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trueRanges.push(tr)

    if (i < period) {
      const sum = trueRanges.slice(0, i + 1).reduce((a, b) => a + b, 0)
      atr.push(sum / (i + 1))
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period)
    }
  }

  return atr
}

/** 前 N 根（不含当根）Donchian 通道；预热期返回永不触发的哨兵值 */
function donchian(data: string[][], period: number): Array<{ high: number; low: number }> {
  const result: Array<{ high: number; low: number }> = []
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      result.push({ high: Infinity, low: -Infinity })
      continue
    }
    let high = -Infinity
    let low = Infinity
    for (let j = i - period; j < i; j++) {
      const h = parseFloat(data[j][3])
      const l = parseFloat(data[j][2])
      if (h > high) high = h
      if (l < low) low = l
    }
    result.push({ high, low })
  }
  return result
}

// ---- 海龟双向突破（移植自 notify-service/src/turtle.ts，仓位改为固定名义） ----

interface TurtleOpts {
  entryBars: number
  exitBars: number
  maxUnits: number
  unitStepAtr: number
  stopAtr: number
  skipLastLossFilter: boolean
  allowLong: boolean
  allowShort: boolean
  stakeAmount: number
}

interface UnitEntry {
  price: number
  qty: number
  barIdx: number
}

interface TurtleAction {
  kind: 'entry' | 'add' | 'exit'
  side: 'long' | 'short'
  price: number
  qty: number
  units: number
  stopPrice: number
  reason: 'breakout_entry' | 'channel_exit' | 'stop_2n' | 'backtest_end'
  /** exit 时带回：各单位的入场价与首单位入场 bar 下标 */
  unitEntries?: number[]
  firstEntryIdx?: number
  /** exit 时带回：该笔整体是否亏损（驱动 S1 skip 过滤） */
  pnlWasLoss?: boolean
}

/**
 * 海龟状态机（单系统）。与后端 TurtleSystem 逻辑一致，差异：
 * - 单位仓位固定名义 stakeAmount（qty = stakeAmount / price），非 1%风险/N
 * - 不计手续费、不维护账户权益（由外层 runner 累计）
 * - 止损跳空按不利方向成交：多头 min(open, stop)、空头 max(open, stop)
 */
class TurtleSystemLocal {
  private opts: TurtleOpts
  private pos: { side: 'long' | 'short'; units: UnitEntry[]; stopPrice: number } | null = null
  private lastLoss: { direction: 'long' | 'short'; armed: boolean } = { direction: 'long', armed: false }

  constructor(opts: TurtleOpts) {
    this.opts = opts
  }

  get openUnits(): UnitEntry[] {
    return this.pos?.units ?? []
  }

  get openSide(): 'long' | 'short' | null {
    return this.pos?.side ?? null
  }

  /** 当前持仓的浮动盈亏（USDT），按收盘价计 */
  floatingPnl(close: number): number {
    if (!this.pos) return 0
    let sum = 0
    for (const u of this.pos.units) {
      sum += this.pos.side === 'long'
        ? (close - u.price) / u.price
        : (u.price - close) / u.price
    }
    return sum * this.opts.stakeAmount
  }

  onBar(
    bar: { open: number; high: number; low: number; close: number },
    ctx: { entry: { high: number; low: number }; exit: { high: number; low: number }; atr: number; isLast: boolean }
  ): TurtleAction[] {
    const actions: TurtleAction[] = []

    if (ctx.isLast) {
      // 最后一根：只强平，不开新仓
      if (this.pos) actions.push(this.close(bar.close, 'backtest_end'))
      return actions
    }

    if (this.pos) {
      const stop = this.checkStop(bar)
      if (stop) {
        actions.push(stop)
        // 经典规则：skipLastLossFilter 启用且止损亏损时，武装该方向过滤器
        if (this.opts.skipLastLossFilter && stop.pnlWasLoss) {
          this.lastLoss = { direction: stop.side, armed: true }
        }
        return actions
      }

      const exit = this.checkExit(bar, ctx.exit)
      if (exit) {
        actions.push(exit)
        return actions
      }

      const add = this.tryAdd(bar, ctx.atr)
      if (add) actions.push(add)
      return actions
    }

    const entry = this.tryEntry(bar, ctx.entry, ctx.atr)
    if (entry) actions.push(entry)
    return actions
  }

  private checkStop(bar: { open: number; high: number; low: number; close: number }): TurtleAction | null {
    if (!this.pos) return null
    const { side, stopPrice } = this.pos
    if (side === 'long') {
      if (bar.low <= stopPrice) {
        return this.close(Math.min(bar.open, stopPrice), 'stop_2n')
      }
    } else if (bar.high >= stopPrice) {
      return this.close(Math.max(bar.open, stopPrice), 'stop_2n')
    }
    return null
  }

  private checkExit(bar: { close: number }, exitChannel: { high: number; low: number }): TurtleAction | null {
    if (!this.pos) return null
    if (this.pos.side === 'long') {
      if (bar.close < exitChannel.low) return this.close(bar.close, 'channel_exit')
    } else if (bar.close > exitChannel.high) {
      return this.close(bar.close, 'channel_exit')
    }
    return null
  }

  private tryEntry(
    bar: { open: number; high: number; low: number; close: number },
    entryChannel: { high: number; low: number },
    atr: number
  ): TurtleAction | null {
    if (this.pos) return null

    if (this.opts.allowLong && bar.high > entryChannel.high) {
      if (this.opts.skipLastLossFilter && this.lastLoss.armed && this.lastLoss.direction === 'long') {
        this.lastLoss.armed = false
        return null
      }
      const price = Math.max(bar.open, entryChannel.high)
      return this.open('long', price, atr, 'breakout_entry')
    }

    if (this.opts.allowShort && bar.low < entryChannel.low) {
      if (this.opts.skipLastLossFilter && this.lastLoss.armed && this.lastLoss.direction === 'short') {
        this.lastLoss.armed = false
        return null
      }
      const price = Math.min(bar.open, entryChannel.low)
      return this.open('short', price, atr, 'breakout_entry')
    }

    return null
  }

  private tryAdd(bar: { open: number; high: number; low: number; close: number }, atr: number): TurtleAction | null {
    if (!this.pos || this.pos.units.length >= this.opts.maxUnits) return null
    const step = this.opts.unitStepAtr * atr
    const last = this.pos.units[this.pos.units.length - 1]

    if (this.pos.side === 'long') {
      if (bar.high >= last.price + step) {
        const price = Math.min(Math.max(bar.open, last.price + step), bar.high)
        return this.addUnit(price, atr)
      }
    } else if (bar.low <= last.price - step) {
      const price = Math.max(Math.min(bar.open, last.price - step), bar.low)
      return this.addUnit(price, atr)
    }
    return null
  }

  private unitQty(price: number): number {
    return price > 0 ? this.opts.stakeAmount / price : 0
  }

  private open(side: 'long' | 'short', price: number, atr: number, reason: TurtleAction['reason']): TurtleAction | null {
    const qty = this.unitQty(price)
    if (qty <= 0) return null
    this.pos = {
      side,
      units: [{ price, qty, barIdx: -1 }],
      stopPrice: side === 'long' ? price - this.opts.stopAtr * atr : price + this.opts.stopAtr * atr,
    }
    return { kind: 'entry', side, price, qty, units: 1, stopPrice: this.pos.stopPrice, reason }
  }

  private addUnit(price: number, atr: number): TurtleAction | null {
    if (!this.pos) return null
    const qty = this.unitQty(price)
    if (qty <= 0) return null
    this.pos.units.push({ price, qty, barIdx: -1 })
    // 止损棘轮：全仓位移到最新单位 ± 2N
    this.pos.stopPrice = this.pos.side === 'long'
      ? price - this.opts.stopAtr * atr
      : price + this.opts.stopAtr * atr
    return {
      kind: 'add',
      side: this.pos.side,
      price,
      qty,
      units: this.pos.units.length,
      stopPrice: this.pos.stopPrice,
      reason: 'breakout_entry',
    }
  }

  private close(price: number, reason: TurtleAction['reason']): TurtleAction {
    if (!this.pos) throw new Error('close called without position')
    const { side, units } = this.pos
    const action: TurtleAction = {
      kind: 'exit',
      side,
      price,
      qty: units.reduce((s, u) => s + u.qty, 0),
      units: units.length,
      stopPrice: this.pos.stopPrice,
      reason,
      unitEntries: units.map(u => u.price),
      firstEntryIdx: units[0].barIdx,
      pnlWasLoss: (() => {
        let pnl = 0
        for (const u of units) {
          pnl += side === 'long' ? (price - u.price) / u.price : (u.price - price) / u.price
        }
        return pnl < 0
      })(),
    }
    this.pos = null
    return action
  }
}

export function runTurtleBacktest(
  dates: string[],
  data: string[][],
  opts: {
    initialCapital: number
    stakeAmount: number
    maxUnits?: number
    unitStepAtr?: number
    stopAtr?: number
    atrPeriod?: number
  }
): BacktestResult {
  const n = data.length
  const equityCurve: number[] = [opts.initialCapital]
  if (n < 2) {
    return { totalReturn: 0, trades: 0, winRate: 0, maxDrawdown: 0, maFast: 0, maSlow: 0, tradesList: [], equityCurve, method: 'turtle' }
  }

  const base: Omit<TurtleOpts, 'entryBars' | 'exitBars' | 'skipLastLossFilter'> = {
    maxUnits: opts.maxUnits ?? 4,
    unitStepAtr: opts.unitStepAtr ?? 0.5,
    stopAtr: opts.stopAtr ?? 2,
    allowLong: true,
    allowShort: true,
    stakeAmount: opts.stakeAmount,
  }
  const systems = [
    { id: 'S1' as const, sys: new TurtleSystemLocal({ ...base, entryBars: 20, exitBars: 10, skipLastLossFilter: true }) },
    { id: 'S2' as const, sys: new TurtleSystemLocal({ ...base, entryBars: 55, exitBars: 20, skipLastLossFilter: false }) },
  ]

  const atrSeries = calculateATR(data, opts.atrPeriod ?? 20)
  const entryCh1 = donchian(data, 20)
  const exitCh1 = donchian(data, 10)
  const entryCh2 = donchian(data, 55)
  const exitCh2 = donchian(data, 20)

  // 为记录 Trade 的 entryIndex，把入场 bar 下标写进单位（onBar 不感知下标）
  const trades: Trade[] = []
  let realized = 0

  const recordExit = (systemId: 'S1' | 'S2', action: TurtleAction, barIdx: number) => {
    if (!action.unitEntries || action.firstEntryIdx === undefined) return
    let pnlAmount = 0
    for (const e of action.unitEntries) {
      pnlAmount += action.side === 'long'
        ? (action.price - e) / e
        : (e - action.price) / e
    }
    pnlAmount *= opts.stakeAmount
    realized += pnlAmount
    const totalNotional = action.unitEntries.length * opts.stakeAmount
    const entryAvg = action.unitEntries.reduce((s, p) => s + p, 0) / action.unitEntries.length
    trades.push({
      entryIndex: action.firstEntryIdx,
      exitIndex: barIdx,
      entryPrice: entryAvg,
      exitPrice: action.price,
      pnl: totalNotional > 0 ? pnlAmount / totalNotional : 0,
      pnlAmount,
      entryTime: dates[action.firstEntryIdx],
      exitTime: dates[barIdx],
      direction: action.side,
      closeReason: action.reason,
      system: systemId,
      units: action.unitEntries.length,
    })
  }

  for (let i = 1; i < n; i++) {
    const o = parseFloat(data[i][0])
    const h = parseFloat(data[i][3])
    const l = parseFloat(data[i][2])
    const c = parseFloat(data[i][1])
    const atr = atrSeries[i - 1] ?? atrSeries[0]
    const bar = { open: o, high: h, low: l, close: c }
    const isLast = i === n - 1

    const ctxs = [
      { entry: entryCh1[i], exit: exitCh1[i] },
      { entry: entryCh2[i], exit: exitCh2[i] },
    ]
    systems.forEach((s, si) => {
      // 记录入场 bar 下标：入场/加仓后把新单位的 barIdx 补上
      const before = s.sys.openUnits.length
      const actions = s.sys.onBar(bar, { ...ctxs[si], atr, isLast })
      for (const action of actions) {
        if (action.kind === 'exit') recordExit(s.id, action, i)
      }
      const after = s.sys.openUnits
      if (after.length > before) {
        for (let k = before; k < after.length; k++) after[k].barIdx = i
      }
    })

    equityCurve.push(opts.initialCapital + realized + systems[0].sys.floatingPnl(c) + systems[1].sys.floatingPnl(c))
  }

  const finalEquity = equityCurve[equityCurve.length - 1]
  const totalReturn = opts.initialCapital > 0 ? (finalEquity - opts.initialCapital) / opts.initialCapital : 0
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0

  let maxDrawdown = 0
  let peak = equityCurve[0] || opts.initialCapital
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  trades.sort((a, b) => a.exitIndex - b.exitIndex || a.entryIndex - b.entryIndex)

  return {
    totalReturn,
    trades: trades.length,
    winRate,
    maxDrawdown,
    maFast: 0,
    maSlow: 0,
    tradesList: trades,
    equityCurve,
    method: 'turtle',
  }
}

// ---- 布林带均值回归（下轨买入，中轨/上轨卖出） ----

export function runBollingerBacktest(
  dates: string[],
  data: string[][],
  opts: {
    initialCapital: number
    stakeAmount: number
    period?: number
    stdDevMultiplier?: number
    stopLoss?: number
    takeProfit?: number
  }
): BacktestResult {
  const n = data.length
  const equityCurve: number[] = [opts.initialCapital]
  const period = opts.period ?? 20
  const stdDev = opts.stdDevMultiplier ?? 2

  if (n < period + 1) {
    return { totalReturn: 0, trades: 0, winRate: 0, maxDrawdown: 0, maFast: 0, maSlow: 0, tradesList: [], equityCurve, method: 'bollinger' }
  }

  const trades: Trade[] = []
  let realized = 0
  let position: { entryPrice: number; entryIdx: number } | null = null

  const calculateBollinger = (endIdx: number) => {
    const closes: number[] = []
    for (let i = endIdx - period; i < endIdx; i++) {
      closes.push(parseFloat(data[i][1]))
    }
    const mean = closes.reduce((a, b) => a + b, 0) / period
    const variance = closes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / period
    const stddev = Math.sqrt(variance)
    return {
      middle: mean,
      upper: mean + stdDev * stddev,
      lower: mean - stdDev * stddev
    }
  }

  for (let i = period; i < n; i++) {
    const o = parseFloat(data[i][0])
    const h = parseFloat(data[i][3])
    const l = parseFloat(data[i][2])
    const c = parseFloat(data[i][1])
    const isLast = i === n - 1

    const bands = calculateBollinger(i)

    if (!position && !isLast) {
      if (l <= bands.lower) {
        const fill = Math.min(o, bands.lower)
        position = { entryPrice: fill, entryIdx: i }
      }
    } else if (position) {
      const pnlPct = (c - position.entryPrice) / position.entryPrice
      let shouldExit = false
      let exitPrice = c
      let exitReason = ''

      if (opts.stopLoss && pnlPct <= -opts.stopLoss) {
        shouldExit = true
        exitPrice = position.entryPrice * (1 - opts.stopLoss)
        exitReason = 'stop_loss'
      } else if (opts.takeProfit && pnlPct >= opts.takeProfit) {
        shouldExit = true
        exitPrice = position.entryPrice * (1 + opts.takeProfit)
        exitReason = 'take_profit'
      } else if (c >= bands.middle) {
        shouldExit = true
        exitReason = 'bollinger_middle'
      } else if (isLast) {
        shouldExit = true
        exitReason = 'backtest_end'
      }

      if (shouldExit) {
        const pnlAmount = ((exitPrice - position.entryPrice) / position.entryPrice) * opts.stakeAmount
        realized += pnlAmount
        trades.push({
          entryIndex: position.entryIdx,
          exitIndex: i,
          entryPrice: position.entryPrice,
          exitPrice,
          pnl: (exitPrice - position.entryPrice) / position.entryPrice,
          pnlAmount,
          entryTime: dates[position.entryIdx],
          exitTime: dates[i],
          direction: 'long',
          closeReason: exitReason,
        })
        position = null
      }
    }

    let floating = 0
    if (position) {
      floating = ((c - position.entryPrice) / position.entryPrice) * opts.stakeAmount
    }
    equityCurve.push(opts.initialCapital + realized + floating)
  }

  const finalEquity = equityCurve[equityCurve.length - 1]
  const totalReturn = opts.initialCapital > 0 ? (finalEquity - opts.initialCapital) / opts.initialCapital : 0
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0

  let maxDrawdown = 0
  let peak = equityCurve[0] || opts.initialCapital
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return {
    totalReturn,
    trades: trades.length,
    winRate,
    maxDrawdown,
    maFast: 0,
    maSlow: 0,
    tradesList: trades,
    equityCurve,
    method: 'bollinger',
  }
}

// ---- 网格回测（固定区间、逐格低买高卖一格止盈） ----

export function runGridBacktest(
  dates: string[],
  data: string[][],
  opts: {
    initialCapital: number
    stakeAmount: number
    gridCount?: number
    lookbackBars?: number
    gridStopPercent?: number
  }
): BacktestResult {
  const n = data.length
  const equityCurve: number[] = [opts.initialCapital]
  const gridCount = Math.max(2, Math.floor(opts.gridCount ?? 8))
  if (n < 2) {
    return { totalReturn: 0, trades: 0, winRate: 0, maxDrawdown: 0, maFast: 0, maSlow: 0, tradesList: [], equityCurve, method: 'grid' }
  }

  const lookback = Math.min(opts.lookbackBars ?? 120, n - 1)
  let upper = -Infinity
  let lower = Infinity
  for (let i = 0; i < lookback; i++) {
    upper = Math.max(upper, parseFloat(data[i][3]))
    lower = Math.min(lower, parseFloat(data[i][2]))
  }
  const step = (upper - lower) / gridCount
  const trades: Trade[] = []

  if (!(step > 0) || lookback < 2) {
    // 区间退化（如数据全平）→ 无交易
    for (let i = 1; i < n; i++) equityCurve.push(opts.initialCapital)
    return {
      totalReturn: 0, trades: 0, winRate: 0, maxDrawdown: 0,
      maFast: 0, maSlow: 0, tradesList: [], equityCurve, method: 'grid',
      gridRange: { upper, lower, step: Math.max(step, 0) },
    }
  }

  // P_k = lower + k×step（k = 1..gridCount，上轨即 P_gridCount）
  const levelPrice = (k: number) => lower + k * step
  const maxConcurrent = Math.max(1, Math.floor(opts.initialCapital / Math.max(opts.stakeAmount, Number.MIN_VALUE)))
  // level → 持仓单位
  const open = new Map<number, { entryPrice: number; entryIdx: number }>()
  let realized = 0
  let prevClose = parseFloat(data[lookback - 1][1])

  const pushTrade = (k: number, u: { entryPrice: number; entryIdx: number }, exitPrice: number, exitIdx: number, reason: string) => {
    const pnlAmount = ((exitPrice - u.entryPrice) / u.entryPrice) * opts.stakeAmount
    realized += pnlAmount
    trades.push({
      entryIndex: u.entryIdx,
      exitIndex: exitIdx,
      entryPrice: u.entryPrice,
      exitPrice,
      pnl: (exitPrice - u.entryPrice) / u.entryPrice,
      pnlAmount,
      entryTime: dates[u.entryIdx],
      exitTime: dates[exitIdx],
      direction: 'long',
      closeReason: reason,
      level: k,
      units: 1,
    })
  }

  for (let i = 1; i < n; i++) {
    const o = parseFloat(data[i][0])
    const h = parseFloat(data[i][3])
    const l = parseFloat(data[i][2])
    const c = parseFloat(data[i][1])
    const isLast = i === n - 1

    if (i >= lookback) {
      // 1) 买入（低点穿越下移触发；同根多级从高级到低级；最后一根不再开新仓）
      if (!isLast) {
        for (let k = gridCount; k >= 1; k--) {
          if (open.has(k)) continue
          if (open.size >= maxConcurrent) break
          const pk = levelPrice(k)
          if (prevClose > pk && l <= pk) {
            const fill = Math.min(o, pk)
            open.set(k, { entryPrice: fill, entryIdx: i })
          }
        }
      }
      // 2) 止损（低点触及止损线；0 = 不设止损）
      const stopPct = (opts.gridStopPercent ?? 0) / 100
      if (stopPct > 0) {
        for (const [k, u] of [...open.entries()]) {
          const stopPrice = u.entryPrice * (1 - stopPct)
          if (l <= stopPrice) {
            const fill = Math.max(o, stopPrice)
            open.delete(k)
            pushTrade(k, u, fill, i, 'grid_stop')
          }
        }
      }
      // 3) 止盈（高点触及入场级别上一步；跳空高开按开盘价成交）
      for (const [k, u] of [...open.entries()]) {
        const tp = levelPrice(k) + step
        if (h >= tp) {
          const fill = Math.max(o, tp)
          open.delete(k)
          pushTrade(k, u, fill, i, 'grid_tp')
        }
      }
      // 4) 最后一根强平
      if (isLast) {
        for (const [k, u] of [...open.entries()]) {
          open.delete(k)
          pushTrade(k, u, c, i, 'backtest_end')
        }
      }
      prevClose = c
    }

    let floating = 0
    for (const [, u] of open) floating += ((c - u.entryPrice) / u.entryPrice) * opts.stakeAmount
    equityCurve.push(opts.initialCapital + realized + floating)
  }

  const finalEquity = equityCurve[equityCurve.length - 1]
  const totalReturn = opts.initialCapital > 0 ? (finalEquity - opts.initialCapital) / opts.initialCapital : 0
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0

  let maxDrawdown = 0
  let peak = equityCurve[0] || opts.initialCapital
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return {
    totalReturn,
    trades: trades.length,
    winRate,
    maxDrawdown,
    maFast: 0,
    maSlow: 0,
    tradesList: trades,
    equityCurve,
    method: 'grid',
    gridRange: { upper, lower, step },
  }
}

export function runPivotBacktest(
  dates: string[],
  data: string[][],
  opts: {
    initialCapital: number
    stakeAmount: number
    pivotPeriod?: number
    threshold?: number
    stopPercent?: number
    enableShort?: boolean
  }
): BacktestResult {
  const n = data.length
  const equityCurve: number[] = [opts.initialCapital]
  const pivotPeriod = Math.max(5, opts.pivotPeriod ?? 20)
  const threshold = (opts.threshold ?? 1) / 100
  const stopPct = (opts.stopPercent ?? 2) / 100
  const enableShort = opts.enableShort ?? true

  if (n < pivotPeriod + 2) {
    for (let i = 1; i < n; i++) equityCurve.push(opts.initialCapital)
    return { totalReturn: 0, trades: 0, winRate: 0, maxDrawdown: 0, maFast: 0, maSlow: 0, tradesList: [], equityCurve, method: 'pivot' }
  }

  interface PivotLevel { pp: number; s1: number; s2: number; r1: number; r2: number }
  const trades: Trade[] = []
  let realized = 0
  let position: { side: 'long' | 'short'; entryPrice: number; entryIdx: number; pivotLevel: string; tp1: number; tp2: number; stopPrice: number } | null = null

  let levels: PivotLevel = { pp: 0, s1: 0, s2: 0, r1: 0, r2: 0 }

  function recalcPivot(endIdx: number) {
    let hi = -Infinity, lo = Infinity
    const start = Math.max(0, endIdx - pivotPeriod)
    for (let j = start; j < endIdx; j++) {
      hi = Math.max(hi, parseFloat(data[j][3]))
      lo = Math.min(lo, parseFloat(data[j][2]))
    }
    const close = parseFloat(data[endIdx - 1][1])
    const pp = (hi + lo + close) / 3
    levels = { pp, s1: 2 * pp - hi, s2: pp - (hi - lo), r1: 2 * pp - lo, r2: pp + (hi - lo) }
  }

  recalcPivot(pivotPeriod)

  const closePosition = (exitPrice: number, exitIdx: number, reason: string) => {
    if (!position) return
    const dir = position.side
    const pnlRatio = dir === 'long'
      ? (exitPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - exitPrice) / position.entryPrice
    const pnlAmount = pnlRatio * opts.stakeAmount
    realized += pnlAmount
    trades.push({
      entryIndex: position.entryIdx,
      exitIndex: exitIdx,
      entryPrice: position.entryPrice,
      exitPrice,
      pnl: pnlRatio,
      pnlAmount,
      entryTime: dates[position.entryIdx],
      exitTime: dates[exitIdx],
      direction: dir,
      closeReason: reason,
      pivotLevel: position.pivotLevel,
    })
    position = null
  }

  for (let i = 1; i < n; i++) {
    const o = parseFloat(data[i][0])
    const h = parseFloat(data[i][3])
    const l = parseFloat(data[i][2])
    const c = parseFloat(data[i][1])
    const isLast = i === n - 1

    if (i >= pivotPeriod && (i - pivotPeriod) % pivotPeriod === 0) {
      recalcPivot(i)
    }

    if (i >= pivotPeriod) {
      const { pp, s1, s2, r1, r2 } = levels

      if (position) {
        const hitStop = position.side === 'long' ? l <= position.stopPrice : h >= position.stopPrice
        const hitTp1 = position.side === 'long' ? h >= position.tp1 : l <= position.tp1
        const hitTp2 = position.side === 'long' ? h >= position.tp2 : l <= position.tp2

        if (hitStop) {
          const fill = position.side === 'long' ? Math.max(o, position.stopPrice) : Math.min(o, position.stopPrice)
          closePosition(fill, i, 'pivot_stop')
        } else if (hitTp2) {
          const fill = position.side === 'long' ? Math.min(o, position.tp2) : Math.max(o, position.tp2)
          closePosition(fill, i, 'pivot_tp2')
        } else if (hitTp1) {
          const fill = position.side === 'long' ? Math.min(o, position.tp1) : Math.max(o, position.tp1)
          closePosition(fill, i, 'pivot_tp')
        }
      }

      if (!position && !isLast) {
        const nearS1 = l <= s1 * (1 + threshold) && l >= s2 * (1 - threshold)
        const nearS2 = l <= s2 * (1 + threshold)
        const nearR1 = h >= r1 * (1 - threshold) && h <= r2 * (1 + threshold)
        const nearR2 = h >= r2 * (1 - threshold)

        if (nearS2) {
          const fill = Math.min(o, s2)
          position = { side: 'long', entryPrice: fill, entryIdx: i, pivotLevel: 'S2', tp1: pp, tp2: r1, stopPrice: fill * (1 - stopPct) }
        } else if (nearS1) {
          const fill = Math.min(o, s1)
          position = { side: 'long', entryPrice: fill, entryIdx: i, pivotLevel: 'S1', tp1: pp, tp2: r1, stopPrice: fill * (1 - stopPct) }
        } else if (enableShort && nearR2) {
          const fill = Math.max(o, r2)
          position = { side: 'short', entryPrice: fill, entryIdx: i, pivotLevel: 'R2', tp1: pp, tp2: s1, stopPrice: fill * (1 + stopPct) }
        } else if (enableShort && nearR1) {
          const fill = Math.max(o, r1)
          position = { side: 'short', entryPrice: fill, entryIdx: i, pivotLevel: 'R1', tp1: pp, tp2: s1, stopPrice: fill * (1 + stopPct) }
        }
      }

      if (isLast && position) {
        closePosition(c, i, 'backtest_end')
      }
    }

    let floating = 0
    if (position) {
      const ratio = position.side === 'long'
        ? (c - position.entryPrice) / position.entryPrice
        : (position.entryPrice - c) / position.entryPrice
      floating = ratio * opts.stakeAmount
    }
    equityCurve.push(opts.initialCapital + realized + floating)
  }

  const finalEquity = equityCurve[equityCurve.length - 1]
  const totalReturn = opts.initialCapital > 0 ? (finalEquity - opts.initialCapital) / opts.initialCapital : 0
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0

  let maxDrawdown = 0
  let peak = equityCurve[0] || opts.initialCapital
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return {
    totalReturn,
    trades: trades.length,
    winRate,
    maxDrawdown,
    maFast: 0,
    maSlow: 0,
    tradesList: trades,
    equityCurve,
    method: 'pivot',
    pivotLevels: levels,
  }
}
