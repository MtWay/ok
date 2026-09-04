import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { loadScanHistory, loadTasks, createTask, updateTask, deleteTask, getTask } from './storage.js'
import { scheduleTask, unscheduleTask, rescheduleTask, manualTrigger } from './scheduler.js'
import type { NotifyTask } from './types.js'
import { clearTradePlans, createTradePlan, executeApprovedPlans, getFreqtradeSnapshot, getFreqtradeStatus, listTradePlans, resetDryRunWallet, retryTradePlan, setTradePlanStatus, syncPlanPositions, syncShadowPlans } from './trading.js'
import { debugScanPremiumPairs, invalidatePairCache } from './scanner.js'
import { loadBacktestJob, runTaskBacktest, saveBacktestJob } from './backtest.js'
import type { BacktestJob } from './types.js'
import { getWhitelist, setWhitelist } from './whitelist.js'
import { getTradingSettings, loadTradingSettings, updateTradingSettings } from './settings.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3031

app.use(cors())
app.use(express.json())

interface HistoricalDownloadJob {
  status: 'idle' | 'running' | 'completed' | 'failed'
  timerange?: string
  startedAt?: number
  completedAt?: number
  message?: string
}

let historicalDownloadJob: HistoricalDownloadJob = { status: 'idle' }

function validTimerange(value: unknown): value is string {
  return typeof value === 'string' && /^\d{8}-\d{8}$/.test(value)
}

// Trading execution is intentionally not wired here. These endpoints create
// auditable dry-run plans and read Freqtrade status only.
app.get('/api/notify/trading/plans', async (req, res) => {
  const plans = await listTradePlans()
  if (req.query.page === undefined && req.query.pageSize === undefined) return res.json(plans)
  const total = plans.length
  const sizeParam = Number(req.query.pageSize)
  const pageSize = Number.isFinite(sizeParam) && sizeParam > 0 ? Math.min(Math.floor(sizeParam), 100) : 10
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const pageParam = Number(req.query.page)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.min(Math.floor(pageParam), totalPages) : 1
  res.json({ items: plans.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize })
})

app.post('/api/notify/trading/plans', async (req, res) => {
  try { res.status(201).json(await createTradePlan(req.body as Record<string, unknown>)) }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid plan' }) }
})

app.post('/api/notify/trading/plans/:id/approve', async (req, res) => {
  const plan = await setTradePlanStatus(req.params.id, 'approved')
  if (!plan) return res.status(404).json({ error: 'Plan not found' })
  res.json(plan)
})

app.post('/api/notify/trading/plans/:id/reject', async (req, res) => {
  const plan = await setTradePlanStatus(req.params.id, 'rejected')
  if (!plan) return res.status(404).json({ error: 'Plan not found' })
  res.json(plan)
})

app.post('/api/notify/trading/plans/:id/retry', async (req, res) => {
  try {
    const plan = await retryTradePlan(req.params.id)
    if (!plan) return res.status(404).json({ error: 'Plan not found' })
    await executeApprovedPlans()
    res.json((await listTradePlans()).find(item => item.id === plan.id) ?? plan)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to retry plan' })
  }
})

app.delete('/api/notify/trading/plans', async (_req, res) => {
  try {
    res.json(await clearTradePlans())
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to clear plans' })
  }
})

