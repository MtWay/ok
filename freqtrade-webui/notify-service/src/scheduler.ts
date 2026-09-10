import { CronJob } from 'cron'
import type { NotifyTask, ScanHistoryEntry } from './types.js'
import { scanPremiumPairs, getPopularPairs } from './scanner.js'
import { refreshRegime, sizeFactorForRegime } from './regime.js'
import { sendEmail } from './notifier.js'
import { saveScanHistory, updateTask } from './storage.js'
import { buildAutoPlanPrices, createAutoSimulationPlan, listTradePlans } from './trading.js'
import { getTradingSettings } from './settings.js'
import {
  CircuitBreaker,
  resolveBreakerConfig,
  rollingWinRate,
  rollingPF,
  loadBreakerState,
  saveBreakerState,
} from './circuit-breaker.js'
import { getPrevMatched, setMatchedBatch } from './signal-state.js'

const activeCrons = new Map<string, CronJob>()

/**
 * Resolve the per-task stop-distance cap to a fraction for calculatePlan.
 * 'atr' mode caps at 2x the signal's ATR (trailingStopPercent is already
 * 2*ATR/price*100 — the higher timeframe's ATR when multi-timeframe
 * filtering is enabled); 'percent' mode uses the configured percent,
 * defaulting to 8. Returns undefined when unusable so calculatePlan applies
 * its default.
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

/** 实盘止损类平仓原因（freshness 冷却的触发源） */
const STOP_CLOSE_REASONS = new Set(['plan_stoploss', 'plan_trailing_stop', 'hard_stop'])

