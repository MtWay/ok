import type { TurtleAction, TurtleBar, TurtleParams, TurtleSystemId } from './types.js'

export const DEFAULT_TURTLE_PARAMS: Record<TurtleSystemId, TurtleParams> = {
  S1: {
    system: 'S1',
    entryBars: 20,
    exitBars: 10,
    atrPeriod: 20,
    riskPct: 1,
    maxUnits: 4,
    unitStepAtr: 0.5,
    stopAtr: 2,
    skipLastLossFilter: true,
    allowLong: true,
    allowShort: true,
  },
  S2: {
    system: 'S2',
    entryBars: 55,
    exitBars: 20,
    atrPeriod: 20,
    riskPct: 1,
    maxUnits: 4,
    unitStepAtr: 0.5,
    stopAtr: 2,
    skipLastLossFilter: false,
    allowLong: true,
    allowShort: true,
  },
}

interface Unit {
  entryPrice: number
  qty: number
}

interface Position {
  side: 'long' | 'short'
  units: Unit[]
  avgPrice: number
  stopPrice: number
}

interface LastLoss {
  direction: 'long' | 'short'
  armed: boolean
}

/**
 * 经典海龟交易系统（纯状态机，无 I/O）。
 *
 * 调用方负责预计算：
 * - entryChannel: bars[i-entryBars, i-1] 的 max high / min low（仅前序根）
 * - exitChannel: bars[i-exitBars, i-1] 的 max high / min low
 * - atr: calculateATR(...)[i-1]（前序 ATR，不允许用当根）
 *
 * onBar 状态机顺序：
 * 1. 持仓中：先查 2N 止损（保守：跳空按开盘价成交），再查通道退出
 * 2. 空仓：突破入场（跳空按 max/min(open, channel) 成交）
 * 3. 持仓中：加仓（0.5N 有利移动，最多 maxUnits）
 * 4. isLast：强制平仓
 */
export class TurtleSystem {
  private params: TurtleParams
  private equity: number
  private position: Position | null = null
  private lastLoss: LastLoss = { direction: 'long', armed: false }
  private lastTradeWasLoss = false
  private actions: TurtleAction[] = []

  constructor(params: TurtleParams, subEquity: number) {
    this.params = params
    this.equity = subEquity
  }

  get positionState(): Position | null {
    return this.position
  }

  get currentEquity(): number {
    return this.equity
  }

  get collectedActions(): TurtleAction[] {
    return this.actions
  }

  onBar(bar: TurtleBar, ctx: { entryChannel: { high: number; low: number }; exitChannel: { high: number; low: number }; atr: number; isLast: boolean }): TurtleAction[] {
    const { entryChannel, exitChannel, atr, isLast } = ctx
    const actions: TurtleAction[] = []

    // 强制平仓（回测结束）
    if (isLast && this.position) {
      actions.push(this.closePosition(bar.time, bar.close, 'backtest_end'))
      return actions
    }

    // 持仓中：先查止损，再查退出
    if (this.position) {
      const stopAction = this.checkStop(bar)
      if (stopAction) {
        actions.push(stopAction)
        // 经典规则：止损平仓后，如果 skipLastLossFilter 启用且该方向亏损，武装过滤器
        if (this.params.skipLastLossFilter && this.lastTradeWasLoss) {
          this.lastLoss = { direction: stopAction.side, armed: true }
        }
        this.lastTradeWasLoss = false
        return actions
      }

      const exitAction = this.checkExit(bar, exitChannel)
      if (exitAction) {
        actions.push(exitAction)
        // 经典规则：反向突破触发的退出，立即反向入场
        if (exitAction.reason === 'breakout_entry' && this.position === null) {
          const entryAction = this.tryEntry(bar, entryChannel, atr)
          if (entryAction) actions.push(entryAction)
        }
        return actions
      }

      // 加仓检查
      const addAction = this.tryAdd(bar, atr)
      if (addAction) actions.push(addAction)
      return actions
    }

    // 空仓：尝试入场
    const entryAction = this.tryEntry(bar, entryChannel, atr)
    if (entryAction) actions.push(entryAction)
    return actions
  }

  private checkStop(bar: TurtleBar): TurtleAction | null {
    if (!this.position) return null
    const { side, stopPrice } = this.position

    if (side === 'long') {
      if (bar.low <= stopPrice) {
        // 跳空低开按更不利的 open 成交
        const exitPrice = Math.min(bar.open, stopPrice)
        return this.closePosition(bar.time, exitPrice, 'stop_2n')
      }
    } else {
      if (bar.high >= stopPrice) {
        // 跳空高开按更不利的 open 成交
        const exitPrice = Math.max(bar.open, stopPrice)
        return this.closePosition(bar.time, exitPrice, 'stop_2n')
      }
    }
    return null
  }

  private checkExit(bar: TurtleBar, exitChannel: { high: number; low: number }): TurtleAction | null {
    if (!this.position) return null
    const { side } = this.position

    if (side === 'long') {
      // 多头退出：close < exitChannel.low（10 根最低）
      if (bar.close < exitChannel.low) {
        return this.closePosition(bar.time, bar.close, 'channel_exit')
      }
      // 反向突破：bar.low < entryChannel.low（空头入场条件）→ 退出并反向
      // 但这里只处理退出，反向入场在 onBar 里处理
    } else {
      // 空头退出：close > exitChannel.high（20 根最高）
      if (bar.close > exitChannel.high) {
        return this.closePosition(bar.time, bar.close, 'channel_exit')
      }
    }
    return null
  }

