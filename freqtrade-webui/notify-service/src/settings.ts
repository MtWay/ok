import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Runtime trading settings ("添加保证金" 按钮背后的存储).
 *
 * The scheduler and plan calculator read these values for every new plan, so
 * updates from the UI take effect immediately without a service restart. The
 * file is the source of truth; env vars only seed the defaults on first run.
 */
export interface TradingSettings {
  /** Fixed margin (USDT) allocated to each new plan. */
  fixedMargin: number
  /** Default leverage for new plans; the strategy falls back to 10x on pairs
   *  that do not support it. */
  leverage: number
}

export const MAX_LEVERAGE_SETTING = 20

const __filename = fileURLToPath(import.meta.url)
const SETTINGS_FILE = path.join(path.dirname(__filename), '../data/trading-settings.json')

function envDefault(): TradingSettings {
  const fixedMargin = Number(process.env.TRADING_FIXED_MARGIN)
  const leverage = Number(process.env.TRADING_MAX_LEVERAGE)
  return {
    fixedMargin: Number.isFinite(fixedMargin) && fixedMargin > 0 ? fixedMargin : 5,
    leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : 20,
  }
}

function sanitize(value: unknown): TradingSettings {
  const input = (value ?? {}) as Record<string, unknown>
  const fixedMargin = Number(input.fixedMargin)
  const leverage = Number(input.leverage)
  if (!Number.isFinite(fixedMargin) || fixedMargin <= 0) throw new Error('fixedMargin must be a positive number')
  if (!Number.isFinite(leverage) || leverage <= 0 || leverage > MAX_LEVERAGE_SETTING) {
    throw new Error(`leverage must be between 0 and ${MAX_LEVERAGE_SETTING}`)
  }
  return { fixedMargin, leverage }
}

let cache: TradingSettings | undefined

/** Test hook: override the in-memory cache without touching the settings file. */
export function __setTradingSettingsForTest(value: TradingSettings | undefined): void {
  cache = value
}

/** Load settings into the in-memory cache. Call once at service startup. */
export async function loadTradingSettings(): Promise<TradingSettings> {
  try {
    cache = sanitize(JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8')))
  } catch (err: any) {
    if (err.code !== 'ENOENT') console.error('[Settings] Invalid trading-settings.json, falling back to defaults:', err)
    cache = envDefault()
  }
  return cache
}

export function getTradingSettings(): TradingSettings {
  // Tests and one-off scripts may skip loadTradingSettings; fall back to the
  // env-seeded defaults rather than crashing plan creation.
  return cache ?? envDefault()
}

export async function updateTradingSettings(patch: Record<string, unknown>): Promise<TradingSettings> {
  const next = sanitize({ ...getTradingSettings(), ...patch })
  cache = next
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true })
  const tmpFile = `${SETTINGS_FILE}.tmp`
  await fs.writeFile(tmpFile, JSON.stringify(next, null, 2), 'utf-8')
  await fs.rename(tmpFile, SETTINGS_FILE)
  return next
}
