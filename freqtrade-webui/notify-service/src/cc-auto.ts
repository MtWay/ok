/**
 * 单边连续自动管理器：定时筛白名单 → 自动维护各品种的单边连续持仓任务。
 * 机制与海龟自动管理器（turtle-auto.ts）完全相同：
 * 1. getCcWhitelist 按 TTL 刷新白名单（60 天 1H 回测收益前 topN）
 * 2. 白名单内无任务的品种 → 创建单边连续持仓任务（autoCcManaged 标记）
 * 3. 掉出白名单的品种 → 无持仓则停用任务；有持仓则保留运行到平仓
 *
 * 退出条件不在这里实现——detectConsecutiveCandle + 持仓计划管理已有
 * 完整退出逻辑（连续中断/ATR 止损/前根 K 线止损），管理器只管"资格"。
 */
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'
import type { PositionTask, ConsecutiveCandleParams } from './types.js'
import { loadPositionTasks, createPositionTask, updatePositionTask, getPositionState } from './position-storage.js'
import { schedulePositionTask, unschedulePositionTask } from './position-scheduler.js'
import { getCcWhitelist, type CcWhitelist, type CcWhitelistConfig } from './cc-whitelist.js'
import { diffTurtleAutoTasks, type TurtleAutoDiff } from './turtleAutoCore.js'
import { DEFAULT_CC_PARAMS } from './consecutiveCandleBacktest.js'
import { atomicWriteJson } from './storage.js'

const __filename = fileURLToPath(import.meta.url)
const CONFIG_FILE = path.join(path.dirname(__filename), '../data/cc-auto.json')

export interface CcAutoConfig {
  enabled: boolean
  /** 白名单刷新间隔（小时），默认 24 */
  refreshHours: number
  /** 白名单参数（timeframe/lookbackBars/minTrades/topN） */
  whitelist: Partial<CcWhitelistConfig>
  /** 新建任务的检测间隔（决定信号用哪档 K 线），默认 1H */
  signalInterval: PositionTask['interval']
  /** 单边连续参数，默认与实盘手动任务一致（5 根 / ATR14 / 2×ATR 止损） */
  ccParams: ConsecutiveCandleParams
  /** 任务级保证金/杠杆（缺省用全局 trading settings） */
  margin?: number
  leverage?: number
}

export const DEFAULT_CC_AUTO_CONFIG: CcAutoConfig = {
  enabled: false,
  refreshHours: 24,
  whitelist: {},
  signalInterval: '1H',
  ccParams: { ...DEFAULT_CC_PARAMS },
}

export async function loadCcAutoConfig(): Promise<CcAutoConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8'))
    return { ...DEFAULT_CC_AUTO_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CC_AUTO_CONFIG }
  }
}

export async function saveCcAutoConfig(cfg: CcAutoConfig): Promise<void> {
  await atomicWriteJson(CONFIG_FILE, cfg)
}

export interface CcAutoSyncResult {
  whitelist: CcWhitelist
  created: string[]
  disabled: string[]
  keepRunning: string[]
}

export async function runCcAutoSync(opts: { forceRefresh?: boolean } = {}): Promise<CcAutoSyncResult | null> {
  const cfg = await loadCcAutoConfig()
  if (!cfg.enabled) return null
  if (running) {
    console.warn('[CcAuto] 上一次同步仍在进行，跳过本次')
    return null
  }
  running = true
  try {
    return await doSync(opts)
  } finally {
    running = false
  }
}

let running = false
export function isCcAutoRunning(): boolean {
  return running
}

async function doSync(opts: { forceRefresh?: boolean }): Promise<CcAutoSyncResult> {
  const cfg = await loadCcAutoConfig()

  const maxAgeMs = opts.forceRefresh ? 0 : cfg.refreshHours * 3600_000
  const whitelist = await getCcWhitelist(maxAgeMs, cfg.whitelist, cfg.ccParams)

  const tasks = await loadPositionTasks()
  const managed = tasks.filter(t => t.autoCcManaged)

  // 有持仓的任务不能因为掉出白名单就停——退出条件还要继续监控
  const openTaskIds = new Set<string>()
  for (const t of managed) {
    const state = await getPositionState(t.id)
    if (state.status !== 'flat') openTaskIds.add(t.id)
  }

  // diff 是纯品种列表逻辑，与海龟共用
  const diff: TurtleAutoDiff = diffTurtleAutoTasks(whitelist.selected, managed, openTaskIds)

  for (const pair of diff.toCreate) {
    const task = await createPositionTask({
      name: `单边连续自动 ${pair}`,
      enabled: true,
      pair,
      strategy: 'consecutive_candle',
      interval: cfg.signalInterval,
      params: cfg.ccParams,
      ...(cfg.margin !== undefined ? { margin: cfg.margin } : {}),
      ...(cfg.leverage !== undefined ? { leverage: cfg.leverage } : {}),
      autoCcManaged: true,
    })
    schedulePositionTask(task)
    console.log(`[CcAuto] 新建任务 ${task.name} (${task.id})`)
  }
  for (const pair of diff.toDisable) {
    const task = managed.find(t => t.pair === pair)!
    await updatePositionTask(task.id, { enabled: false })
    unschedulePositionTask(task.id)
    console.log(`[CcAuto] 停用任务 ${task.name}（掉出白名单且无持仓）`)
  }
  if (diff.keepRunning.length > 0) {
    console.log(`[CcAuto] 掉出白名单但仍有持仓，继续监控: ${diff.keepRunning.join(', ')}`)
  }

  return { whitelist, created: diff.toCreate, disabled: diff.toDisable, keepRunning: diff.keepRunning }
}
