import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { atomicWriteJson } from './storage.js'
import type { NotifyTask } from './types.js'

/**
 * 权益熔断器（反应式风控，不预测市场）。
 *
 * 设计依据（2026-09 系列实验）：所有"预测震荡"的方案（评分衍生信号、
 * regime 路由 v1）都被证伪；唯一没试过的方向是反应式——亏出来就停，
 * 用影子仓确认策略恢复后再回来。
 *
 * 状态机：
 *   active ──触发──▶ tripped ──冷却期满且影子PF达标──▶ probe ──试探期满──▶ active
 *              ▲          │                                │
 *              └──────────┴──── probe 期间再触发 ◀──────────┘
 *                        （冷却时长翻倍：24→48→96…）
 *
 * 触发条件（任一）：滚动胜率 < minWinRate（近 windowTrades 笔真实平仓）
 * 或权益回撤 > maxDrawdownPct（相对初始权益）。
 * tripped 期间不开真实仓（sizeFactor=0），信号照常记录为影子仓；
 * 恢复条件：冷却期满 + 近 shadowMinTrades 笔影子平仓 PF > shadowMinPF。
 */

export type BreakerPhase = 'active' | 'tripped' | 'probe'

export interface BreakerState {
  taskId: string
  phase: BreakerPhase
  trippedAt?: number
  /** 当前冷却时长（小时），再触发翻倍（封顶 maxCooldownHours） */
  cooldownHours: number
  /** probe 阶段已平仓笔数（按平仓判定胜负——开仓时盈亏未知） */
  probeClosed?: number
  /** probe 阶段累计盈亏（probe 整体盈利才算恢复成功） */
  probePnl?: number
  /** probe 阶段开始时间（实盘/回测用它过滤 probe 期间的平仓） */
  probeStartedAt?: number
  /**
   * 统计基线：恢复后滚动胜率/回撤只算此时间之后的交易。
   * 不重置的话，窗口里残留的旧亏损会让恢复后几小时内再次误触发。
   */
  statsResetAt?: number
  tripCount: number
  updatedAt: number
}

export interface BreakerConfig {
  windowTrades: number
  minWinRate: number
  maxDrawdownPct: number
  cooldownHours: number
  maxCooldownHours: number
  shadowMinTrades: number
  shadowMinPF: number
  probeTrades: number
}

export function resolveBreakerConfig(task: NotifyTask): BreakerConfig {
  const c = task.circuitBreaker ?? { enabled: false }
  return {
    windowTrades: c.windowTrades ?? 20,
    minWinRate: c.minWinRate ?? 35,
    maxDrawdownPct: c.maxDrawdownPct ?? 15,
    cooldownHours: c.cooldownHours ?? 24,
    maxCooldownHours: c.maxCooldownHours ?? 168,
    shadowMinTrades: c.shadowMinTrades ?? 10,
    shadowMinPF: c.shadowMinPF ?? 1.2,
    probeTrades: c.probeTrades ?? 5,
  }
}

/** 滚动胜率（%）：样本不足窗口一半时返回 null（不触发） */
export function rollingWinRate(pnls: number[], window: number): number | null {
  if (pnls.length < Math.max(1, Math.floor(window / 2))) return null
  const slice = pnls.slice(-window)
  return (slice.filter(p => p > 0).length / slice.length) * 100
}

/** 盈亏比：亏损为 0 时，有盈利返回 Infinity，否则 0 */
export function rollingPF(pnls: number[]): number {
  const grossWin = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0)
  const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0))
  return grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
}

export type BreakerEvent = 'trip' | 'cooldown' | 'probe' | 'recovered'

export class CircuitBreaker {
  private state: BreakerState
  private readonly config: BreakerConfig

  constructor(taskId: string, config: BreakerConfig, initial?: BreakerState) {
    this.config = config
    this.state = initial ?? {
      taskId,
      phase: 'active',
      cooldownHours: config.cooldownHours,
      tripCount: 0,
      updatedAt: Date.now(),
    }
  }

