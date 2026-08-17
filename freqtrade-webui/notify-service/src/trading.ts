import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

export type TradeSide = 'long' | 'short'
export type PlanStatus = 'pending' | 'approved' | 'submitting' | 'open' | 'closed' | 'rejected' | 'expired' | 'submit_failed'

export interface TradePlan {
  id: string
  pair: string
  side: TradeSide
  entryPrice: number
  stopPrice: number
  takeProfit1: number
  takeProfit2: number
  leverage: number
  equity: number
  riskFraction: number
  notional: number
  margin: number
  maxLoss: number
  status: PlanStatus
  executionEnabled: false
  createdAt: number
  updatedAt: number
  sourceKey?: string
  tradeId?: string
  executionError?: string
  submittedAt?: number
  closedAt?: number
  closeReason?: string
  realizedPnl?: number
  currentRate?: number
  currentProfit?: number
  currentProfitAbs?: number
  actualEntryPrice?: number
  exitRate?: number
  amount?: number
  stopLoss?: number
  peakRate?: number
  trailingStopRate?: number
  executionAttempts?: number
  nextRetryAt?: number
  signal?: {
    timeframe: string
    trendScore: number
    riskRewardTight: number
    trailingStopPercent: number
    strategyRecommendation: string
  }
}

const MAX_EXECUTION_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 15_000
const DEFAULT_FREQTRADE_API_URL = 'http://127.0.0.1:8091'
const FREQTRADE_READ_ATTEMPTS = 3
const FREQTRADE_RETRY_DELAY_MS = 500
const FREQTRADE_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])

const DEFAULT_HARD_STOP_PERCENT = 3

/**
 * Hard stop-loss (in percent, fees included) applied to every open plan,
 * independent of the plan's own stop/take-profit state machine. Diagnostics
 * showed losses of -6%..-9% while plan exits never triggered, so this is the
 * last-resort guard. Override with TRADING_HARD_STOP_PERCENT.
 */
export function hardStopPercent(value = process.env.TRADING_HARD_STOP_PERCENT): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HARD_STOP_PERCENT
}

function freqtradeApiBase(): string {
  return process.env.FREQTRADE_API_URL || DEFAULT_FREQTRADE_API_URL
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')
}

export function nextExecutionRetryAt(attempts: number, now = Date.now()): number {
  return now + RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1)
}

export function canExecutePlan(plan: TradePlan, now = Date.now()): boolean {
  if (plan.tradeId || plan.executionAttempts && plan.executionAttempts >= MAX_EXECUTION_ATTEMPTS) return false
  if (plan.status === 'approved') return true
  return plan.status === 'submit_failed' && (plan.nextRetryAt === undefined || plan.nextRetryAt <= now)
}

export function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export interface AutoPlanPrices {
  entryPrice: number
  stopPrice: number
  takeProfit1: number
  takeProfit2: number
}

const __filename = fileURLToPath(import.meta.url)
const PLAN_FILE = path.join(path.dirname(__filename), '../data/trade-plans.json')

