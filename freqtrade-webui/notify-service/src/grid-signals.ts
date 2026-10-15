import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * OkxGrid 策略（freqtrade_userdir/strategies/okx_grid.py）的信号桥。
 *
 * notify-service 负责扫描选股：网格任务每轮判定"该品种当前是否适合开新
 * 网格"，适合就 upsert 一条信号，不适合就移除。策略每 5 秒读一次信号
 * 文件，文件里有的品种才被允许开新网格；加仓/止盈/止损由策略自己管理，
 * 不依赖信号存在（信号只门控"开新仓"）。
 *
 * 文件放在 freqtrade_userdir 下，与策略内 SIGNAL_FILE 的相对路径约定
 * 必须保持一致（deploy 后 notify-service 与 freqtrade 同机）：
 *   notify-service:  src|dist -> notify-service -> freqtrade-webui -> repo root
 *   freqtrade 策略:  strategies -> freqtrade_userdir
 */
const SIGNAL_FILE = process.env.GRID_SIGNALS_FILE || path.join(
  path.dirname(fileURLToPath(import.meta.url)), '../../../freqtrade_userdir/grid_signals.json')
const STATE_FILE = process.env.GRID_STATE_FILE || path.join(
  path.dirname(fileURLToPath(import.meta.url)), '../../../freqtrade_userdir/grid_state.json')
/** 所有曾经被网格策略管理过的品种（只增不减），用于平仓后导入历史记录。 */
const ALL_PAIRS_FILE = process.env.GRID_ALL_PAIRS_FILE || path.join(
  path.dirname(fileURLToPath(import.meta.url)), '../../../freqtrade_userdir/grid_all_pairs.json')

export interface GridSignal {
  id: string
  /** freqtrade pair format, e.g. ONE/USDT:USDT */
  pair: string
  leverage: number
  /** margin (USDT) per grid layer */
  layerMargin: number
  gridCount: number
  lookback: number
  stopPercent: number
  minStepPercent: number
  createdAt: number
  ttlMs: number
}

/** 加载所有曾经被网格策略管理过的品种（只增不减），用于平仓后导入历史记录。 */
export async function loadAllGridPairs(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(ALL_PAIRS_FILE, 'utf-8')
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

/** 记录一个品种到"所有曾经网格过的品种"集合（只增不减）。 */
export async function recordGridPair(pair: string): Promise<void> {
  const pairs = await loadAllGridPairs()
  if (pairs.has(pair)) return
  pairs.add(pair)
  await fs.writeFile(ALL_PAIRS_FILE, JSON.stringify([...pairs]), 'utf-8')
}

async function readJson(file: string): Promise<any> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch (err: any) {
    if (err.code === 'ENOENT') return undefined
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    // 文件损坏时备份后按空文件处理：dry-run/live 多实例共享同一信号文件，
    // 并发写撞车或进程中断都会留下解析不了的残片。信号文件每轮扫描都会
    // 重建，直接自愈，避免所有网格任务被单个坏文件永久卡死（观察到的
    // 现象：全部 grid 任务每次扫描报同一 JSON.parse 位置）。
    const backup = `${file}.corrupt.${Date.now()}`
    await fs.rename(file, backup).catch(() => {})
    console.error(`[GridSignals] Corrupt ${path.basename(file)} backed up to ${backup}, starting fresh:`, err instanceof Error ? err.message : err)
    return undefined
  }
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  // tmp 名必须带进程号+随机后缀：多个 notify-service 实例（dryrun/live）
  // 共享同一信号文件，固定 `.tmp` 后缀会被并发写互相覆盖，损坏目标文件。
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
  await fs.rename(tmp, file)
}

export function isSignalActive(signal: GridSignal, now = Date.now()): boolean {
  return now - signal.createdAt <= signal.ttlMs
}