  private tryEntry(bar: TurtleBar, entryChannel: { high: number; low: number }, atr: number): TurtleAction | null {
    if (this.position) return null
    if (!this.params.allowLong && !this.params.allowShort) return null

    // 多头突破：bar.high > entryChannel.high
    if (this.params.allowLong && bar.high > entryChannel.high) {
      // skip 过滤器：如果该方向上次亏损，跳过本次入场
      if (this.params.skipLastLossFilter && this.lastLoss.armed && this.lastLoss.direction === 'long') {
        this.lastLoss.armed = false
        return null
      }
      const entryPrice = Math.max(bar.open, entryChannel.high)
      const qty = this.computeUnitQty(atr, entryPrice)
      if (qty <= 0) return null
      const stopPrice = entryPrice - this.params.stopAtr * atr
      return this.openPosition('long', bar.time, entryPrice, qty, stopPrice)
    }

    // 空头突破：bar.low < entryChannel.low
    if (this.params.allowShort && bar.low < entryChannel.low) {
      if (this.params.skipLastLossFilter && this.lastLoss.armed && this.lastLoss.direction === 'short') {
        this.lastLoss.armed = false
        return null
      }
      const entryPrice = Math.min(bar.open, entryChannel.low)
      const qty = this.computeUnitQty(atr, entryPrice)
      if (qty <= 0) return null
      const stopPrice = entryPrice + this.params.stopAtr * atr
      return this.openPosition('short', bar.time, entryPrice, qty, stopPrice)
    }

    return null
  }

  private tryAdd(bar: TurtleBar, atr: number): TurtleAction | null {
    if (!this.position) return null
    if (this.position.units.length >= this.params.maxUnits) return null

    const { side, units } = this.position
    const lastUnit = units[units.length - 1]
    const step = this.params.unitStepAtr * atr

    if (side === 'long') {
      if (bar.high >= lastUnit.entryPrice + step) {
        const addPrice = Math.max(bar.open, lastUnit.entryPrice + step)
        const qty = this.computeUnitQty(atr, addPrice)
        if (qty <= 0) return null
        // 加仓后止损棘轮到最新单位价 - 2N
        const newStop = addPrice - this.params.stopAtr * atr
        return this.addUnit(bar.time, addPrice, qty, newStop)
      }
    } else {
      if (bar.low <= lastUnit.entryPrice - step) {
        const addPrice = Math.min(bar.open, lastUnit.entryPrice - step)
        const qty = this.computeUnitQty(atr, addPrice)
        if (qty <= 0) return null
        const newStop = addPrice + this.params.stopAtr * atr
        return this.addUnit(bar.time, addPrice, qty, newStop)
      }
    }
    return null
  }

  private computeUnitQty(atr: number, price: number): number {
    if (atr <= 0 || price <= 0) return 0
    const riskAmount = (this.params.riskPct / 100) * this.equity
    const qty = riskAmount / atr
    return qty
  }

  private openPosition(side: 'long' | 'short', time: number, price: number, qty: number, stopPrice: number): TurtleAction {
    this.position = {
      side,
      units: [{ entryPrice: price, qty }],
      avgPrice: price,
      stopPrice,
    }
    const action: TurtleAction = {
      kind: 'entry',
      side,
      units: 1,
      price,
      qty,
      stopPrice,
      reason: 'breakout_entry',
    }
    this.actions.push(action)
    return action
  }

  private addUnit(time: number, price: number, qty: number, newStop: number): TurtleAction {
    if (!this.position) throw new Error('addUnit called without position')
    this.position.units.push({ entryPrice: price, qty })
    // 重新计算均价
    const totalQty = this.position.units.reduce((sum, u) => sum + u.qty, 0)
    const totalCost = this.position.units.reduce((sum, u) => sum + u.entryPrice * u.qty, 0)
    this.position.avgPrice = totalCost / totalQty
    // 止损棘轮
    this.position.stopPrice = newStop
    const action: TurtleAction = {
      kind: 'add',
      side: this.position.side,
      units: this.position.units.length,
      price,
      qty,
      stopPrice: newStop,
      reason: 'breakout_entry',
    }
    this.actions.push(action)
    return action
  }

  private closePosition(time: number, price: number, reason: TurtleAction['reason']): TurtleAction {
    if (!this.position) throw new Error('closePosition called without position')
    const { side, units, avgPrice } = this.position
    const totalQty = units.reduce((sum, u) => sum + u.qty, 0)
    const gross = side === 'long'
      ? (price - avgPrice) * totalQty
      : (avgPrice - price) * totalQty
    // 简化：手续费按名义价值 0.05% 双边（与 backtest.ts 对齐）
    const notional = avgPrice * totalQty
    const fee = notional * 0.0005 * 2
    const pnl = gross - fee
    this.equity += pnl
    this.lastTradeWasLoss = pnl < 0

    const action: TurtleAction = {
      kind: 'exit',
      side,
      units: units.length,
      price,
      qty: totalQty,
      stopPrice: this.position.stopPrice,
      reason,
    }
    this.actions.push(action)
    this.position = null
    return action
  }
}
