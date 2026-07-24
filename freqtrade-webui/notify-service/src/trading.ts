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
  executionAttempts?: number
  nextRetryAt?: number
}

const MAX_EXECUTION_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 15_000

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
    throw error
  }
}

async function savePlans(plans: TradePlan[]): Promise<void> {
  await fs.mkdir(path.dirname(PLAN_FILE), { recursive: true })
  await fs.writeFile(PLAN_FILE, JSON.stringify(plans, null, 2), 'utf8')
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
    try {
      const base = process.env.FREQTRADE_API_URL || 'http://127.0.0.1:8091'
      const headers = { ...(await freqtradeHeaders(base)), 'Content-Type': 'application/json' }
      const response = await fetch(`${base}/api/v1/forceenter`, {
        method: 'POST', headers,
        body: JSON.stringify({ pair: plan.pair, side: plan.side, price: plan.entryPrice }),
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) throw new Error(`forceenter failed (${response.status})`)
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
      plan.status = 'submit_failed'
      plan.executionError = error instanceof Error ? error.message : String(error)
      if (plan.executionAttempts < MAX_EXECUTION_ATTEMPTS) {
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

export async function syncPlanPositions(): Promise<TradePlan[]> {
  const plans = await loadPlans()
  const active = plans.filter(plan => plan.status === 'open' && plan.tradeId)
  if (!active.length) return plans
  const base = process.env.FREQTRADE_API_URL || 'http://127.0.0.1:8091'
  let statuses: Array<Record<string, any>>
  try {
    const response = await fetch(`${base}/api/v1/status`, { headers: await freqtradeHeaders(base), signal: AbortSignal.timeout(5000) })
    if (!response.ok) return plans
    statuses = await response.json() as Array<Record<string, any>>
  } catch (error) {
    console.error('[Trading] Unable to sync Freqtrade positions:', error)
    return plans
  }
  for (const plan of active) {
    const status = statuses.find(item => String(item.trade_id ?? item.id) === String(plan.tradeId))
    if (!status) { plan.status = 'closed'; plan.closedAt = Date.now(); plan.updatedAt = Date.now() }
    else {
      Object.assign(plan, {
        currentRate: Number(status.current_rate ?? status.currentRate ?? 0) || undefined,
        currentProfit: Number(status.profit_ratio ?? status.current_profit ?? 0) || undefined,
        actualEntryPrice: Number(status.open_rate ?? status.entry_price ?? 0) || undefined,
        amount: Number(status.amount ?? 0) || undefined,
        stopLoss: Number(status.stop_loss_abs ?? status.stoploss_abs ?? 0) || undefined,
      })
    }
  }
  await savePlans(plans)
  return plans
}

export async function getFreqtradeStatus(): Promise<unknown> {
  const base = process.env.FREQTRADE_API_URL || 'http://127.0.0.1:8081'
  try {
    const headers = await freqtradeHeaders(base)
    const response = await fetch(`${base}/api/v1/status`, { headers, signal: AbortSignal.timeout(3000) })
    if (!response.ok) return { available: false, status: response.status }
    return { available: true, data: await response.json() }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'unavailable' }
  }
}

export async function getFreqtradeSnapshot(): Promise<unknown> {
  const base = process.env.FREQTRADE_API_URL || 'http://127.0.0.1:8081'
  const endpoints = ['status', 'balance']
  const result: Record<string, unknown> = { available: true }
  try {
    const headers = await freqtradeHeaders(base)
    for (const endpoint of endpoints) {
      const response = await fetch(`${base}/api/v1/${endpoint}`, { headers, signal: AbortSignal.timeout(3000) })
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
  if (!username || !password) return undefined
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