function positive(value: unknown, name: string): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${name} must be positive`)
  return result
}

export function calculatePlan(input: Record<string, unknown>): Omit<TradePlan, 'id' | 'status' | 'executionEnabled' | 'createdAt' | 'updatedAt'> {
  const pair = String(input.pair || '').trim()
  const side = input.side === 'short' ? 'short' : input.side === 'long' ? 'long' : null
  if (!pair || !side) throw new Error('pair and side are required')
  const entryPrice = positive(input.entryPrice, 'entryPrice')
  const stopPrice = positive(input.stopPrice, 'stopPrice')
  const takeProfit1 = positive(input.takeProfit1, 'takeProfit1')
  const takeProfit2 = positive(input.takeProfit2, 'takeProfit2')
  const leverage = Math.min(2, positive(input.leverage ?? 2, 'leverage'))
  const equity = positive(input.equity, 'equity')
  const riskFraction = Number(input.riskFraction ?? 0.005)
  if (!Number.isFinite(riskFraction) || riskFraction <= 0 || riskFraction > 0.01) throw new Error('riskFraction must be between 0 and 0.01')
  const distance = Math.abs(entryPrice - stopPrice) / entryPrice
  if (distance < 0.005) throw new Error('stop distance must be at least 0.5%')
  if (side === 'long' && !(stopPrice < entryPrice && takeProfit1 > entryPrice && takeProfit2 > takeProfit1)) throw new Error('invalid long prices')
  if (side === 'short' && !(stopPrice > entryPrice && takeProfit1 < entryPrice && takeProfit2 < takeProfit1)) throw new Error('invalid short prices')
  const maxLoss = equity * riskFraction
  const notional = Math.min(maxLoss / distance, 2500)
  return { pair, side, entryPrice, stopPrice, takeProfit1, takeProfit2, leverage, equity, riskFraction, notional, margin: notional / leverage, maxLoss: notional * distance }
}

/**
 * Derive a second target that is always beyond the first target in the trade
 * direction.  Swing targets can be farther than 2R, so using entry +/- 2R
 * alone can otherwise produce an invalid target order.
 */
export function buildAutoPlanPrices(
  side: TradeSide,
  entryPrice: number,
  stopPrice: number,
  takeProfit1: number,
): AutoPlanPrices {
  const risk = Math.abs(entryPrice - stopPrice)
  if (!Number.isFinite(risk) || risk <= 0) throw new Error('stop price must differ from entry price')

  const takeProfit2 = side === 'long'
    ? Math.max(entryPrice + risk * 2, takeProfit1 + risk)
    : Math.min(entryPrice - risk * 2, takeProfit1 - risk)

  return { entryPrice, stopPrice, takeProfit1, takeProfit2 }
}

async function loadPlans(): Promise<TradePlan[]> {
  try { return JSON.parse(await fs.readFile(PLAN_FILE, 'utf8')) as TradePlan[] } catch (error: any) {
    if (error.code === 'ENOENT') return []
    if (error instanceof SyntaxError) {
      const backupFile = `${PLAN_FILE}.corrupt.${Date.now()}`
      await fs.rename(PLAN_FILE, backupFile)
      console.error(`[Trading] Corrupt plans file backed up to ${backupFile}, starting fresh`)
      return []
    }
    throw error
  }
}

let savePlansQueue: Promise<void> = Promise.resolve()

async function savePlans(plans: TradePlan[]): Promise<void> {
  const task = savePlansQueue.then(async () => {
    await fs.mkdir(path.dirname(PLAN_FILE), { recursive: true })
    const tmpFile = `${PLAN_FILE}.tmp`
    await fs.writeFile(tmpFile, JSON.stringify(plans, null, 2), 'utf8')
    await fs.rename(tmpFile, PLAN_FILE)
  })
  savePlansQueue = task.catch(() => {})
  await task
}

export interface ClearPlansResult {
  cleared: number
  closedPositions: number
  failedCloses: Array<{ id: string; pair: string; error: string }>
}

/**
 * Clearing plans must not leave Freqtrade positions behind: plans own the
 * exit logic, so deleting an open plan would orphan its position and lock
 * margin in the dry-run wallet indefinitely. Close every open position
 * first — including Freqtrade trades no plan tracks (orphans from earlier
 * clears) — and keep plans whose close fails so they stay tracked.
 */
export async function clearTradePlans(): Promise<ClearPlansResult> {
  const plans = await loadPlans()
  const openTracked = plans.filter(plan => plan.tradeId && (plan.status === 'open' || plan.status === 'submitting'))
  const failedCloses: ClearPlansResult['failedCloses'] = []
  let closedPositions = 0

  for (const plan of openTracked) {
    try {
      await closePlan(plan, 'plan_cleared')
      closedPositions++
    } catch (error) {
      failedCloses.push({ id: plan.id, pair: plan.pair, error: error instanceof Error ? error.message : String(error) })
      console.error(`[Trading] Unable to close position for plan ${plan.id} during clear:`, error)
    }
  }

  // Close orphan Freqtrade positions that no plan tracks anymore.
  const base = freqtradeApiBase()
  try {
    const statusResponse = await freqtradeRequest(base, '/api/v1/status', {}, 5_000)
    if (statusResponse.ok) {
      const trackedIds = new Set(openTracked.map(plan => String(plan.tradeId)))
      const statuses = await statusResponse.json() as Array<Record<string, any>>
      for (const status of statuses) {
        const tradeId = status.trade_id ?? status.id
        if (tradeId === undefined || trackedIds.has(String(tradeId))) continue
        const response = await freqtradeRequest(base, '/api/v1/forceexit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeid: String(tradeId) }),
        }, 5_000)
        if (response.ok) closedPositions++
        else console.error(`[Trading] Unable to close orphan trade ${tradeId} (${response.status})`)
      }
    }
  } catch (error) {
    // Freqtrade unreachable or credentials missing — still clear the plans;
    // any occupied margin must be released via the Freqtrade API directly.
    console.error('[Trading] Unable to reach Freqtrade while clearing plans:', error)
  }

  const failedIds = new Set(failedCloses.map(item => item.id))
  const remaining = plans.filter(plan => failedIds.has(plan.id))
  await savePlans(remaining)
  console.log(`[Trading] Cleared ${plans.length - remaining.length} plans, closed ${closedPositions} positions, ${failedCloses.length} close failures`)
  return { cleared: plans.length - remaining.length, closedPositions, failedCloses }
}

export async function listTradePlans(): Promise<TradePlan[]> { return loadPlans() }

export async function createTradePlan(input: Record<string, unknown>): Promise<TradePlan> {
  const now = Date.now()
  const plan = { ...calculatePlan(input), id: `plan_${now}_${Math.random().toString(36).slice(2, 8)}`, status: 'pending' as PlanStatus, executionEnabled: false as const, createdAt: now, updatedAt: now }
  const plans = await loadPlans()
  plans.push(plan)
  await savePlans(plans)
  return plan
}

export async function createAutoSimulationPlan(input: Record<string, unknown>): Promise<TradePlan | null> {
  if (process.env.TRADING_DRY_RUN !== 'true') throw new Error('Automatic approval requires TRADING_DRY_RUN=true')
  const sourceKey = String(input.sourceKey || '')
  if (!sourceKey) throw new Error('sourceKey is required for automatic plans')
  const plans = await loadPlans()
  if (plans.some(plan => plan.sourceKey === sourceKey && plan.status !== 'rejected' && plan.status !== 'expired')) return null
  const plan = await createTradePlan(input)
  plan.sourceKey = sourceKey
  plan.status = 'approved'
  plan.updatedAt = Date.now()
  const saved = await loadPlans()
  const index = saved.findIndex(item => item.id === plan.id)
  if (index >= 0) saved[index] = plan
  await savePlans(saved)
  return plan
}

export async function setTradePlanStatus(id: string, status: 'approved' | 'rejected'): Promise<TradePlan | null> {
  const plans = await loadPlans()
  const plan = plans.find(item => item.id === id)
  if (!plan) return null
  plan.status = status
  plan.updatedAt = Date.now()
  await savePlans(plans)
  return plan
}

export async function retryTradePlan(id: string): Promise<TradePlan | null> {
  const plans = await loadPlans()
  const plan = plans.find(item => item.id === id)
  if (!plan) return null
  if (plan.status !== 'submit_failed') throw new Error('Only failed plans can be retried')
  plan.status = 'approved'
  plan.executionAttempts = 0
  plan.nextRetryAt = undefined
  plan.executionError = undefined
  plan.updatedAt = Date.now()
  await savePlans(plans)
  return plan
}

export async function executeApprovedPlans(): Promise<void> {
  if (process.env.TRADING_DRY_RUN !== 'true' || process.env.TRADING_EXECUTION_ENABLED !== 'true') return
  const plans = await loadPlans()
  for (const plan of plans.filter(item => canExecutePlan(item))) {
    plan.status = 'submitting'
    plan.executionAttempts = (plan.executionAttempts ?? 0) + 1
    plan.nextRetryAt = undefined
    plan.updatedAt = Date.now()
    await savePlans(plans)
    const base = freqtradeApiBase()
    try {
      // Do not forward plan.entryPrice: it is a stale signal price and the
      // strategy enters with limit orders, so the order would sit unfilled
      // (positions stay 0) until unfilledtimeout cancels it. Let Freqtrade
      // price the entry from the current order book instead; the plan's own
      // stop/take-profit tracking is independent of the actual entry fill.
      const response = await freqtradeRequest(base, '/api/v1/forceenter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Pass the planned margin as stakeamount, otherwise Freqtrade falls
        // back to its own sizing (stake_amount "unlimited" => equity * ratio /
        // max_open_trades) and the wallet usage no longer matches the plan.
        body: JSON.stringify({ pair: plan.pair, side: plan.side, stakeamount: plan.margin }),
      }, 30_000)
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.error(`[Trading] forceenter failed (${response.status}) for ${plan.pair}: ${body.slice(0, 500)}`)
        throw new Error(`forceenter failed (${response.status}): ${body.slice(0, 200)}`)
      }
      const payload = await response.json() as { trade_id?: string | number; id?: string | number }
      const tradeId = payload.trade_id ?? payload.id
      if (tradeId === undefined || tradeId === null) {
        throw new Error('forceenter succeeded but returned no trade id; refusing to mark plan open')
      }
      plan.tradeId = String(tradeId)
      plan.status = 'open'
      plan.submittedAt = Date.now()
      plan.executionError = undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      plan.status = 'submit_failed'
      plan.executionError = message
      const maxTradesReached = /Maximum number of trades is reached/i.test(message)
      if (maxTradesReached) {
        plan.executionAttempts = MAX_EXECUTION_ATTEMPTS
        plan.nextRetryAt = undefined
        console.error(`[Trading] Plan ${plan.id} paused: max open trades reached`)
      } else if (plan.executionAttempts < MAX_EXECUTION_ATTEMPTS) {
        plan.nextRetryAt = nextExecutionRetryAt(plan.executionAttempts)
        console.error(`[Trading] Plan ${plan.id} failed (attempt ${plan.executionAttempts}/${MAX_EXECUTION_ATTEMPTS}); retrying at ${new Date(plan.nextRetryAt).toISOString()}: ${plan.executionError}`)
      } else {
        plan.nextRetryAt = undefined
        console.error(`[Trading] Plan ${plan.id} failed after ${MAX_EXECUTION_ATTEMPTS} attempts: ${plan.executionError}`)
      }
    }
    plan.updatedAt = Date.now()
    await savePlans(plans)
  }
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : undefined
  }
  return undefined
}

/**
 * Dry-run trade ids are SQLite auto-increment values, so a Freqtrade restart
 * with a fresh database re-issues the same ids for different pairs. Matching
 * on trade id alone copied one pair's fill data into another pair's plan
 * (e.g. ATH's record showing up under KAITO). The pair must match too.
 */
export function findFreqtradeTrade(payload: unknown, tradeId: string, pair: string): Record<string, any> | undefined {
  const trades = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown>)?.trades)
      ? (payload as { trades: unknown[] }).trades
      : []
  return trades.find(item => {
    const trade = item as Record<string, unknown>
    return String(trade.trade_id ?? trade.id) === tradeId && trade.pair === pair
  }) as Record<string, any> | undefined
}

async function freqtradeRequest(
  base: string,
  endpoint: string,
  init: RequestInit = {},
  timeoutMs = 3_000,
): Promise<Response> {
  const isRead = (init.method || 'GET').toUpperCase() === 'GET'
  const maxAttempts = isRead ? FREQTRADE_READ_ATTEMPTS : 1
  let authRetried = false
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const headers = new Headers(await freqtradeHeaders(base))
      new Headers(init.headers).forEach((value, key) => headers.set(key, value))
      let response = await fetch(`${base}${endpoint}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (response.status === 401 && !authRetried) {
        cachedToken = null
        authRetried = true
        const refreshedHeaders = new Headers(await freqtradeHeaders(base))
        new Headers(init.headers).forEach((value, key) => refreshedHeaders.set(key, value))
        response = await fetch(`${base}${endpoint}`, {
          ...init,
          headers: refreshedHeaders,
          signal: AbortSignal.timeout(timeoutMs),
        })
      }

      if (!isRead || response.ok || !FREQTRADE_RETRYABLE_STATUS_CODES.has(response.status) || attempt === maxAttempts) {
        return response
      }
      lastError = new Error(`Freqtrade API returned ${response.status}`)
    } catch (error) {
      lastError = error
      if (!isRead || !isRetryableError(error) || attempt === maxAttempts) throw error
    }
    await wait(FREQTRADE_RETRY_DELAY_MS * 2 ** (attempt - 1))
  }

  throw lastError instanceof Error ? lastError : new Error('Freqtrade API request failed')
}