export async function loadGridSignals(now = Date.now()): Promise<GridSignal[]> {
  const raw = await readJson(SIGNAL_FILE)
  if (!raw || !Array.isArray(raw.signals)) return []
  return (raw.signals as GridSignal[]).filter(s => isSignalActive(s, now))
}

/** Upsert by pair: one open-grid permission per pair. Prunes expired entries. */
export async function upsertGridSignal(signal: GridSignal): Promise<void> {
  const now = Date.now()
  const raw = await readJson(SIGNAL_FILE)
  const signals = ((raw?.signals ?? []) as GridSignal[])
    .filter(s => s.pair !== signal.pair && isSignalActive(s, now))
  signals.push(signal)
  await atomicWriteJson(SIGNAL_FILE, { signals })
  await recordGridPair(signal.pair)
}

export async function removeGridSignal(pair: string): Promise<void> {
  const raw = await readJson(SIGNAL_FILE)
  const signals = ((raw?.signals ?? []) as GridSignal[]).filter(s => s.pair !== pair)
  if (signals.length === (raw?.signals?.length ?? 0)) return
  await atomicWriteJson(SIGNAL_FILE, { signals })
}

/** Pairs an active signal allows to OPEN a new grid (entry gate only). */
export async function loadActiveGridPairs(now = Date.now()): Promise<Set<string>> {
  return new Set((await loadGridSignals(now)).map(s => s.pair))
}

/**
 * Pairs whose grid position the strategy still reports as live, judged by the
 * heartbeat (last_seen_ms) in grid_state.json. The strategy heartbeats every
 * loop while a trade is open and stops when it closes, so a fresh heartbeat
 * proves an open strategy-managed position — these trades must survive the
 * orphan sweep even after their entry signal expired.
 */
export async function loadGridStatePairs(maxAgeMs = 3600_000, now = Date.now()): Promise<Set<string>> {
  const raw = await readJson(STATE_FILE)
  if (!raw) return new Set()
  const pairs = new Set<string>()
  for (const [pair, state] of Object.entries<any>(raw)) {
    const lastSeen = Number(state?.last_seen_ms)
    if (Number.isFinite(lastSeen) && now - lastSeen <= maxAgeMs) pairs.add(pair)
  }
  return pairs
}

export interface GridPlanState {
  pair: string
  tradeId?: number
  params: { grid_count: number; lookback: number; stop_percent: number; min_step_percent: number }
  levels: Array<{ level: number; level_price: number; fill: number; tp: number }>
  lastSeenMs: number
}

/** 策略自管的网格计划全量（grid_state.json），供前端网格面板展示。 */
export async function loadGridPlans(): Promise<GridPlanState[]> {
  const raw = await readJson(STATE_FILE)
  if (!raw || typeof raw !== 'object') return []
  return Object.entries<any>(raw).map(([pair, d]) => ({
    pair,
    tradeId: d?.trade_id !== undefined && d?.trade_id !== null ? Number(d.trade_id) : undefined,
    params: {
      grid_count: Number(d?.params?.grid_count ?? 8),
      lookback: Number(d?.params?.lookback ?? 120),
      stop_percent: Number(d?.params?.stop_percent ?? 2),
      min_step_percent: Number(d?.params?.min_step_percent ?? 0.3),
    },
    levels: Array.isArray(d?.levels) ? d.levels.map((l: any) => ({
      level: Number(l?.level ?? 0),
      level_price: Number(l?.level_price ?? 0),
      fill: Number(l?.fill ?? 0),
      tp: Number(l?.tp ?? 0),
    })) : [],
    lastSeenMs: Number(d?.last_seen_ms ?? 0),
  }))
}

/** 合并持仓止损价（与 grid_core.GridPlan.stop_price 一致）：最低剩余层 fill × (1 − stop%)。 */
export function gridPlanStopPrice(plan: GridPlanState): number | undefined {
  if (!plan.levels.length) return undefined
  return Math.min(...plan.levels.map(l => l.fill)) * (1 - plan.params.stop_percent / 100)
}