  get current(): BreakerState {
    return this.state
  }

  /** 真实仓位系数：active=1，probe=0.5，tripped=0（不开真实仓） */
  sizeFactor(): number {
    if (this.state.phase === 'tripped') return 0
    if (this.state.phase === 'probe') return 0.5
    return 1
  }

  /**
   * 每次真实平仓后检查是否触发。返回事件（触发了才返回 'trip'）。
   * @param recentPnls 该任务真实平仓盈亏序列（按时间升序，仅含 statsResetAt 之后的）
   * @param drawdownPct 当前权益回撤（%，相对 statsResetAt 时的权益峰值）
   * @param now 当前时间（回测传平仓时点）
   * @param closedPnl 本笔平仓盈亏（probe 阶段累计用）
   */
  shouldTrip(recentPnls: number[], drawdownPct: number, now = Date.now(), closedPnl?: number): { event: 'trip'; detail: string } | null {
    if (this.state.phase === 'tripped') return null

    // probe 阶段先累计试探盈亏
    if (this.state.phase === 'probe' && closedPnl !== undefined) {
      this.state.probePnl = (this.state.probePnl ?? 0) + closedPnl
      this.state.probeClosed = (this.state.probeClosed ?? 0) + 1
    }

    const winRate = rollingWinRate(recentPnls, this.config.windowTrades)
    const winRateHit = winRate !== null && winRate < this.config.minWinRate
    const drawdownHit = drawdownPct > this.config.maxDrawdownPct
    if (!winRateHit && !drawdownHit) return null

    // probe 期间再触发 → 冷却翻倍（封顶 maxCooldownHours）；active 触发保持当前冷却
    if (this.state.phase === 'probe') {
      this.state.cooldownHours = Math.min(this.state.cooldownHours * 2, this.config.maxCooldownHours)
    }
    const detail = winRateHit && drawdownHit
      ? `滚动胜率 ${winRate!.toFixed(1)}% < ${this.config.minWinRate}% 且回撤 ${drawdownPct.toFixed(1)}% > ${this.config.maxDrawdownPct}%`
      : winRateHit
        ? `滚动胜率 ${winRate!.toFixed(1)}% < ${this.config.minWinRate}%（近 ${Math.min(recentPnls.length, this.config.windowTrades)} 笔）`
        : `回撤 ${drawdownPct.toFixed(1)}% > ${this.config.maxDrawdownPct}%`
    this.state = {
      ...this.state,
      phase: 'tripped',
      trippedAt: now,
      probeClosed: undefined,
      probePnl: undefined,
      probeStartedAt: undefined,
      tripCount: this.state.tripCount + 1,
      updatedAt: now,
    }
    return { event: 'trip', detail: `${detail}，冷却 ${this.state.cooldownHours}h` }
  }

  /**
   * 每个评估时点调用：tripped 且冷却期满时检查影子 PF 决定是否进 probe。
   * @param shadowPnls 已平仓影子交易盈亏序列（升序）
   * @param now 当前时间（回测传评估时点）
   */
  checkRecovery(shadowPnls: number[], now: number): { event: BreakerEvent; detail: string } | null {
    if (this.state.phase !== 'tripped' || this.state.trippedAt === undefined) return null
    const cooldownMs = this.state.cooldownHours * 3_600_000
    if (now - this.state.trippedAt < cooldownMs) return null

    const recent = shadowPnls.slice(-this.config.shadowMinTrades)
    if (recent.length < this.config.shadowMinTrades) {
      return { event: 'cooldown', detail: `冷却期满但影子样本不足（${recent.length}/${this.config.shadowMinTrades}），继续等待` }
    }
    const pf = rollingPF(recent)
    if (pf <= this.config.shadowMinPF) {
      return { event: 'cooldown', detail: `冷却期满但影子 PF ${pf.toFixed(2)} ≤ ${this.config.shadowMinPF}，继续等待` }
    }
    this.state = {
      ...this.state,
      phase: 'probe',
      probeClosed: 0,
      probePnl: 0,
      probeStartedAt: now,
      // 进入试探即重置统计基线：probe 期间的滚动胜率/回撤只算试探仓本身，
      // 否则历史旧亏损（回撤早已 >maxDrawdown）会让 probe 在第一笔平仓时就再触发，
      // 「5 笔整体盈亏判定」永远没有机会生效
      statsResetAt: now,
      updatedAt: now,
    }
    return { event: 'probe', detail: `影子 PF ${pf.toFixed(2)} > ${this.config.shadowMinPF}（近 ${recent.length} 笔），半仓试探 ${this.config.probeTrades} 笔（按平仓判定）` }
  }