app.get('/api/notify/trading/status', async (_req, res) => res.json(await getFreqtradeStatus()))
app.get('/api/notify/trading/snapshot', async (_req, res) => res.json(await getFreqtradeSnapshot()))
// Shadow plans are simulated (no real position) — keep them out of the
// positions panel; they do appear in /trading/history once closed, where the
// per-task statistics need them.
app.get('/api/notify/trading/positions', async (_req, res) => res.json((await syncPlanPositions()).filter(plan => !plan.shadow && (plan.status === 'open' || plan.status === 'submitting'))))
app.get('/api/notify/trading/history', async (_req, res) => res.json((await syncPlanPositions()).filter(plan => plan.status === 'closed').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))))
app.get('/api/notify/trading/export', async (_req, res) => {
  const plans = await listTradePlans()
  const columns = ['id', 'pair', 'side', 'status', 'created_at', 'closed_at', 'entry_price', 'exit_price', 'realized_pnl', 'profit_ratio', 'close_reason', 'timeframe', 'trend_score', 'risk_reward', 'trailing_stop_percent', 'strategy_recommendation', 'execution_error']
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows = plans.map(plan => [plan.id, plan.pair, plan.side, plan.status, plan.createdAt, plan.closedAt, plan.actualEntryPrice ?? plan.entryPrice, plan.exitRate, plan.realizedPnl, plan.currentProfit, plan.closeReason, plan.signal?.timeframe, plan.signal?.trendScore, plan.signal?.riskRewardTight, plan.signal?.trailingStopPercent, plan.signal?.strategyRecommendation, plan.executionError].map(quote).join(','))
  res.attachment(`trading-diagnostics-${new Date().toISOString().slice(0, 10)}.csv`)
  res.type('text/csv; charset=utf-8').send(`\ufeff${columns.join(',')}\n${rows.join('\n')}\n`)
})
app.get('/api/notify/trading/settings', (_req, res) => res.json(getTradingSettings()))
app.post('/api/notify/trading/settings', async (req, res) => {
  try {
    const body = req.body as Record<string, unknown> | undefined
    const patch: Record<string, unknown> = {}
    if (body?.fixedMargin !== undefined) patch.fixedMargin = body.fixedMargin
    if (body?.leverage !== undefined) patch.leverage = body.leverage
    if (body?.equity !== undefined) patch.equity = body.equity
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'fixedMargin, leverage or equity is required' })
    const previous = getTradingSettings()
    const next = await updateTradingSettings(patch)
    if (patch.equity !== undefined && next.equity !== previous.equity) {
      // Equity is the Freqtrade dry-run wallet: changing it closes all
      // positions, rewrites the config and restarts the bot on a fresh DB.
      // This can take half a minute (forceexit per position + shutdown wait).
      const reset = await resetDryRunWallet(next.equity)
      return res.json({ ...next, walletReset: true, ...reset })
    }
    res.json(next)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update trading settings' })
  }
})
app.get('/api/notify/whitelist', async (_req, res) => {
  try { res.json({ whitelist: await getWhitelist() }) }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to fetch whitelist' }) }
})
app.post('/api/notify/whitelist', async (req, res) => {
  try {
    const pairs = req.body?.pairs
    if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs must be an array of strings' })
    res.json({ whitelist: await setWhitelist(pairs) })
    invalidatePairCache()
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update whitelist' })
  }
})
app.get('/api/notify/backtest-data/status', (_req, res) => res.json({
  enabled: process.env.HISTORICAL_DATA_DOWNLOAD_ENABLED === 'true',
  ...historicalDownloadJob,
}))
app.post('/api/notify/backtest-data/download', (req, res) => {
  if (process.env.HISTORICAL_DATA_DOWNLOAD_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Historical-data download is disabled on this server' })
  }
  if (historicalDownloadJob.status === 'running') {
    return res.status(409).json({ error: 'A historical-data download is already running' })
  }
  const timerange = req.body?.timerange
  if (!validTimerange(timerange)) return res.status(400).json({ error: 'timerange must use YYYYMMDD-YYYYMMDD' })
  const configPath = process.env.FREQTRADE_BACKTEST_CONFIG
  if (!configPath) return res.status(503).json({ error: 'FREQTRADE_BACKTEST_CONFIG is not configured' })

  const binary = process.env.FREQTRADE_BIN || 'freqtrade'
  const args = ['download-data', '--config', configPath, '--timeframes', '1h', '4h', '--timerange', timerange]
  historicalDownloadJob = { status: 'running', timerange, startedAt: Date.now(), message: 'Downloading OKX futures candles...' }
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-2000) })
  child.on('error', error => {
    historicalDownloadJob = { status: 'failed', timerange, startedAt: historicalDownloadJob.startedAt, completedAt: Date.now(), message: error.message }
  })
  child.on('exit', code => {
    historicalDownloadJob = {
      status: code === 0 ? 'completed' : 'failed', timerange,
      startedAt: historicalDownloadJob.startedAt, completedAt: Date.now(),
      message: code === 0 ? 'Historical data download completed' : stderr || `freqtrade exited with code ${code}`,
    }
  })
  return res.status(202).json(historicalDownloadJob)
})

