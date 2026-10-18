/**
 * 海龟白名单：滚动窗口海龟 S2 收益排名 → 筛出适合海龟的品种。
 *
 * 依据 docs/strategy-fit-结果.md 的 walk-forward 验证：
 * 过去 60 天 4H 海龟 S2 收益排名前 1/3 的品种，下一窗口持续大幅跑赢
 * 全体平均（10/10 步正超额，均值 +19%/窗）。落地时加"排名窗口内
 * 交易数 ≥ 3"过滤，防止单笔幸运交易混进名单。
 *
 * 结果持久化到 data/turtle-whitelist.json，供海龟自动管理器
 * （turtle-auto.ts）消费；可用 maxAgeMs 控制刷新频率。
 */
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { getCachedHistoricalCandles } from './candleCache.js'
import { getPopularPairs, runWithConcurrency, barDurationMs } from './scanner.js'
import { backtestPair, computeSummary } from './turtleBacktest.js'
import { loadOscillationLatest } from './oscillation.js'
import { atomicWriteJson } from './storage.js'
import {
  selectTurtleWhitelist,
  DEFAULT_TURTLE_WHITELIST_CONFIG,
  type TurtleWhitelistEntry,
  type TurtleWhitelistConfig,
} from './turtleAutoCore.js'

export {
  selectTurtleWhitelist,
  DEFAULT_TURTLE_WHITELIST_CONFIG,
  type TurtleWhitelistEntry,
  type TurtleWhitelistConfig,
} from './turtleAutoCore.js'

const __filename = fileURLToPath(import.meta.url)
const WHITELIST_FILE = path.join(path.dirname(__filename), '../data/turtle-whitelist.json')

export interface TurtleWhitelist {
  computedAt: number
  config: TurtleWhitelistConfig
  /** 全部参评品种的收益（降序），selected 是其中通过过滤的前 topN */
  entries: TurtleWhitelistEntry[]
  selected: string[]
}

export async function loadTurtleWhitelist(): Promise<TurtleWhitelist | null> {
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
export async function refreshTurtleWhitelist(
  cfg: Partial<TurtleWhitelistConfig> = {},
  pool?: string[],
): Promise<TurtleWhitelist> {
  const config: TurtleWhitelistConfig = { ...DEFAULT_TURTLE_WHITELIST_CONFIG, ...cfg }
  const pairs = pool ?? await defaultPool()
  const endMs = Date.now()
  const barMs = barDurationMs(config.timeframe) ?? 3_600_000
  const startMs = endMs - config.lookbackBars * barMs

  const entries: TurtleWhitelistEntry[] = []
  await runWithConcurrency(pairs, 6, async pair => {
    try {
      const data = await getCachedHistoricalCandles(pair, config.timeframe, startMs, endMs, 0)
      if (data.candles.length < 100) return
      // 只跑 S2（长周期系统，验证中更优）：entryBars=55/exitBars=20
      const r = await backtestPair(pair, data.candles, data.timestamps, {}, 1000)
      const s2 = computeSummary(r.trades.filter(t => t.system === 'S2').map(t => t.trade), 1000)
      entries.push({ pair, returnPct: s2.returnPct, trades: r.trades.filter(t => t.system === 'S2').length })
    } catch (err) {
      console.warn(`[TurtleWhitelist] ${pair} 回测失败:`, err instanceof Error ? err.message : err)
    }
  })

  entries.sort((a, b) => b.returnPct - a.returnPct)
  const whitelist: TurtleWhitelist = {
    computedAt: Date.now(),
    config,
    entries,
    selected: selectTurtleWhitelist(entries, config),
  }
  await atomicWriteJson(WHITELIST_FILE, whitelist)
  console.log(`[TurtleWhitelist] 已刷新: ${whitelist.selected.length}/${entries.length} 入选 → ${whitelist.selected.join(', ')}`)
  return whitelist
}

/** 读缓存的白名单；超过 maxAgeMs 或不存在则重算 */
export async function getTurtleWhitelist(
  maxAgeMs: number,
  cfg: Partial<TurtleWhitelistConfig> = {},
): Promise<TurtleWhitelist> {
  const cached = await loadTurtleWhitelist()
  if (cached && Date.now() - cached.computedAt < maxAgeMs) return cached
  return refreshTurtleWhitelist(cfg)
}