function exitReasonForPlan(plan: TradePlan, rate: number): string | undefined {
  const peak = plan.peakRate === undefined
    ? rate
    : plan.side === 'long' ? Math.max(plan.peakRate, rate) : Math.min(plan.peakRate, rate)
  plan.peakRate = peak
  const trailingPercent = plan.signal?.trailingStopPercent
  if (trailingPercent && trailingPercent > 0) {
    plan.trailingStopRate = plan.side === 'long'
      ? peak * (1 - trailingPercent / 100)
      : peak * (1 + trailingPercent / 100)
  }
  if (plan.side === 'long') {
    if (rate <= plan.stopPrice) return 'plan_stoploss'
    if (rate >= plan.takeProfit1) return 'plan_take_profit'
    if (plan.trailingStopRate !== undefined && rate <= plan.trailingStopRate) return 'plan_trailing_stop'
  } else {
    if (rate >= plan.stopPrice) return 'plan_stoploss'
    if (rate <= plan.takeProfit1) return 'plan_take_profit'
    if (plan.trailingStopRate !== undefined && rate >= plan.trailingStopRate) return 'plan_trailing_stop'
  }
  return undefined
}

/**
 * Decide the close reason kept on the plan. Every plan exit goes through
 * /forceexit, so Freqtrade always records the generic 'force_exit'; without
 * this guard the next sync overwrote 'plan_take_profit'/'plan_stoploss' with
 * it and diagnostics showed ~100% force_exit closes.
 */
