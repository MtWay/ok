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
 *
 * This is only the FLOOR. profit_ratio is margin-based (leverage included),
 * so a flat 3% fired at ~1.5% price distance with 2x leverage — closer than
 * the plan's own stopPrice — and pre-empted plan_stoploss on almost every
 * trade (13 hard stops vs 1 plan stop in diagnostics). See planHardStopRatio.
 */
export function hardStopPercent(value = process.env.TRADING_HARD_STOP_PERCENT): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HARD_STOP_PERCENT
}

/** Buffer beyond the plan's own stop so the hard stop stays the last resort. */
const HARD_STOP_BUFFER = 1.2

/**
 * Per-plan hard stop as a margin-based profit ratio. Sits just beyond the
 * plan's own stopPrice (price distance × leverage × buffer) so plan_stoploss
 * normally triggers first; the configured hardStopPercent remains the floor
 * for plans whose stop is extremely tight. Never below the floor.
 */
export function planHardStopRatio(plan: Pick<TradePlan, 'entryPrice' | 'stopPrice' | 'leverage' | 'actualEntryPrice'>): number {
  const floor = hardStopPercent() / 100
  const entry = plan.actualEntryPrice ?? plan.entryPrice
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(plan.stopPrice)) return floor
  const stopDistance = Math.abs(entry - plan.stopPrice) / entry
  const leverage = Number.isFinite(plan.leverage) && plan.leverage > 0 ? plan.leverage : 1
  return Math.max(floor, stopDistance * leverage * HARD_STOP_BUFFER)
}