  /**
   * probe 阶段每笔试探仓平仓时调用（按平仓判定胜负——开仓时盈亏未知，
   * 按开仓计数会在所有试探仓平仓前就误判）。期满且整体盈利才转 active
   *（并重置统计基线）；整体亏损视为再触发，冷却翻倍（封顶）。
   */
  onProbeClose(now = Date.now()): { event: 'recovered' | 'trip'; detail: string } | null {
    if (this.state.phase !== 'probe' || this.state.probeClosed === undefined) return null
    // probeClosed/probePnl 已在 shouldTrip 的 closedPnl 分支累计，这里只判定期满
    if (this.state.probeClosed < this.config.probeTrades) return null

    const probePnl = this.state.probePnl ?? 0
    if (probePnl > 0) {
      // 试探成功：转 active，统计基线重置（旧亏损不再污染滚动窗口），冷却回到初始值
      this.state = {
        ...this.state,
        phase: 'active',
        probeClosed: undefined,
        probePnl: undefined,
        probeStartedAt: undefined,
        statsResetAt: now,
        cooldownHours: this.config.cooldownHours,
        updatedAt: now,
      }
      return { event: 'recovered', detail: `半仓试探 ${this.config.probeTrades} 笔整体盈利 ${probePnl.toFixed(2)}，恢复正常开仓并重置统计基线` }
    }
    // 试探亏损：视为再触发，冷却翻倍（封顶）
    this.state.cooldownHours = Math.min(this.state.cooldownHours * 2, this.config.maxCooldownHours)
    this.state = {
      ...this.state,
      phase: 'tripped',
      trippedAt: now,
      probeClosed: undefined,
      probePnl: undefined,
      probeStartedAt: undefined,
      tripCount: this.state.tripCount + 1,
      updatedAt: now,
    }
    return { event: 'trip', detail: `半仓试探 ${this.config.probeTrades} 笔整体亏损 ${probePnl.toFixed(2)}，重新熔断，冷却 ${this.state.cooldownHours}h` }
  }

  /** 手动复位 */
  reset(): void {
    this.state = {
      ...this.state,
      phase: 'active',
      trippedAt: undefined,
      probeClosed: undefined,
      probePnl: undefined,
      probeStartedAt: undefined,
      statsResetAt: Date.now(),
      cooldownHours: this.config.cooldownHours,
      updatedAt: Date.now(),
    }
  }
}

// ---- 持久化：data/circuit-breaker.json（map by taskId） ----

const __filename = fileURLToPath(import.meta.url)
const BREAKER_FILE = path.join(path.dirname(__filename), '../data/circuit-breaker.json')

async function loadAll(): Promise<Record<string, BreakerState>> {
  try {
    return JSON.parse(await fs.readFile(BREAKER_FILE, 'utf-8')) as Record<string, BreakerState>
  } catch {
    return {}
  }
}

export async function loadBreakerState(taskId: string): Promise<BreakerState | undefined> {
  return (await loadAll())[taskId]
}

export async function listBreakerStates(): Promise<Record<string, BreakerState>> {
  return loadAll()
}

export async function saveBreakerState(state: BreakerState): Promise<void> {
  const all = await loadAll()
  all[state.taskId] = state
  await atomicWriteJson(BREAKER_FILE, all)
}
