import fs from 'fs/promises'
import { freqtradeApiBase, freqtradeRequest } from './trading.js'

const PAIR_PATTERN = /^[A-Z0-9._-]+\/USDT:USDT$/

function configPath(): string {
  const value = process.env.FREQTRADE_CONFIG
  if (!value) throw new Error('FREQTRADE_CONFIG is not configured')
  return value
}

/** Current active whitelist as Freqtrade sees it (includes pairs appended by /forceenter). */
export async function getWhitelist(): Promise<string[]> {
  const base = freqtradeApiBase()
  const response = await freqtradeRequest(base, '/api/v1/whitelist')
  if (!response.ok) throw new Error(`Freqtrade API returned ${response.status}`)
  const payload = await response.json() as { whitelist?: string[] }
  return payload.whitelist ?? []
}

/**
 * Persist the whitelist into the Freqtrade config file, then hot-reload it
 * via /reload_config so no restart is needed. Reloading also drops pairs that
 * /forceenter appended at runtime, which reclaims the candle cache memory
 * they accumulated.
 */
export async function setWhitelist(pairs: string[]): Promise<string[]> {
  const cleaned = [...new Set(pairs.map(pair => String(pair).trim().toUpperCase()).filter(Boolean))]
  if (cleaned.length === 0) throw new Error('whitelist must not be empty')
  for (const pair of cleaned) {
    if (!PAIR_PATTERN.test(pair)) throw new Error(`invalid pair: ${pair}`)
  }

  const file = configPath()
  const config = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>
  config.exchange = config.exchange ?? {}
  config.exchange.pair_whitelist = cleaned
  const tmpFile = `${file}.tmp`
  await fs.writeFile(tmpFile, JSON.stringify(config, null, 2), 'utf8')
  await fs.rename(tmpFile, file)

  const base = freqtradeApiBase()
  const response = await freqtradeRequest(base, '/api/v1/reload_config', { method: 'POST' }, 10_000)
  if (!response.ok) throw new Error(`Freqtrade reload_config failed (${response.status})`)
  return getWhitelist()
}
