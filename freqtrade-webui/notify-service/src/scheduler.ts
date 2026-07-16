import { CronJob } from 'cron'
import type { NotifyTask } from './types.js'
import { scanPremiumPairs } from './scanner.js'
import { sendEmail } from './notifier.js'
import { updateTask } from './storage.js'

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