export function resolveCloseReason(plan: TradePlan, history: Record<string, any>): string | undefined {
  const freqReason = history.sell_reason ?? history.exit_reason
  if (plan.closeReason && (!freqReason || freqReason === 'force_exit')) return plan.closeReason
  return freqReason ?? plan.closeReason
}

async function closePlan(plan: TradePlan, reason: string): Promise<void> {
  // Market order: the default limit exit can rest unfilled (up to the 10
  // minute unfilledtimeout) while the price runs through the stop — that is
  // how positions ended up floating at -19% with a take-profit reason stuck
  // on the plan.
  const response = await freqtradeRequest(freqtradeApiBase(), '/api/v1/forceexit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tradeid: plan.tradeId, ordertype: 'market' }),
  }, 5_000)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`forceexit failed (${response.status}): ${body.slice(0, 200)}`)
  }
  plan.closeReason = reason
}

export async function syncPlanPositions(): Promise<TradePlan[]> {
  const plans = await loadPlans()
  const tracked = plans.filter(plan => plan.tradeId)
  if (!tracked.length) return plans
  const base = freqtradeApiBase()
  try {
    const [statusResponse, tradesResponse] = await Promise.all([
      freqtradeRequest(base, '/api/v1/status', {}, 5_000),
      // 100 entries was not enough: active trading easily pushes a closed
      // trade out of the window, producing ghost rows with no exit data.
      freqtradeRequest(base, '/api/v1/trades?limit=500', {}, 5_000)
    ])
    const statuses = statusResponse.ok ? await statusResponse.json() as Array<Record<string, any>> : []
    const tradeHistory = tradesResponse.ok ? await tradesResponse.json() : []

    for (const plan of tracked) {
      const tradeId = String(plan.tradeId)
      const status = statuses.find(item => String(item.trade_id ?? item.id) === tradeId && item.pair === plan.pair)
      const history = findFreqtradeTrade(tradeHistory, tradeId, plan.pair)
      if (!status && !history && statuses.some(item => String(item.trade_id ?? item.id) === tradeId)) {
        console.error(`[Trading] Plan ${plan.id}: trade id ${tradeId} is now a different pair (stale id after a Freqtrade reset); not importing its data`)
      }
      if (status) {
        const currentRate = optionalNumber(status.current_rate ?? status.currentRate)
        const profitRatio = optionalNumber(status.profit_ratio ?? status.current_profit)
        let reason: string | undefined
        // Hard stop runs first and unconditionally — it must fire even when a
        // plan exit reason is already pending (see the closeReason guard below).
        if (profitRatio !== undefined && profitRatio <= -hardStopPercent() / 100) {
          reason = 'plan_hard_stop'
        } else if (currentRate !== undefined) {
          reason = exitReasonForPlan(plan, currentRate)
        }
        // Evaluate exits even when closeReason is already set: the previous
        // `!plan.closeReason` guard disabled all further exit checks once a
        // take-profit was requested, so a position whose exit order never
        // filled kept floating (observed at -19%) with a stale 'plan_take_profit'
        // attached. A different reason re-issues the close.
        if (plan.status === 'open' && reason && reason !== plan.closeReason) {
          try {
            await closePlan(plan, reason)
          } catch (error) {
            console.error(`[Trading] Unable to close ${plan.id}:`, error)
          }
        }
        Object.assign(plan, {
          status: 'open',
          currentRate,
          currentProfit: profitRatio,
          currentProfitAbs: optionalNumber(status.profit_abs ?? status.current_profit_abs),
          actualEntryPrice: optionalNumber(status.open_rate ?? status.entry_price),
          amount: optionalNumber(status.amount),
          // Reflect the actual stake Freqtrade used, so the displayed margin
          // matches the wallet's occupied funds.
          margin: optionalNumber(status.stake_amount) ?? plan.margin,
          stopLoss: optionalNumber(status.stop_loss_abs ?? status.stoploss_abs),
        })
      } else if (history) {
        Object.assign(plan, {
          status: 'closed',
          closedAt: toTimestamp(history.close_date_ts ?? history.close_date) ?? plan.closedAt ?? Date.now(),
          exitRate: optionalNumber(history.close_rate ?? history.exit_rate),
          actualEntryPrice: optionalNumber(history.open_rate ?? history.entry_price) ?? plan.actualEntryPrice,
          margin: optionalNumber(history.stake_amount) ?? plan.margin,
          realizedPnl: optionalNumber(history.close_profit_abs ?? history.profit_abs),
          currentProfit: optionalNumber(history.close_profit ?? history.profit_ratio),
          currentProfitAbs: optionalNumber(history.close_profit_abs ?? history.profit_abs),
          closeReason: resolveCloseReason(plan, history),
        })
      } else {
        plan.status = 'closed'
        plan.closedAt = plan.closedAt ?? Date.now()
        // No Freqtrade record at all (id slid out of the history window, or
        // the dry-run database was reset). Tag it so these rows can be told
        // apart from real closes instead of posing as 0-PnL trades.
        plan.closeReason = plan.closeReason ?? 'sync_lost'
      }
      plan.updatedAt = Date.now()
    }
    await savePlans(plans)
  } catch (error) {
    console.error('[Trading] Unable to sync Freqtrade positions:', error)
  }
  return plans
}

