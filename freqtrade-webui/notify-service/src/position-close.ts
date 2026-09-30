import type { PositionTask, PositionState } from './types.js'
import { getPositionState, savePositionState, getPositionTask } from './position-storage.js'
import { fetchOKXOrderBook, toOkxSwapInstrument } from './scanner.js'
import { closeTradePlan, markPlanClosed, listTradePlans } from './trading.js'
import type { TradePlan } from './trading.js'

export type CloseLevelKind = 'live' | 'shadow' | 'no_trade'

export interface CloseLevel {
  level: number
  side: 'long' | 'short'
  price: number
  tpPrice?: number
  planId: string
  kind: CloseLevelKind
}

export interface CloseQuote {
  bid: number
  ask: number
  last: number
  levels: CloseLevel[]
}

export interface ManualCloseRequest {
  levels: number[] | null
  mode: 'counter' | 'market'
  price?: number
}

export interface ManualCloseResult {
  degraded?: boolean
  degradedNote?: string
  counterPrice?: number
  closed: Array<{ level: number; kind: CloseLevelKind; price?: number }>
  skipped: Array<{ level: number; reason: string }>
  failed: Array<{ level: number; error: string }>
}

/** 提交价偏离对手价超过这个比例就拒绝下单，防手滑。 */
export const MAX_COUNTER_DEVIATION = 0.01

function levelKind(plan: TradePlan | undefined): CloseLevelKind {
  if (!plan) return 'no_trade'
  if (plan.shadow) return 'shadow'
  return plan.tradeId ? 'live' : 'no_trade'
}

/**
 * 持仓层的枚举方式按策略分：网格用层号，金字塔用单位下标，
 * 其余单笔策略只有 state.planId 一层（记为 0）。
 */
export function collectCloseLevels(
  task: PositionTask, state: PositionState, plans: TradePlan[],
): CloseLevel[] {
  const byId = new Map(plans.map(p => [p.id, p]))
  const side = state.status === 'short' ? 'short' : 'long'
  const kindOf = (planId: string) => levelKind(byId.get(planId))

  if (task.strategy === 'grid') {
    return (state.gridLevels ?? []).map(gl => ({
      level: gl.level,
      side: 'long' as const,
      price: gl.price,
      tpPrice: gl.tpPrice,
      planId: gl.planId,
      kind: kindOf(gl.planId),
    }))
  }

  if (task.strategy === 'turtle') {
    return (state.units ?? []).map((u, i) => ({
      level: i,
      side,
      price: u.price,
      planId: u.planId,
      kind: kindOf(u.planId),
    }))
  }

  if (!state.planId) return []
  return [{
    level: 0,
    side,
    price: state.entryPrice ?? 0,
    planId: state.planId,
    kind: kindOf(state.planId),
  }]
}

export async function getCloseQuote(task: PositionTask): Promise<CloseQuote> {
  const [state, plans, book] = await Promise.all([
    getPositionState(task.id),
    listTradePlans(),
    fetchOKXOrderBook(toOkxSwapInstrument(task.pair)),
  ])
  return { ...book, levels: collectCloseLevels(task, state, plans) }
}

export interface ManualCloseDeps {
  getState: (taskId: string) => Promise<PositionState>
  saveState: (taskId: string, state: PositionState) => Promise<void>
  listPlans: () => Promise<TradePlan[]>
  closePlan: (planId: string, reason: string, opts: { orderType: 'market' | 'limit'; price?: number }) => Promise<void>
  markClosed: (planId: string, reason: string) => Promise<void>
  getBook: (instId: string) => Promise<{ bid: number; ask: number; last: number }>
  toInstId: (pair: string) => string
}

const defaultDeps: ManualCloseDeps = {
  getState: getPositionState,
  saveState: savePositionState,
  listPlans: listTradePlans,
  closePlan: (planId, reason, opts) => closeTradePlan(planId, reason, opts),
  markClosed: markPlanClosed,
  getBook: fetchOKXOrderBook,
  toInstId: toOkxSwapInstrument,
}

