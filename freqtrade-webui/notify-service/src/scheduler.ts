import { CronJob } from 'cron'
import type { NotifyTask, ScanHistoryEntry } from './types.js'
import { scanPremiumPairs } from './scanner.js'
import { sendEmail } from './notifier.js'
import { saveScanHistory, updateTask } from './storage.js'
import { buildAutoPlanPrices, createAutoSimulationPlan } from './trading.js'
import { getTradingSettings } from './settings.js'

const activeCrons = new Map<string, CronJob>()

/**
 * Resolve the per-task stop-distance cap to a fraction for calculatePlan.
 * 'atr' mode caps at 2x the signal's ATR (trailingStopPercent is already
 * 2*ATR/price*100); 'percent' mode uses the configured percent, defaulting
 * to 8. Returns undefined when unusable so calculatePlan applies its default.
 */
function resolveMaxStopDistance(task: NotifyTask, trailingStopPercent?: number): number | undefined {
  const cap = task.stopCap
  if (!cap) return undefined
  if (cap.mode === 'atr') {
    return Number.isFinite(trailingStopPercent) && Number(trailingStopPercent) > 0
      ? Number(trailingStopPercent) / 100
      : undefined
  }
  const percent = Number(cap.percent)
  return Number.isFinite(percent) && percent > 0 ? percent / 100 : undefined
}

function getIntervalCron(interval: string): string {
  switch (interval) {
    case '15m': return '*/15 * * * *'   // Every 15 minutes
    case '1h': return '0 * * * *'      // Every hour at minute 0
    case '4h': return '0 */4 * * *'    // Every 4 hours
    case '12h': return '0 */12 * * *'  // Every 12 hours
    case '24h': return '0 0 * * *'     // Every day at midnight
    default: return '0 * * * *'
  }
}

async function executeTask(task: NotifyTask, trigger: 'manual' | 'scheduled' = 'scheduled'): Promise<void> {
  console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`)
  const startedAt = Date.now()

  try {
    const results = await scanPremiumPairs(task)

    if (task.autoApproveSimulation) {
      if (process.env.TRADING_DRY_RUN !== 'true') {
        console.error('[Scheduler] Auto simulation requires TRADING_DRY_RUN=true; skipping plans')
      } else {
        for (const result of results) {
          if (result.direction === 'neutral' || !result.currentPrice || !result.stopLossTight || !result.takeProfit) {
            console.log(`[Scheduler] Skipped auto plan for ${result.pair} ${result.timeframe}: incomplete directional signal`)
            continue
          }
          const pair = result.pair.replace(/-USDT$/, '/USDT:USDT')
          try {
            const prices = buildAutoPlanPrices(result.direction, result.currentPrice, result.stopLossTight, result.takeProfit)
            const plan = await createAutoSimulationPlan({
              sourceKey: `${task.id}:${result.pair}:${result.timeframe}`,
              pair, side: result.direction, ...prices,
              // Task-level stop-distance cap: fixed percent, or 2x ATR.
              // trailingStopPercent is exactly 2*ATR/price*100, so /100 yields
              // the 2x-ATR fraction. calculatePlan falls back to its 8%
              // default when this is undefined.
              maxStopDistance: resolveMaxStopDistance(task, result.trailingStopPercent),
              signal: {
                timeframe: result.timeframe,
                trendScore: result.trendScore,
                riskRewardTight: result.riskRewardTight,
                trailingStopPercent: result.trailingStopPercent,
                strategyRecommendation: result.strategyRecommendation,
              },
              // Fixed-margin sizing: risk-based sizing produced dust stakes
              // whenever the swing stop sat far away (margin = maxLoss/distance).
              // Margin and leverage come from the runtime trading settings
              // (UI 可设置，默认 5 USDT / 20x), so updates apply to the very
              // next plan without a restart.
              margin: getTradingSettings().fixedMargin,
              leverage: getTradingSettings().leverage,
              equity: Number(process.env.TRADING_DRY_RUN_EQUITY || 100),
            })
            if (plan) console.log(`[Scheduler] Auto-approved simulation plan ${plan.id} for ${plan.pair} ${plan.side}`)
            else console.log(`[Scheduler] Skipped duplicate simulation plan for ${result.pair} ${result.timeframe}`)
          } catch (error) {
            console.error(`[Scheduler] Skipped invalid auto plan for ${pair} ${result.timeframe}:`, error)
          }
        }
      }
    }

    if (results.length > 0 && task.emailEnabled !== false) {
      await sendEmail(task.email, task.name, results)
    } else if (results.length > 0) {
      console.log(`[Scheduler] Email disabled for task: ${task.name}`)
    } else {
      console.log(`[Scheduler] No premium pairs found for task: ${task.name}`)
    }

    // Update task with last run info
    await updateTask(task.id, {
      lastRun: Date.now(),
      lastResult: {
        count: results.length,
        pairs: results.map(r => `${r.pair} ${r.timeframe}`)
      }
    })
    await saveScanHistory({
      id: `scan_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id, taskName: task.name, trigger, startedAt, completedAt: Date.now(),
      resultCount: results.length, pairs: results.map(result => `${result.pair} ${result.timeframe}`)
    })
  } catch (err) {
    console.error(`[Scheduler] Error executing task ${task.name}:`, err)
    const error = err instanceof Error ? err.message : String(err)
    await saveScanHistory({
      id: `scan_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id, taskName: task.name, trigger, startedAt, completedAt: Date.now(),
      resultCount: 0, pairs: [], error
    })
  }
}

export function scheduleTask(task: NotifyTask): void {
  if (!task.enabled) {
    console.log(`[Scheduler] Task ${task.name} is disabled, skipping schedule`)
    return
  }

  // Remove existing cron if any
  unscheduleTask(task.id)

  const cronExpression = getIntervalCron(task.interval)
  const job = new CronJob(cronExpression, () => executeTask(task, 'scheduled'))

  job.start()
  activeCrons.set(task.id, job)

  console.log(`[Scheduler] Scheduled task: ${task.name} (${task.id}) with cron: ${cronExpression}`)
}

export function unscheduleTask(taskId: string): void {
  const job = activeCrons.get(taskId)
  if (job) {
    job.stop()
    activeCrons.delete(taskId)
    console.log(`[Scheduler] Unscheduled task: ${taskId}`)
  }
}

export function rescheduleTask(task: NotifyTask): void {
  unscheduleTask(task.id)
  scheduleTask(task)
}

export async function manualTrigger(task: NotifyTask): Promise<void> {
  console.log(`[Scheduler] Manual trigger for task: ${task.name} (${task.id})`)
  await executeTask(task, 'manual')
}

export function getActiveTaskIds(): string[] {
  return Array.from(activeCrons.keys())
}