async function executeTask(task: NotifyTask, trigger: 'manual' | 'scheduled' = 'scheduled'): Promise<void> {
  console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`)
  const startedAt = Date.now()

  try {
    // ---- C: regime 仓位调节（只调仓位系数，不切换入场规则——风格路由 v1 已证伪） ----
    let regimeSizeFactor = 1
    if (task.regimeRouting?.enabled) {
      const pool = task.pairs.includes('*') ? await getPopularPairs() : task.pairs
      const regime = await refreshRegime(pool)
      regimeSizeFactor = sizeFactorForRegime(regime.state, task)
      console.log(`[Scheduler] Regime ${regime.state} → sizeFactor=${regimeSizeFactor}`)
    }

    // ---- A: 熔断状态 ----
    const breakerEnabled = task.circuitBreaker?.enabled === true
    const breakerConfig = breakerEnabled ? resolveBreakerConfig(task) : undefined
    let breaker: CircuitBreaker | undefined
    if (breakerEnabled && breakerConfig) {
      const persisted = await loadBreakerState(task.id)
      breaker = new CircuitBreaker(task.id, breakerConfig, persisted)
    }

    // ---- B: 上升沿检测需要每个 pair×tf 的命中状态（含未命中） ----
    const risingEdge = task.freshness?.risingEdge === true
    const evaluated: Array<{ taskId: string; pair: string; tf: string; matched: boolean }> = []
    const edgeAllowed = new Map<string, boolean>()  // 'pair|tf' → 本次是否上升沿

    const results = await scanPremiumPairs(
      task,
      risingEdge
        ? (pair, tf, matched) => evaluated.push({ taskId: task.id, pair, tf, matched })
        : undefined,
    )

    if (risingEdge) {
      for (const e of evaluated) {
        const prev = await getPrevMatched(e.taskId, e.pair, e.tf)
        edgeAllowed.set(`${e.pair}|${e.tf}`, !prev && e.matched)
      }
      await setMatchedBatch(evaluated)
    }

    // ---- B: 止损冷却——从该任务已平仓计划推导各品种最近止损时间 ----
    const stopCooldownMs = Math.max(0, task.freshness?.cooldownAfterStopHours ?? 0) * 3_600_000
    let lastStopByPair = new Map<string, number>()
    // 熔断统计也需要计划数据，两者共用一次加载
    const allPlans = (breakerEnabled || stopCooldownMs > 0) ? await listTradePlans() : []
    if (stopCooldownMs > 0) {
      for (const plan of allPlans) {
        if (!plan.sourceKey?.startsWith(`${task.id}:`)) continue
        if (plan.status !== 'closed' || !plan.closeReason || !plan.closedAt) continue
        if (!STOP_CLOSE_REASONS.has(plan.closeReason)) continue
        const prev = lastStopByPair.get(plan.pair) ?? 0
        if (plan.closedAt > prev) lastStopByPair.set(plan.pair, plan.closedAt)
      }
    }

    // ---- A: 每次扫描后用真实平仓重算滚动统计，命中即 trip ----
    if (breaker && breakerConfig) {
      const resetAt = breaker.current.statsResetAt ?? 0
      const realClosed = allPlans
        .filter(p => p.sourceKey?.startsWith(`${task.id}:`) && !p.shadow
          && p.status === 'closed' && typeof p.realizedPnl === 'number'
          && (p.closedAt ?? 0) >= resetAt)
        .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
      const realPnls = realClosed.map(p => p.realizedPnl!)
      // 权益回撤：相对统计基线（恢复/复位点）之后的累计亏损
      const cumPnl = realPnls.reduce((s, p) => s + p, 0)
      const drawdownPct = getTradingSettings().equity > 0 && cumPnl < 0
        ? (-cumPnl / getTradingSettings().equity) * 100
        : 0
      const ev = breaker.shouldTrip(realPnls, drawdownPct)
      if (ev) {
        console.warn(`[Scheduler] Circuit breaker TRIPPED for ${task.name}: ${ev.detail}`)
        await saveBreakerState(breaker.current)
      }
    }

    if (task.autoApproveSimulation) {
      if (process.env.TRADING_DRY_RUN !== 'true') {
        console.error('[Scheduler] Auto simulation requires TRADING_DRY_RUN=true; skipping plans')
      } else {
        const tripped = breaker?.current.phase === 'tripped'
        const probe = breaker?.current.phase === 'probe'
        // 组合仓位系数：regime × 熔断（probe=0.5 / tripped 不开真实仓）
        const combinedSize = regimeSizeFactor * (breaker?.sizeFactor() ?? 1)

        const openAutoPlan = async (result: (typeof results)[number], forceShadow: boolean) => {
          if (result.direction === 'neutral' || !result.currentPrice || !result.stopLossTight || !result.takeProfit) {
            console.log(`[Scheduler] Skipped auto plan for ${result.pair} ${result.timeframe}: incomplete directional signal`)
            return
          }
          // 上升沿：非"未命中→命中"的信号跳过（评分达标是状态不是事件）
          if (risingEdge && edgeAllowed.get(`${result.pair}|${result.timeframe}`) !== true) {
            console.log(`[Scheduler] Skipped ${result.pair} ${result.timeframe}: not a rising edge (state, not event)`)
            return
          }
          const pair = result.pair.replace(/-USDT$/, '/USDT:USDT')
          // 止损冷却：该品种最近止损后 N 小时内禁止开真实仓（影子照记）
          if (!forceShadow && stopCooldownMs > 0) {
            const lastStop = lastStopByPair.get(pair)
            if (lastStop !== undefined && Date.now() - lastStop < stopCooldownMs) {
              console.log(`[Scheduler] Skipped ${pair}: stop cooldown (${task.freshness?.cooldownAfterStopHours}h) after ${new Date(lastStop).toISOString()}`)
              return
            }
          }
          try {
            const prices = buildAutoPlanPrices(result.direction, result.currentPrice, result.stopLossTight, result.takeProfit)
            const plan = await createAutoSimulationPlan({
              sourceKey: `${task.id}:${result.pair}:${result.timeframe}${forceShadow ? ':shadow' : ''}`,
              pair, side: result.direction, ...prices,
              forceShadow,
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
              // next plan without a restart. regime/熔断 仓位系数乘在这里。
              margin: getTradingSettings().fixedMargin * (forceShadow ? 1 : combinedSize),
              leverage: getTradingSettings().leverage,
              equity: getTradingSettings().equity,
            })
            if (plan) {
              console.log(`[Scheduler] Auto-approved simulation plan ${plan.id} for ${plan.pair} ${plan.side}`)
            } else {
              console.log(`[Scheduler] Skipped duplicate simulation plan for ${result.pair} ${result.timeframe}`)
            }
          } catch (error) {
            console.error(`[Scheduler] Skipped invalid auto plan for ${pair} ${result.timeframe}:`, error)
          }
        }

        for (const result of results) {
          // tripped：信号全部转影子仓；否则开真实仓（probe 半仓由 combinedSize 体现）
          await openAutoPlan(result, tripped === true)
        }

        // probe 平仓判定：按 probe 期间已平仓真实仓累计，达到 probeTrades 笔后按整体盈亏判定（幂等，每次扫描都推导）
        if (probe && breaker) {
          const probeStartedAt = breaker.current.probeStartedAt ?? 0
          const probeClosedPlans = allPlans
            .filter(p => p.sourceKey?.startsWith(`${task.id}:`) && !p.shadow
              && p.status === 'closed' && typeof p.realizedPnl === 'number'
              && (p.closedAt ?? 0) >= probeStartedAt)
          breaker.current.probeClosed = probeClosedPlans.length
          breaker.current.probePnl = probeClosedPlans.reduce((s, p) => s + p.realizedPnl!, 0)
          const ev = breaker.onProbeClose(Date.now())
          if (ev) console.log(`[Scheduler] Circuit breaker ${ev.event.toUpperCase()} for ${task.name}: ${ev.detail}`)
          await saveBreakerState(breaker.current)
        }

        // 熔断恢复检查：冷却期满且影子 PF 达标 → probe
        if (breaker && breakerConfig && breaker.current.phase === 'tripped') {
          const shadowPnls = allPlans
            .filter(p => p.sourceKey?.startsWith(`${task.id}:`) && p.shadow
              && p.status === 'closed' && typeof p.realizedPnl === 'number')
            .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
            .map(p => p.realizedPnl!)
          const ev = breaker.checkRecovery(shadowPnls, Date.now())
          if (ev) {
            console.log(`[Scheduler] Circuit breaker ${ev.event} for ${task.name}: ${ev.detail}`)
            await saveBreakerState(breaker.current)
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
