import { CronJob } from 'cron'
import { fetchPopularPairs, invalidatePairCache } from './scanner.js'
import { setWhitelist, toFreqtradePair } from './whitelist.js'
import { fetchOpenPairs, freqtradeApiBase } from './trading.js'
import { loadPositionTasks } from './position-storage.js'

const ENABLED = process.env.WHITELIST_SYNC_ENABLED !== 'false'
const TOP_N = Math.max(1, Number(process.env.WHITELIST_SYNC_TOP_N ?? 30) || 30)
const CRON = process.env.WHITELIST_SYNC_CRON?.trim() || '0 23 * * *'

/**
 * 用 OKX 24h 成交额前 N 的 USDT 永续覆盖 Freqtrade 白名单（写配置 + 热重载）。
 * fetchPopularPairs 失败时会降级返回 10 个内置 fallback 币对，数量不足说明
 * OKX 拉取失败——此时中止同步，绝不用 fallback 小列表覆盖现有白名单。
 *
 * 同步前会收集仍有仓位或策略的对，合并到新白名单中，防止覆盖后丢失。
 */
export async function syncWhitelistFromTopVolume(topN = TOP_N): Promise<string[]> {
  const instIds = await fetchPopularPairs(topN)
  if (instIds.length < topN) {
    throw new Error(`OKX returned only ${instIds.length} pairs (< ${topN}), aborting whitelist sync`)
  }
  const topPairs = instIds.map(instId => instId.replace(/-USDT-SWAP$/i, '/USDT:USDT'))

  // 收集需要保护的对：Freqtrade 持仓 + 非空仓策略任务
  const protectedPairs = await collectProtectedPairs()
  if (protectedPairs.length > 0) {
    console.log(`[WhitelistSync] Protecting ${protectedPairs.length} pairs with active positions/strategies: ${protectedPairs.join(', ')}`)
  }

  // 合并：top-N + 保护对（去重）
  const merged = [...new Set([...topPairs, ...protectedPairs])]
  const whitelist = await setWhitelist(merged)
  invalidatePairCache()
  console.log(`[WhitelistSync] Whitelist updated: ${whitelist.length} pairs (top ${topPairs.length} + ${protectedPairs.length} protected)`)
  return whitelist
}

/** 收集仍有仓位或策略的对（Freqtrade 格式）。 */
async function collectProtectedPairs(): Promise<string[]> {
  const protectedSet = new Set<string>()
  const base = freqtradeApiBase()

  // 1. Freqtrade 当前持仓对
  try {
    const openPairs = await fetchOpenPairs(base)
    if (openPairs) {
      for (const pair of openPairs) protectedSet.add(pair.toUpperCase())
    }
  } catch (err) {
    console.warn('[WhitelistSync] Failed to fetch open pairs:', err)
  }

  // 2. 所有启用的策略任务对（包括空仓，防止触发时建仓失败）
  try {
    const tasks = await loadPositionTasks()
    for (const task of tasks) {
      if (!task.enabled) continue
      protectedSet.add(toFreqtradePair(task.pair))
    }
  } catch (err) {
    console.warn('[WhitelistSync] Failed to load position tasks:', err)
  }

  return Array.from(protectedSet)
}

/** 每天定时把 OKX 成交额前 N 名写入白名单（cron 用服务器本地时区）。 */
export function startWhitelistSyncJob(): void {
  if (!ENABLED) {
    console.log('[WhitelistSync] Disabled (WHITELIST_SYNC_ENABLED=false)')
    return
  }
  const job = new CronJob(CRON, () => {
    syncWhitelistFromTopVolume().catch(err =>
      console.error('[WhitelistSync] Daily whitelist sync failed:', err))
  })
  job.start()
  console.log(`[WhitelistSync] Scheduled whitelist sync (cron: ${CRON}, top ${TOP_N})`)
}
