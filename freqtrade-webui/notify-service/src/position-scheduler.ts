import { CronJob } from 'cron'
import type { PositionTask, PositionState, PositionInterval } from './types.js'
import { fetchOKXCandles, toOkxSwapInstrument } from './scanner.js'
import { detectMaCross, detectTurtle, detectBollinger, detectGrid, detectPivot } from './position-signals.js'
import type { SignalContext, SignalAction } from './position-signals.js'
import {
  loadPositionTasks, updatePositionTask,
  getPositionState, savePositionState
} from './position-storage.js'
import { buildAutoPlanPrices, createAutoSimulationPlan, closeTradePlan, listTradePlans } from './trading.js'
import { getTradingSettings } from './settings.js'

const positionCrons = new Map<string, CronJob>()

function intervalToCron(interval: PositionInterval): string {
  switch (interval) {
    case '5m': return '*/5 * * * *'
    case '15m': return '*/15 * * * *'
    case '1H': return '0 * * * *'
    case '4H': return '0 */4 * * *'
    default: return '0 * * * *'
  }
}

export function schedulePositionTask(task: PositionTask): void {
  unschedulePositionTask(task.id)
  if (!task.enabled) return
  const cron = intervalToCron(task.interval)
  const job = new CronJob(cron, () => executePositionTask(task, 'scheduled'))
  job.start()
  positionCrons.set(task.id, job)
  console.log(`[PositionScheduler] Scheduled ${task.name} (${task.id}) ${cron}`)
}

export function unschedulePositionTask(taskId: string): void {
  const job = positionCrons.get(taskId)
  if (job) {
    job.stop()
    positionCrons.delete(taskId)
  }
}

export function reschedulePositionTask(task: PositionTask): void {
  unschedulePositionTask(task.id)
  schedulePositionTask(task)
}

export async function executePositionTask(
  task: PositionTask,
  trigger: 'manual' | 'scheduled' = 'scheduled'
): Promise<void> {
  console.log(`[PositionScheduler] Executing ${task.name} (${task.id}) trigger=${trigger}`)

  try {
    const instId = toOkxSwapInstrument(task.pair)
    const candles = await fetchOKXCandles(instId, task.interval, 300)
    if (candles.length < 10) {
      console.warn(`[PositionScheduler] Insufficient candles for ${task.pair}: ${candles.length}`)
      return
    }

    const state = await getPositionState(task.id)
    const ctx: SignalContext = { candles, state, now: Date.now() }

    const actions = runDetector(task, ctx)
    const actionSummary: string[] = []

    for (const action of actions) {
      if (action.type === 'none') continue
      await processAction(task, state, action)
      actionSummary.push(action.type + (action.type === 'grid_entry' || action.type === 'grid_exit' ? `_l${action.level}` : ''))
    }

    await savePositionState(task.id, state)
    await updatePositionTask(task.id, {
      lastRun: Date.now(),
      lastResult: { actions: actionSummary, price: parseFloat(candles[candles.length - 1][1]) }
    })

    if (actionSummary.length > 0) {
      console.log(`[PositionScheduler] ${task.name}: ${actionSummary.join(', ')}`)
    }
  } catch (err) {
    console.error(`[PositionScheduler] Error executing ${task.name}:`, err)
  }
}

function runDetector(task: PositionTask, ctx: SignalContext): SignalAction[] {
  switch (task.strategy) {
    case 'ma_cross':
      return [detectMaCross(ctx, task.params as any)]
    case 'turtle':
      return [detectTurtle(ctx, task.params as any)]
    case 'bollinger':
      return [detectBollinger(ctx, task.params as any)]
    case 'grid':
      return detectGrid(ctx, task.params as any)
    case 'pivot':
      return [detectPivot(ctx, task.params as any)]
    default:
      return []
  }
}