// Initialize: load all tasks and schedule enabled ones
async function initialize() {
  await loadTradingSettings()
  const tasks = await loadTasks()
  tasks.filter(t => t.enabled).forEach(scheduleTask)
  console.log(`[API] Initialized ${tasks.length} tasks, ${tasks.filter(t => t.enabled).length} enabled`)
}

// GET /api/notify/tasks - Get all tasks
app.get('/api/notify/tasks', async (req, res) => {
  try {
    const tasks = await loadTasks()
    res.json(tasks)
  } catch (err) {
    console.error('[API] Error loading tasks:', err)
    res.status(500).json({ error: 'Failed to load tasks' })
  }
})

app.get('/api/notify/tasks/:id/history', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
    res.json(await loadScanHistory(req.params.id, limit))
  } catch (err) {
    console.error('[API] Error loading scan history:', err)
    res.status(500).json({ error: 'Failed to load scan history' })
  }
})

// POST /api/notify/tasks - Create a new task
app.post('/api/notify/tasks', async (req, res) => {
  try {
    const taskData = req.body as Omit<NotifyTask, 'id' | 'createdAt' | 'updatedAt'>
    const task = await createTask(taskData)

    if (task.enabled) {
      scheduleTask(task)
    }

    res.json(task)
  } catch (err) {
    console.error('[API] Error creating task:', err)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// PUT /api/notify/tasks/:id - Update a task
app.put('/api/notify/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params
    const updates = req.body as Partial<NotifyTask>
    const updatedTask = await updateTask(id, updates)

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Reschedule if enabled, otherwise unschedule
    if (updatedTask.enabled) {
      rescheduleTask(updatedTask)
    } else {
      unscheduleTask(updatedTask.id)
    }

    res.json(updatedTask)
  } catch (err) {
    console.error('[API] Error updating task:', err)
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// DELETE /api/notify/tasks/:id - Delete a task
app.delete('/api/notify/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params
    unscheduleTask(id)
    const deleted = await deleteTask(id)

    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[API] Error deleting task:', err)
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

// POST /api/notify/tasks/:id/toggle - Toggle task enabled status
app.post('/api/notify/tasks/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params
    const task = await getTask(id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    const updatedTask = await updateTask(id, { enabled: !task.enabled })

    if (updatedTask!.enabled) {
      scheduleTask(updatedTask!)
    } else {
      unscheduleTask(id)
    }

    res.json(updatedTask)
  } catch (err) {
    console.error('[API] Error toggling task:', err)
    res.status(500).json({ error: 'Failed to toggle task' })
  }
})

// POST /api/notify/tasks/:id/trigger - Manually trigger a task
app.post('/api/notify/tasks/:id/trigger', async (req, res) => {
  try {
    const { id } = req.params
    const task = await getTask(id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Trigger async, don't wait for completion
    manualTrigger(task).catch(err => {
      console.error('[API] Manual trigger error:', err)
    })

    res.json({ success: true, message: 'Task triggered' })
  } catch (err) {
    console.error('[API] Error triggering task:', err)
    res.status(500).json({ error: 'Failed to trigger task' })
  }
})

// POST /api/notify/tasks/:id/debug-scan - Return full rule-check details for every candidate
app.post('/api/notify/tasks/:id/debug-scan', async (req, res) => {
  try {
    const { id } = req.params
    const task = await getTask(id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    const results = await debugScanPremiumPairs(task)
    res.json({ success: true, results })
  } catch (err) {
    console.error('[API] Error debug scanning task:', err)
    res.status(500).json({ error: 'Failed to debug scan task' })
  }
})

// ---- 任务历史回测：异步 job 模式（仿 backtest-data/download），结果持久化到 data/backtests/ ----
const backtestJobs = new Map<string, BacktestJob>()
const MAX_BACKTEST_DAYS = 90

function parseBacktestDate(value: unknown, endOfDay: boolean): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const ms = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isFinite(ms) ? ms : undefined
}

// POST /api/notify/tasks/:id/backtest - 启动回测，body { start, end }（YYYY-MM-DD，最长 90 天）
app.post('/api/notify/tasks/:id/backtest', async (req, res) => {
  try {
    const { id } = req.params
    const task = await getTask(id)
    if (!task) return res.status(404).json({ error: 'Task not found' })

    const existing = backtestJobs.get(id)
    if (existing?.status === 'running') {
      return res.status(409).json({ error: '该任务已有回测正在运行' })
    }

    const startMs = parseBacktestDate(req.body?.start, false)
    const endMs = parseBacktestDate(req.body?.end, true)
    if (startMs === undefined || endMs === undefined) {
      return res.status(400).json({ error: 'start/end 必须使用 YYYY-MM-DD 格式' })
    }
    if (startMs >= endMs) return res.status(400).json({ error: 'start 必须早于 end' })
    if (endMs > Date.now()) return res.status(400).json({ error: 'end 不能晚于今天' })
    if (endMs - startMs > MAX_BACKTEST_DAYS * 86_400_000) {
      return res.status(400).json({ error: `回测区间最长 ${MAX_BACKTEST_DAYS} 天` })
    }

    const job: BacktestJob = { status: 'running', taskId: id, start: startMs, end: endMs, startedAt: Date.now(), progress: { message: '排队中', percent: 0 } }
    backtestJobs.set(id, job)

    // 异步执行，不阻塞响应
    runTaskBacktest(task, startMs, endMs, progress => { job.progress = progress })
      .then(async result => {
        job.status = 'completed'
        job.completedAt = Date.now()
        job.result = result
        await saveBacktestJob(job)
        console.log(`[Backtest] Task ${task.name} (${id}) completed: ${result.summary.tradeCount} trades, pnl ${result.summary.totalPnl.toFixed(2)} USDT`)
      })
      .catch(async err => {
        job.status = 'failed'
        job.completedAt = Date.now()
        job.error = err instanceof Error ? err.message : String(err)
        await saveBacktestJob(job).catch(() => {})
        console.error(`[Backtest] Task ${id} failed:`, err)
      })

    return res.status(202).json(job)
  } catch (err) {
    console.error('[API] Error starting backtest:', err)
    res.status(500).json({ error: 'Failed to start backtest' })
  }
})

// GET /api/notify/tasks/:id/backtest/latest - 最近一次回测 job（运行中读内存，否则读持久化结果）
app.get('/api/notify/tasks/:id/backtest/latest', async (req, res) => {
  try {
    const { id } = req.params
    const running = backtestJobs.get(id)
    if (running) return res.json(running)
    const persisted = await loadBacktestJob(id)
    if (persisted) return res.json(persisted)
    return res.json({ status: 'idle', taskId: id })
  } catch (err) {
    console.error('[API] Error loading backtest:', err)
    res.status(500).json({ error: 'Failed to load backtest' })
  }
})

app.listen(PORT, () => {
  console.log(`[API] Notify service listening on port ${PORT}`)
  initialize()
  setInterval(() => { executeApprovedPlans().catch(error => console.error('[Trading] Execution error:', error)); syncPlanPositions().catch(error => console.error('[Trading] Sync error:', error)); syncShadowPlans().catch(error => console.error('[Trading] Shadow sync error:', error)) }, 15000)
})
