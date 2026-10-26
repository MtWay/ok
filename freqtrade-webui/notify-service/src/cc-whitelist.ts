/**
 * 单边连续白名单：滚动窗口回测收益排名 → 筛出适合单边连续的品种。
 * 方法与海龟白名单（turtle-whitelist.ts）相同，回测换成
 * consecutiveCandleBacktest（口径对齐实盘 cc 任务）。
 *
 * 结果持久化到 data/cc-whitelist.json，供单边连续自动管理器
 * （cc-auto.ts）消费；可用 maxAgeMs 控制刷新频率。
 */
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { getCachedHistoricalCandles } from './candleCache.js'
import { getPopularPairs, runWithConcurrency, barDurationMs } from './scanner.js'
import { computeSummary } from './turtleBacktest.js'
import { backtestConsecutiveCandle, DEFAULT_CC_PARAMS, type CcBacktestParams } from './consecutiveCandleBacktest.js'
import { loadOscillationLatest } from './oscillation.js'
import { atomicWriteJson } from './storage.js'
import { selectTurtleWhitelist, type TurtleWhitelistEntry } from './turtleAutoCore.js'

const __filename = fileURLToPath(import.meta.url)
const WHITELIST_FILE = path.join(path.dirname(__filename), '../data/cc-whitelist.json')

export interface CcWhitelistConfig {
  timeframe: string      // 默认 1H（与实盘 cc 任务周期一致）
  lookbackBars: number   // 默认 1440（1H × 60 天，与海龟的 360×4H 同窗口）
  minTrades: number      // 默认 3
  topN: number           // 默认 5
}

export const DEFAULT_CC_WHITELIST_CONFIG: CcWhitelistConfig = {
  timeframe: '1H',
  lookbackBars: 1440,
  minTrades: 3,
  topN: 5,
}

export interface CcWhitelist {
  computedAt: number
  config: CcWhitelistConfig
  entries: TurtleWhitelistEntry[]
  selected: string[]
}

export async function loadCcWhitelist(): Promise<CcWhitelist | null> {
  try {
    return JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf-8'))
  } catch {
    return null
  }
}

async function defaultPool(): Promise<string[]> {
  for (const tf of ['1H', '4H']) {
    const scan = await loadOscillationLatest(tf)
    if (scan && scan.results.length >= 10) return scan.results.map(r => r.pair)
  }
  return getPopularPairs()
}

/** 重算白名单（耗时操作：每品种一次 60 天回测，数据走 candleCache） */
export async function refreshCcWhitelist(
  cfg: Partial<CcWhitelistConfig> = {},
  pool?: string[],
  ccParams: CcBacktestParams = DEFAULT_CC_PARAMS,
): Promise<CcWhitelist> {
  const config: CcWhitelistConfig = { ...DEFAULT_CC_WHITELIST_CONFIG, ...cfg }
  const pairs = pool ?? await defaultPool()
  const endMs = Date.now()
  const barMs = barDurationMs(config.timeframe) ?? 3_600_000
  const startMs = endMs - config.lookbackBars * barMs

  const entries: TurtleWhitelistEntry[] = []
  await runWithConcurrency(pairs, 6, async pair => {
    try {
      const data = await getCachedHistoricalCandles(pair, config.timeframe, startMs, endMs, 0)
      if (data.candles.length < 100) return
      const trades = backtestConsecutiveCandle(data.candles, ccParams)
      const summary = computeSummary(trades, 1000)
      entries.push({ pair, returnPct: summary.returnPct, trades: trades.length })
    } catch (err) {
      console.warn(`[CcWhitelist] ${pair} 回测失败:`, err instanceof Error ? err.message : err)
    }
  })

  entries.sort((a, b) => b.returnPct - a.returnPct)
  const whitelist: CcWhitelist = {
    computedAt: Date.now(),
    config,
    entries,
    selected: selectTurtleWhitelist(entries, config), // 纯函数与品种无关，直接复用
  }
  await atomicWriteJson(WHITELIST_FILE, whitelist)
  console.log(`[CcWhitelist] 已刷新: ${whitelist.selected.length}/${entries.length} 入选 → ${whitelist.selected.join(', ')}`)
  return whitelist
}

/** 读缓存的白名单；超过 maxAgeMs 或不存在则重算 */
export async function getCcWhitelist(
  maxAgeMs: number,
  cfg: Partial<CcWhitelistConfig> = {},
  ccParams?: CcBacktestParams,
): Promise<CcWhitelist> {
  const cached = await loadCcWhitelist()
  if (cached && Date.now() - cached.computedAt < maxAgeMs) return cached
  return refreshCcWhitelist(cfg, undefined, ccParams)
}
