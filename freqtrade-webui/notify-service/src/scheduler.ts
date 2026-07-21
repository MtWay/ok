import { CronJob } from 'cron'
import type { NotifyTask } from './types.js'
import { scanPremiumPairs } from './scanner.js'
import { sendEmail } from './notifier.js'
import { updateTask } from './storage.js'
import { createAutoSimulationPlan } from './trading.js'

const activeCrons = new Map<string, CronJob>()

function getIntervalCron(interval: string): string {
  switch (interval) {
    case '1h': return '0 * * * *'      // Every hour at minute 0
    case '4h': return '0 */4 * * *'    // Every 4 hours
    case '12h': return '0 */12 * * *'  // Every 12 hours
    case '24h': return '0 0 * * *'     // Every day at midnight
    default: return '0 * * * *'
  }
}

async function executeTask(task: NotifyTask): Promise<void> {
  console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`)

  try {
    const results = await scanPremiumPairs(task)

    if (task.autoApproveSimulation) {
      if (process.env.TRADING_DRY_RUN !== 'true') {
        console.error('[Scheduler] Auto simulation requires TRADING_DRY_RUN=true; skipping plans')
      } else {
        for (const result of results) {
          if (result.direction === 'neutral' || !result.currentPrice || !result.stopLossTight || !result.takeProfit) continue
          const risk = Math.abs(result.currentPrice - result.stopLossTight)
          const takeProfit2 = result.direction === 'long' ? result.currentPrice + risk * 2 : result.currentPrice - risk * 2
          const plan = await createAutoSimulationPlan({
            sourceKey: `${task.id}:${result.pair}:${result.timeframe}`,
            pair: result.pair.replace(/-USDT$/, '/USDT:USDT'), side: result.direction,
            entryPrice: result.currentPrice, stopPrice: result.stopLossTight,
            takeProfit1: result.takeProfit, takeProfit2,
            equity: Number(process.env.TRADING_DRY_RUN_EQUITY || 10000),
            riskFraction: Number(process.env.TRADING_RISK_FRACTION || 0.005),
          })
          if (plan) console.log(`[Scheduler] Auto-approved simulation plan ${plan.id} for ${plan.pair} ${plan.side}`)
        }
      }
    }

    if (results.length > 0) {
      await sendEmail(task.email, task.name, results)
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
  } catch (err) {
    console.error(`[Scheduler] Error executing task ${task.name}:`, err)
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
  const job = new CronJob(cronExpression, () => executeTask(task))

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
  await executeTask(task)
}

export function getActiveTaskIds(): string[] {
  return Array.from(activeCrons.keys())
}
