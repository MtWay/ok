/**
 * 海龟自动管理器：定时筛白名单 → 自动维护各品种的海龟持仓任务。
 *
 * 流程（每日 cron + 手动刷新触发）：
 * 1. getTurtleWhitelist 按 TTL 刷新白名单（60 天 4H S2 收益前 topN）
 * 2. 白名单内无任务的品种 → 创建海龟持仓任务（autoTurtleManaged 标记）
 *    → 之后由各任务自己的 cron 检测信号、触发建仓
 * 3. 掉出白名单的品种 → 无持仓则停用任务；有持仓则保留运行，
 *    让海龟退出条件（退出通道/ATR 止损）继续监控到平仓
 *
 * 退出条件不在这里实现——detectTurtle + 持仓计划管理已有完整海龟
 * 退出逻辑（exitBars 通道、unit 加仓、止损），管理器只管"资格"。
 */
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'
import type { PositionTask, TurtlePositionParams } from './types.js'
import { loadPositionTasks, createPositionTask, updatePositionTask, getPositionState } from './position-storage.js'
import { schedulePositionTask, unschedulePositionTask } from './position-scheduler.js'
import { getTurtleWhitelist, type TurtleWhitelist, type TurtleWhitelistConfig } from './turtle-whitelist.js'
import { diffTurtleAutoTasks, type TurtleAutoDiff } from './turtleAutoCore.js'
import { atomicWriteJson } from './storage.js'

export { diffTurtleAutoTasks, type TurtleAutoDiff } from './turtleAutoCore.js'

const __filename = fileURLToPath(import.meta.url)
const CONFIG_FILE = path.join(path.dirname(__filename), '../data/turtle-auto.json')

export interface TurtleAutoConfig {
  enabled: boolean
  /** 白名单刷新间隔（小时），默认 24 */
  refreshHours: number
  /** 白名单参数（timeframe/lookbackDays/minTrades/topN） */
  whitelist: Partial<TurtleWhitelistConfig>
  /** 新建任务的检测间隔（决定信号用哪档 K 线），默认 4H */
  signalInterval: PositionTask['interval']
  /** 海龟参数，默认 S2（55/20，验证中 PF 最优） */
  turtleParams: TurtlePositionParams
  /** 任务级保证金/杠杆（缺省用全局 trading settings） */
  margin?: number
  leverage?: number
}

export const DEFAULT_TURTLE_AUTO_CONFIG: TurtleAutoConfig = {
  enabled: false,
  refreshHours: 24,
  whitelist: {},
  signalInterval: '4H',
  // S2 参数（验证中 PF 最优）；maxUnits=1 与回测口径一致（不加仓）
  turtleParams: { entryBars: 55, exitBars: 20, atrPeriod: 14, maxUnits: 1, unitStepAtr: 0.5, stopAtr: 2 },
}

export async function loadTurtleAutoConfig(): Promise<TurtleAutoConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8'))
    return { ...DEFAULT_TURTLE_AUTO_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_TURTLE_AUTO_CONFIG }
  }
}

export async function saveTurtleAutoConfig(cfg: TurtleAutoConfig): Promise<void> {
  await atomicWriteJson(CONFIG_FILE, cfg)
}

export interface TurtleAutoSyncResult {
  whitelist: TurtleWhitelist
  created: string[]
  disabled: string[]
  keepRunning: string[]
}

export async function runTurtleAutoSync(opts: { forceRefresh?: boolean } = {}): Promise<TurtleAutoSyncResult | null> {
  const cfg = await loadTurtleAutoConfig()
  if (!cfg.enabled) return null
  if (running) {
    console.warn('[TurtleAuto] 上一次同步仍在进行，跳过本次')
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
export function isTurtleAutoRunning(): boolean {
  return running
}

async function doSync(opts: { forceRefresh?: boolean }): Promise<TurtleAutoSyncResult> {
  const cfg = await loadTurtleAutoConfig()

  const maxAgeMs = opts.forceRefresh ? 0 : cfg.refreshHours * 3600_000
  const whitelist = await getTurtleWhitelist(maxAgeMs, cfg.whitelist)

  const tasks = await loadPositionTasks()
  const managed = tasks.filter(t => t.autoTurtleManaged)

  // 有持仓的任务不能因为掉出白名单就停——退出条件还要继续监控
  const openTaskIds = new Set<string>()
  for (const t of managed) {
    const state = await getPositionState(t.id)
    if (state.status !== 'flat') openTaskIds.add(t.id)
  }

  const diff = diffTurtleAutoTasks(whitelist.selected, managed, openTaskIds)

  for (const pair of diff.toCreate) {
    const task = await createPositionTask({
      name: `海龟自动 ${pair}`,
      enabled: true,
      pair,
      strategy: 'turtle',
      interval: cfg.signalInterval,
      params: cfg.turtleParams,
      ...(cfg.margin !== undefined ? { margin: cfg.margin } : {}),
      ...(cfg.leverage !== undefined ? { leverage: cfg.leverage } : {}),
      autoTurtleManaged: true,
    })
    schedulePositionTask(task)
    console.log(`[TurtleAuto] 新建任务 ${task.name} (${task.id})`)
  }
  for (const pair of diff.toDisable) {
    const task = managed.find(t => t.pair === pair)!
    await updatePositionTask(task.id, { enabled: false })
    unschedulePositionTask(task.id)
    console.log(`[TurtleAuto] 停用任务 ${task.name}（掉出白名单且无持仓）`)
  }
  if (diff.keepRunning.length > 0) {
    console.log(`[TurtleAuto] 掉出白名单但仍有持仓，继续监控: ${diff.keepRunning.join(', ')}`)
  }

  return { whitelist, created: diff.toCreate, disabled: diff.toDisable, keepRunning: diff.keepRunning }
}
