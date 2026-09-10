import { CronJob } from 'cron'
import { fetchPopularPairs, invalidatePairCache } from './scanner.js'
import { setWhitelist } from './whitelist.js'

const ENABLED = process.env.WHITELIST_SYNC_ENABLED !== 'false'
const TOP_N = Math.max(1, Number(process.env.WHITELIST_SYNC_TOP_N ?? 30) || 30)
const CRON = process.env.WHITELIST_SYNC_CRON?.trim() || '0 23 * * *'

/**
 * 用 OKX 24h 成交额前 N 的 USDT 永续覆盖 Freqtrade 白名单（写配置 + 热重载）。
 * fetchPopularPairs 失败时会降级返回 10 个内置 fallback 币对，数量不足说明
 * OKX 拉取失败——此时中止同步，绝不用 fallback 小列表覆盖现有白名单。
 */
export async function syncWhitelistFromTopVolume(topN = TOP_N): Promise<string[]> {
  const instIds = await fetchPopularPairs(topN)
  if (instIds.length < topN) {
    throw new Error(`OKX returned only ${instIds.length} pairs (< ${topN}), aborting whitelist sync`)
  }
  const pairs = instIds.map(instId => instId.replace(/-USDT-SWAP$/i, '/USDT:USDT'))
  const whitelist = await setWhitelist(pairs)
  invalidatePairCache()
  console.log(`[WhitelistSync] Whitelist updated: top ${whitelist.length} pairs by 24h turnover`)
  return whitelist
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
