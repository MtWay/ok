/**
 * 海龟自动筛选的纯逻辑（无 IO、无副作用，可单测）。
 * turtle-whitelist.ts / turtle-auto.ts 的耗时与持久化操作在各自模块，
 * 纯函数集中在这里以避免测试拖入 node-fetch 等重依赖（进程不退出）。
 */

export interface TurtleWhitelistEntry {
  pair: string
  returnPct: number
  trades: number
}

export interface TurtleWhitelistConfig {
  timeframe: string      // 默认 4H（验证过的周期）
  lookbackDays: number   // 默认 60（验证过的窗口）
  minTrades: number      // 默认 3
  topN: number           // 默认 10
}

export const DEFAULT_TURTLE_WHITELIST_CONFIG: TurtleWhitelistConfig = {
  timeframe: '4H',
  lookbackDays: 60,
  minTrades: 3,
  topN: 10,
}

/** 纯筛选逻辑：交易数过滤 + 收益为正 → 收益降序 → 取前 topN */
export function selectTurtleWhitelist(
  entries: TurtleWhitelistEntry[],
  cfg: Pick<TurtleWhitelistConfig, 'minTrades' | 'topN'>,
): string[] {
  return entries
    .filter(e => e.trades >= cfg.minTrades && e.returnPct > 0)
    .sort((a, b) => b.returnPct - a.returnPct)
    .slice(0, cfg.topN)
    .map(e => e.pair)
}

export interface TurtleAutoDiff {
  toCreate: string[]
  toDisable: string[]
  keepRunning: string[] // 掉出白名单但仍有持仓，继续监控退出
}

/** 任务同步 diff：白名单 vs 已管理任务 → 创建/停用/保留 */
export function diffTurtleAutoTasks(
  whitelistPairs: string[],
  managedTasks: Array<{ id: string; pair: string; enabled: boolean }>,
  openTaskIds: Set<string>,
): TurtleAutoDiff {
  const wl = new Set(whitelistPairs)
  const managedPairs = new Set(managedTasks.map(t => t.pair))
  const toCreate = whitelistPairs.filter(p => !managedPairs.has(p))
  const toDisable: string[] = []
  const keepRunning: string[] = []
  for (const t of managedTasks) {
    if (wl.has(t.pair)) continue
    if (openTaskIds.has(t.id)) keepRunning.push(t.pair)
    else if (t.enabled) toDisable.push(t.pair)
  }
  return { toCreate, toDisable, keepRunning }
}