async function processAction(
  task: PositionTask,
  state: PositionState,
  action: SignalAction
): Promise<void> {
  const settings = getTradingSettings()
  const margin = task.margin ?? settings.fixedMargin
  const leverage = task.leverage ?? settings.leverage
  const pair = task.pair.includes(':') ? task.pair : task.pair.replace('-USDT-SWAP', '/USDT:USDT').replace('-USDT', '/USDT:USDT')
  const sourceKeyBase = `${task.id}:${pair}:${task.interval}`

  switch (action.type) {
    case 'entry': {
      const prices = buildAutoPlanPrices(action.side, action.price, action.stopPrice, action.takeProfit1)
      const plan = await createAutoSimulationPlan({
        sourceKey: sourceKeyBase,
        pair,
        side: action.side,
        entryPrice: prices.entryPrice,
        stopPrice: prices.stopPrice,
        takeProfit1: prices.takeProfit1,
        takeProfit2: prices.takeProfit2,
        margin,
        leverage,
        equity: settings.equity,
        skipPairDedupe: false,
        strategy: task.strategy,
      })
      if (plan) {
        state.status = action.side
        state.entryPrice = prices.entryPrice
        state.entryTime = Date.now()
        state.planId = plan.id
      }
      break
    }

    case 'add': {
      const prices = buildAutoPlanPrices(action.side, action.price, action.stopPrice, action.price + (action.side === 'long' ? 1 : -1))
      const plan = await createAutoSimulationPlan({
        sourceKey: `${sourceKeyBase}:unit${action.unitIndex}`,
        pair,
        side: action.side,
        entryPrice: prices.entryPrice,
        stopPrice: prices.stopPrice,
        takeProfit1: prices.takeProfit1,
        takeProfit2: prices.takeProfit2,
        margin,
        leverage,
        equity: settings.equity,
        skipPairDedupe: true,
        strategy: task.strategy,
      })
      if (plan) {
        if (!state.units) state.units = []
        state.units.push({ price: prices.entryPrice, planId: plan.id, qty: margin * leverage / prices.entryPrice })
        // Update stop on all units
        for (const unit of state.units) {
          // Stop is updated at the plan level via syncPlanPositions
        }
      }
      break
    }

    case 'exit': {
      if (state.planId) {
        try {
          await closeTradePlan(state.planId, action.reason)
        } catch (err) {
          console.error(`[PositionScheduler] Failed to close plan ${state.planId}:`, err)
        }
      }
      // Close all units (turtle)
      if (state.units) {
        for (const unit of state.units) {
          try {
            await closeTradePlan(unit.planId, action.reason)
          } catch (err) {
            console.error(`[PositionScheduler] Failed to close unit plan ${unit.planId}:`, err)
          }
        }
        state.units = []
      }
      state.status = 'flat'
      state.entryPrice = undefined
      state.entryTime = undefined
      state.planId = undefined
      break
    }

    case 'grid_entry': {
      const prices = buildAutoPlanPrices(action.side, action.price, action.stopPrice, action.takeProfit1)
      const plan = await createAutoSimulationPlan({
        sourceKey: `${sourceKeyBase}:level${action.level}`,
        pair,
        side: action.side,
        entryPrice: prices.entryPrice,
        stopPrice: prices.stopPrice,
        takeProfit1: prices.takeProfit1,
        takeProfit2: prices.takeProfit2,
        margin,
        leverage,
        equity: settings.equity,
        skipPairDedupe: true,
        strategy: task.strategy,
      })
      if (plan) {
        if (!state.gridLevels) state.gridLevels = []
        state.gridLevels.push({ level: action.level, price: prices.entryPrice, planId: plan.id })
        if (state.status === 'flat') state.status = 'long'
      }
      break
    }

    case 'grid_exit': {
      const gl = state.gridLevels?.find(g => g.level === action.level)
      if (gl) {
        try {
          await closeTradePlan(gl.planId, action.reason)
        } catch (err) {
          console.error(`[PositionScheduler] Failed to close grid plan ${gl.planId}:`, err)
        }
        state.gridLevels = state.gridLevels!.filter(g => g.level !== action.level)
        if (state.gridLevels.length === 0) state.status = 'flat'
      }
      break
    }
  }
}

export async function manualTriggerPosition(task: PositionTask): Promise<void> {
  await executePositionTask(task, 'manual')
}

export function getActivePositionTaskIds(): string[] {
  return Array.from(positionCrons.keys())
}