export function freqtradeApiBase(): string {
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

const MAX_NOTIONAL = 2500
/**
 * Cap on the entry-to-stop distance. The scanner's "nearest swing level" can
 * sit 20%+ away after a spike; such stops both warped risk-based sizing into
 * dust positions and defeated the hard stop. Signals beyond the cap are
 * rejected instead of traded.
 */
const MAX_STOP_DISTANCE = 0.05

export function calculatePlan(input: Record<string, unknown>): Omit<TradePlan, 'id' | 'status' | 'executionEnabled' | 'createdAt' | 'updatedAt'> {
  const pair = String(input.pair || '').trim()
  const side = input.side === 'short' ? 'short' : input.side === 'long' ? 'long' : null
  if (!pair || !side) throw new Error('pair and side are required')
  const entryPrice = positive(input.entryPrice, 'entryPrice')
  const stopPrice = positive(input.stopPrice, 'stopPrice')
  const takeProfit1 = positive(input.takeProfit1, 'takeProfit1')
  const takeProfit2 = positive(input.takeProfit2, 'takeProfit2')
  const leverage = Math.min(2, positive(input.leverage ?? 2, 'leverage'))
  const distance = Math.abs(entryPrice - stopPrice) / entryPrice
  if (distance < 0.005) throw new Error('stop distance must be at least 0.5%')
  if (distance > MAX_STOP_DISTANCE) throw new Error('stop distance must be at most 5%')
  if (side === 'long' && !(stopPrice < entryPrice && takeProfit1 > entryPrice && takeProfit2 > takeProfit1)) throw new Error('invalid long prices')
  if (side === 'short' && !(stopPrice > entryPrice && takeProfit1 < entryPrice && takeProfit2 < takeProfit1)) throw new Error('invalid short prices')
  const fixedMargin = input.margin !== undefined ? positive(input.margin, 'margin') : undefined
  let notional: number
  let equity: number
  let riskFraction: number
  if (fixedMargin !== undefined) {
    // Fixed-margin sizing: the caller dictates the stake and the loss at the
    // stop scales with the stop distance. Risk-based sizing (margin = maxLoss
    // / distance) produced dust stakes whenever the swing stop sat far away.
    equity = Number.isFinite(Number(input.equity)) ? Number(input.equity) : 0
    riskFraction = Number.isFinite(Number(input.riskFraction)) ? Number(input.riskFraction) : 0
    notional = Math.min(fixedMargin * leverage, MAX_NOTIONAL)
  } else {
    equity = positive(input.equity, 'equity')
    riskFraction = Number(input.riskFraction ?? 0.005)
    if (!Number.isFinite(riskFraction) || riskFraction <= 0 || riskFraction > 0.01) throw new Error('riskFraction must be between 0 and 0.01')
    const maxLoss = equity * riskFraction
    notional = Math.min(maxLoss / distance, MAX_NOTIONAL)
  }
  return { pair, side, entryPrice, stopPrice, takeProfit1, takeProfit2, leverage, equity, riskFraction, notional, margin: notional / leverage, maxLoss: notional * distance }
}

/**
 * Derive plan targets in the trade direction. The first target is lifted to
 * at least 2R: the raw swing target is the *nearest* swing level, which sat
 * only ~0.4% away in practice — diagnostics showed take-profits averaging
 * +0.8% against stop losses of -3.6%, an inverted ~1:5 payoff. The second
 * target is always one R beyond the first. Swing targets can be farther than
 * 2R, so entry +/- 2R alone can otherwise produce an invalid target order.
 */
export function buildAutoPlanPrices(
  side: TradeSide,
  entryPrice: number,
  stopPrice: number,
  takeProfit1: number,
): AutoPlanPrices {
  const risk = Math.abs(entryPrice - stopPrice)
  if (!Number.isFinite(risk) || risk <= 0) throw new Error('stop price must differ from entry price')

  const minTarget = side === 'long' ? entryPrice + risk * 2 : entryPrice - risk * 2
  const liftedTakeProfit1 = side === 'long'
    ? Math.max(takeProfit1, minTarget)
    : Math.min(takeProfit1, minTarget)
  const takeProfit2 = side === 'long'
    ? liftedTakeProfit1 + risk
    : liftedTakeProfit1 - risk

  return { entryPrice, stopPrice, takeProfit1: liftedTakeProfit1, takeProfit2 }
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
        try {
          await closeOrphanTrade(base, status)
          closedPositions++
        } catch (error) {
          console.error(`[Trading] Unable to close orphan trade ${tradeId}:`, error)
        }
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

/**
 * Keep the scanner signal that produced the plan on the plan itself. The
 * scheduler passes it in (scheduler.ts), but calculatePlan only returns
 * pricing fields — without this passthrough plan.signal was always undefined
 * and the diagnostics export's signal columns were permanently empty.
 */
export function sanitizeSignal(value: unknown): TradePlan['signal'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const signal = value as Record<string, unknown>
  const timeframe = String(signal.timeframe || '')
  const trendScore = Number(signal.trendScore)
  const riskRewardTight = Number(signal.riskRewardTight)
  const trailingStopPercent = Number(signal.trailingStopPercent)
  const strategyRecommendation = String(signal.strategyRecommendation || '')
  if (!timeframe || !Number.isFinite(trendScore) || !Number.isFinite(riskRewardTight) || !Number.isFinite(trailingStopPercent)) return undefined
  return { timeframe, trendScore, riskRewardTight, trailingStopPercent, strategyRecommendation }
}

export async function createTradePlan(input: Record<string, unknown>): Promise<TradePlan> {
  const now = Date.now()
  const signal = sanitizeSignal(input.signal)
  const plan = { ...calculatePlan(input), ...(signal ? { signal } : {}), id: `plan_${now}_${Math.random().toString(36).slice(2, 8)}`, status: 'pending' as PlanStatus, executionEnabled: false as const, createdAt: now, updatedAt: now }
  const plans = await loadPlans()
  plans.push(plan)
  await savePlans(plans)
  return plan
}

const SOURCE_KEY_BLOCKING_STATUSES = new Set<PlanStatus>(['pending', 'approved', 'submitting', 'open'])

/**
 * Cooldown after a failed submission during which no new plan is created for
 * the same source key. Without it the scanner spawned a duplicate plan on
 * every run while the original was still retrying or freshly failed —
 * diagnostics showed up to 18 plans per pair and a 61% submit_failed rate.
 */
const SUBMIT_FAILED_BLOCK_MS = 30 * 60_000

/**
 * A source key (task + pair + timeframe) is occupied while a plan for it is
 * still alive, or briefly after a submission failure. Terminal plans —
 * closed, rejected, expired, and submit_failed once retries are exhausted and
 * the cooldown has passed — must not block the next signal for the same pair;
 * otherwise one failed submission permanently disabled re-entry on that
 * pair/timeframe.
 */
export function isSourceKeyBlocked(plans: TradePlan[], sourceKey: string, now = Date.now()): boolean {
  return plans.some(plan => {
    if (plan.sourceKey !== sourceKey) return false
    if (SOURCE_KEY_BLOCKING_STATUSES.has(plan.status)) return true
    if (plan.status === 'submit_failed') {
      // Still backing off for a retry, or failed within the cooldown window.
      if (plan.nextRetryAt !== undefined && plan.nextRetryAt > now) return true
      return now - plan.updatedAt < SUBMIT_FAILED_BLOCK_MS
    }
    return false
  })
}

export async function createAutoSimulationPlan(input: Record<string, unknown>): Promise<TradePlan | null> {
  if (process.env.TRADING_DRY_RUN !== 'true') throw new Error('Automatic approval requires TRADING_DRY_RUN=true')
  const sourceKey = String(input.sourceKey || '')
  if (!sourceKey) throw new Error('sourceKey is required for automatic plans')
  const plans = await loadPlans()
  if (isSourceKeyBlocked(plans, sourceKey)) return null
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
  const executable = plans.filter(item => canExecutePlan(item))
  if (!executable.length) return
  const base = freqtradeApiBase()
  // Free stake in the dry-run wallet. Without this check a nearly-exhausted
  // wallet clamped entries into dust-sized positions (observed: 1.75 / 0.64
  // USDT stakes that still occupied a max_open_trades slot).
  let freeStake = await fetchFreeStake(base)
  for (const plan of executable) {
    if (freeStake !== undefined && freeStake < plan.margin / 2) {
      console.error(`[Trading] Plan ${plan.id} deferred: free stake ${freeStake.toFixed(2)} USDT cannot cover half the planned margin ${plan.margin.toFixed(2)}`)
      continue
    }
    plan.status = 'submitting'
    plan.executionAttempts = (plan.executionAttempts ?? 0) + 1
    plan.nextRetryAt = undefined
    plan.updatedAt = Date.now()
    await savePlans(plans)
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
      if (freeStake !== undefined) freeStake -= plan.margin
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

/**
 * Free stake currency in the Freqtrade wallet. Undefined when the balance
 * endpoint cannot be read — callers must treat that as "unknown" and proceed
 * rather than blocking execution on a read failure.
 */
async function fetchFreeStake(base: string): Promise<number | undefined> {
  try {
    const response = await freqtradeRequest(base, '/api/v1/balance', {}, 5_000)
    if (!response.ok) return undefined
    const payload = await response.json() as Record<string, any>
    const currencies = Array.isArray(payload.currencies) ? payload.currencies : []
    const stake = currencies.find(item => item?.currency === 'USDT')
    return optionalNumber(stake?.free)
  } catch {
    return undefined
  }
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

export async function freqtradeRequest(
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

const ORPHAN_GRACE_MS = 5 * 60_000

/**
 * Open Freqtrade trades that no plan tracks. The strategy never exits on its
 * own (stoploss -99%, no ROI, no exit signal), so an untracked trade locks
 * margin forever — that is how ghost positions piled up historically. The
 * grace period skips very young trades whose forceenter may still be saving
 * its tradeId.
 */
export function findOrphanTrades(statuses: Array<Record<string, any>>, trackedIds: Set<string>, now = Date.now()): Array<Record<string, any>> {
  return statuses.filter(status => {
    const tradeId = status.trade_id ?? status.id
    if (tradeId === undefined || trackedIds.has(String(tradeId))) return false
    const openedAt = toTimestamp(status.open_date_ts ?? status.open_date)
    return openedAt === undefined || now - openedAt >= ORPHAN_GRACE_MS
  })
}

function orphanClosingEnabled(): boolean {
  return process.env.TRADING_CLOSE_ORPHANS !== 'false'
}

/**
 * An orphan whose entry order never filled has no position to sell — forceexit
 * answers 502 forever (observed: trades 121-123 spamming every sync). Those
 * must be deleted instead, which also cancels the resting entry order.
 */
export function orphanCloseAction(status: Record<string, any>): 'delete' | 'forceexit' {
  const amount = optionalNumber(status.amount)
  return !amount || amount <= 0 ? 'delete' : 'forceexit'
}

const orphanCloseBackoff = new Map<string, { attempts: number; nextRetryAt: number }>()

function orphanRetryDue(tradeId: string, now: number): boolean {
  const state = orphanCloseBackoff.get(tradeId)
  return !state || state.nextRetryAt <= now
}

function orphanRetryFailed(tradeId: string, now: number): void {
  const state = orphanCloseBackoff.get(tradeId) ?? { attempts: 0, nextRetryAt: 0 }
  state.attempts += 1
  // 1m, 2m, 4m … capped at 15m so a stubborn orphan does not spam every sync.
  state.nextRetryAt = now + Math.min(15 * 60_000, 60_000 * 2 ** (state.attempts - 1))
  orphanCloseBackoff.set(tradeId, state)
}

async function closeOrphanTrade(base: string, orphan: Record<string, any>): Promise<void> {
  const tradeId = String(orphan.trade_id ?? orphan.id)
  if (orphanCloseAction(orphan) === 'delete') {
    const response = await freqtradeRequest(base, `/api/v1/trades/${encodeURIComponent(tradeId)}`, { method: 'DELETE' }, 5_000)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`delete trade failed (${response.status}): ${body.slice(0, 200)}`)
    }
    console.log(`[Trading] Deleted orphan trade ${tradeId} (${orphan.pair}) with unfilled entry — nothing to sell`)
    return
  }
  const response = await freqtradeRequest(base, '/api/v1/forceexit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tradeid: tradeId, ordertype: 'market' }),
  }, 5_000)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`forceexit failed (${response.status}): ${body.slice(0, 200)}`)
  }
  console.log(`[Trading] Closed orphan trade ${tradeId} (${orphan.pair}) — not tracked by any plan`)
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

const ZOMBIE_PLAN_GRACE_MS = 5 * 60_000

/**
 * A crash between marking a plan 'submitting' and storing the returned trade
 * id strands the plan forever: the sync loop matches on tradeId, so plans
 * without one are never advanced (they clogged the positions panel for days
 * with "--" cards). Fail them past the retry cap — the real Freqtrade state
 * is unknown, and if the interrupted forceenter did fill, the orphan sweep
 * closes that trade.
 */
export function failZombiePlans(plans: TradePlan[], now = Date.now()): number {
  let failed = 0
  for (const plan of plans) {
    if (plan.tradeId || (plan.status !== 'submitting' && plan.status !== 'open')) continue
    if (now - plan.updatedAt < ZOMBIE_PLAN_GRACE_MS) continue
    plan.status = 'submit_failed'
    plan.executionAttempts = MAX_EXECUTION_ATTEMPTS
    plan.nextRetryAt = undefined
    plan.executionError = 'no trade id recorded within 5 minutes of submission (service restart?); freqtrade state unknown'
    plan.updatedAt = now
    failed += 1
  }
  return failed
}

export async function syncPlanPositions(): Promise<TradePlan[]> {
  const plans = await loadPlans()
  const zombieCount = failZombiePlans(plans)
  if (zombieCount > 0) {
    console.error(`[Trading] Marked ${zombieCount} plan(s) stuck without a trade id as submit_failed`)
    await savePlans(plans)
  }
  const tracked = plans.filter(plan => plan.tradeId)
  // With no tracked plans the position sync is a no-op, but the orphan sweep
  // below still needs to run — that is exactly the state after a plan clear.
  if (!tracked.length && !orphanClosingEnabled()) return plans
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
        if (profitRatio !== undefined && profitRatio <= -planHardStopRatio(plan)) {
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
            // Persist the reason immediately: it only lives in memory until
            // the end-of-sync save, so a restart in between loses it and the
            // close is later recorded as an unattributed 'force_exit'.
            await savePlans(plans)
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
        const closeRatio = optionalNumber(history.close_profit ?? history.profit_ratio)
        const closePnlAbs = optionalNumber(history.close_profit_abs ?? history.profit_abs)
        const stake = optionalNumber(history.stake_amount)
        // Some Freqtrade records carry close_profit (margin-based ratio) but
        // no close_profit_abs, which left settled positions with a ratio but
        // no money value and broke the equity curve. Derive it in that case.
        const derivedPnl = closePnlAbs ?? (closeRatio !== undefined && stake !== undefined ? closeRatio * stake : undefined)
        Object.assign(plan, {
          status: 'closed',
          closedAt: toTimestamp(history.close_date_ts ?? history.close_date) ?? plan.closedAt ?? Date.now(),
          exitRate: optionalNumber(history.close_rate ?? history.exit_rate),
          actualEntryPrice: optionalNumber(history.open_rate ?? history.entry_price) ?? plan.actualEntryPrice,
          margin: stake ?? plan.margin,
          realizedPnl: derivedPnl,
          currentProfit: closeRatio,
          currentProfitAbs: derivedPnl,
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

    // Self-healing orphan sweep: close any Freqtrade trade no plan tracks.
    // The strategy owns no exits, so orphans would otherwise float forever
    // and lock the dry-run wallet (observed: 20 ghosts, ~90% margin used).
    if (orphanClosingEnabled()) {
      const trackedIds = new Set(tracked.map(plan => String(plan.tradeId)))
      for (const orphan of findOrphanTrades(statuses, trackedIds)) {
        const tradeId = String(orphan.trade_id ?? orphan.id)
        if (!orphanRetryDue(tradeId, Date.now())) continue
        try {
          await closeOrphanTrade(base, orphan)
          orphanCloseBackoff.delete(tradeId)
        } catch (error) {
          orphanRetryFailed(tradeId, Date.now())
          console.error(`[Trading] Unable to close orphan trade ${tradeId}:`, error)
        }
      }
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
