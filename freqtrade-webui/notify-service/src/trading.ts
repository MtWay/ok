import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

export type TradeSide = 'long' | 'short'
export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'expired'

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

export async function getFreqtradeStatus(): Promise<unknown> {
  const base = process.env.FREQTRADE_API_URL || 'http://127.0.0.1:8081'
  const headers = await freqtradeHeaders(base)
  try {
    const response = await fetch(`${base}/api/v1/status`, { headers, signal: AbortSignal.timeout(3000) })
    if (!response.ok) return { available: false, status: response.status }
    return { available: true, data: await response.json() }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'unavailable' }
  }
}

export async function getFreqtradeSnapshot(): Promise<unknown> {
  const base = process.env.FREQTRADE_API_URL || 'http://127.0.0.1:8081'
  const headers = await freqtradeHeaders(base)
  const endpoints = ['status', 'balance']
  const result: Record<string, unknown> = { available: true }
  try {
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(3000)
  })
  if (!response.ok) throw new Error(`Freqtrade authentication failed (${response.status})`)
  const payload = await response.json() as { access_token?: string; token?: string }
  const value = payload.access_token || payload.token
  if (!value) throw new Error('Freqtrade authentication returned no token')
  cachedToken = { value, expiresAt: Date.now() + 10 * 60 * 1000 }
  return { Authorization: `Bearer ${value}` }
}