export class CounterPriceDeviationError extends Error {
  constructor(readonly expected: number, readonly received: number) {
    super(`提交价 ${received} 偏离对手价 ${expected} 超过 ${MAX_COUNTER_DEVIATION * 100}%，已拒绝下单`)
  }
}

export async function executeManualClose(
  task: PositionTask,
  req: ManualCloseRequest,
  deps: ManualCloseDeps = defaultDeps,
): Promise<ManualCloseResult> {
  const state = await deps.getState(task.id)
  const plans = await deps.listPlans()
  const all = collectCloseLevels(task, state, plans)
  const targets = req.levels === null ? all : all.filter(l => req.levels!.includes(l.level))

  const result: ManualCloseResult = { closed: [], skipped: [], failed: [] }
  if (targets.length === 0) return result

  let counterPrice: number | undefined
  if (req.mode === 'counter') {
    const book = await deps.getBook(deps.toInstId(task.pair))
    const live = targets.filter(t => t.kind === 'live')
    for (const t of live) {
      const expected = t.side === 'long' ? book.ask : book.bid
      if (req.price === undefined) throw new CounterPriceDeviationError(expected, NaN)
      if (Math.abs(req.price - expected) / expected > MAX_COUNTER_DEVIATION) {
        throw new CounterPriceDeviationError(expected, req.price)
      }
    }
    counterPrice = req.price
  }
  result.counterPrice = counterPrice

  const closedPlanIds = new Set<string>()

  for (const t of targets) {
    if (t.kind === 'shadow') {
      // 影子单没有交易所持仓，只改内部记账
      try {
        await deps.markClosed(t.planId, 'manual')
        closedPlanIds.add(t.planId)
        result.closed.push({ level: t.level, kind: t.kind })
      } catch (err) {
        result.failed.push({ level: t.level, error: message(err) })
      }
      continue
    }

    if (t.kind === 'no_trade') {
      // 可能仍在 executeApprovedPlans 的重试里 eventual 成交，擅自移除会让
      // 成交后变成没人管的孤儿仓位，所以只报告不动状态。
      result.skipped.push({ level: t.level, reason: '尚无 tradeId，可能仍在重试，稍后重试' })
      continue
    }

    try {
      if (req.mode === 'counter') {
        try {
          await deps.closePlan(t.planId, 'manual', { orderType: 'limit', price: req.price })
        } catch (err) {
          // freqtrade 版本可能不支持 forceexit 的 limit + price，退回市价并告知
          result.degraded = true
          result.degradedNote = '对手价平仓失败，该层已按市价平仓'
          console.error(`[PositionClose] limit close failed for ${t.planId}, falling back to market:`, err)
          await deps.closePlan(t.planId, 'manual', { orderType: 'market' })
        }
      } else {
        await deps.closePlan(t.planId, 'manual', { orderType: 'market' })
      }
      closedPlanIds.add(t.planId)
      result.closed.push({ level: t.level, kind: t.kind, price: req.price })
    } catch (err) {
      result.failed.push({ level: t.level, error: message(err) })
    }
  }

  if (closedPlanIds.size > 0) {
    applyClosedLevels(task, state, closedPlanIds)
    await deps.saveState(task.id, state)
  }

  return result
}

function applyClosedLevels(task: PositionTask, state: PositionState, closedPlanIds: Set<string>): void {
  if (task.strategy === 'grid' && state.gridLevels) {
    state.gridLevels = state.gridLevels.filter(gl => !closedPlanIds.has(gl.planId))
  }
  if (task.strategy === 'turtle' && state.units) {
    state.units = state.units.filter(u => !closedPlanIds.has(u.planId))
  }
  if (state.planId && closedPlanIds.has(state.planId)) {
    state.planId = undefined
    state.entryPrice = undefined
    state.entryTime = undefined
  }

  const gridLeft = state.gridLevels?.length ?? 0
  const unitsLeft = state.units?.length ?? 0
  if (gridLeft === 0 && unitsLeft === 0 && !state.planId) {
    state.status = 'flat'
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function resolveCloseTask(taskId: string): Promise<PositionTask> {
  const task = await getPositionTask(taskId)
  if (!task) throw new Error(`Position task ${taskId} not found`)
  return task
}