export async function getFreqtradeStatus(): Promise<unknown> {
  const base = freqtradeApiBase()
  try {
    const response = await freqtradeRequest(base, '/api/v1/status')
    if (!response.ok) return { available: false, status: response.status }
    return {
      available: true,
      maxOpenTrades: Number(process.env.FREQTRADE_MAX_OPEN_TRADES || 30),
      data: await response.json()
    }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'unavailable' }
  }
}

export async function getFreqtradeSnapshot(): Promise<unknown> {
  const base = freqtradeApiBase()
  const endpoints = ['status', 'balance']
  const result: Record<string, unknown> = { available: true }
  try {
    for (const endpoint of endpoints) {
      const response = await freqtradeRequest(base, `/api/v1/${endpoint}`)
      if (!response.ok) return { available: false, status: response.status, endpoint }
      result[endpoint] = await response.json()
    }
    result.mode = 'futures'
    result.marginMode = 'isolated'
    result.dryRun = true
    return result
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'unavailable' }
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function freqtradeHeaders(base: string): Promise<Record<string, string> | undefined> {
  if (process.env.FREQTRADE_API_TOKEN) return { Authorization: `Bearer ${process.env.FREQTRADE_API_TOKEN}` }
  const username = process.env.FREQTRADE_API_USER
  const password = process.env.FREQTRADE_API_PASSWORD
  if (!username || !password) throw new Error('Freqtrade API credentials are not configured')
  if (cachedToken && cachedToken.expiresAt > Date.now()) return { Authorization: `Bearer ${cachedToken.value}` }
  const response = await fetch(`${base}/api/v1/token/login`, {
    method: 'POST', headers: { Authorization: basicAuthorization(username, password) },
    signal: AbortSignal.timeout(3000)
  })
  if (!response.ok) throw new Error(`Freqtrade authentication failed (${response.status})`)
  const payload = await response.json() as { access_token?: string; token?: string }
  const value = payload.access_token || payload.token
  if (!value) throw new Error('Freqtrade authentication returned no token')
  cachedToken = { value, expiresAt: Date.now() + 10 * 60 * 1000 }
  return { Authorization: `Bearer ${value}` }
}
