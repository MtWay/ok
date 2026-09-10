import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCachedHistoricalCandles } from './candleCache.js'
import { atomicWriteJson } from './storage.js'
import { barDurationMs, toOkxSwapInstrument } from './scanner.js'
import type { MarketRegime, NotifyTask } from './types.js'

/**
 * 市场 regime 判断与入场风格路由。
 *
 * 设计依据（来自 2026-09 的系列回测实验）：单品种评分及其衍生信号
 * （阈值/广度/ER/通道位置/均线斜率）在 1H 级别无法区分震荡与趋势；
 * 两个时期的本质区别是**价格位置**——震荡期价格在大箱体中部来回，
 * 趋势期全市场贴着 N 日通道边缘走。因此 regime 信号用市场级的
 * Donchian 通道贴近度（广度）+ BTC 突破（总闸），不用评分。
 *
 * 状态机带滞回：连续 ENTER_PERIODS 期满足才进入趋势，连续
 * EXIT_PERIODS 期不满足才退出，防止单日假突破来回抖动。
 */

// ---- 参数（由 6 个月回测校准：0.3/6期 判得太碎，假突破反复切换） ----
/** Donchian 通道窗口：4H × 120 根 = 20 天 */
export const DONCHIAN_BARS = 120
/** 收盘距通道上轨 2% 以内视为"贴上轨" */
export const EDGE_RATIO = 0.98
/** 贴上轨品种占比阈值（提高到 0.5：要求更多品种共振才算趋势，过滤假突破） */
export const BREADTH_THRESHOLD = 0.5
/** 连续 N 期满足进入趋势（3×4H=12h） */
export const ENTER_PERIODS = 3
/** 连续 N 期不满足退出趋势（12×4H=48h，让趋势状态更粘） */
export const EXIT_PERIODS = 12
/** regime 计算使用的周期 */
export const REGIME_TIMEFRAME = '4H'

const __filename = fileURLToPath(import.meta.url)
const REGIME_FILE = path.join(path.dirname(__filename), '../data/regime.json')

export interface RegimeSignals {
  breakoutUpPct: number
  breakoutDownPct: number
  btcBreakout: 'up' | 'down' | null
}

export interface RegimeState {
  state: MarketRegime
  updatedAt: number
  signals?: RegimeSignals
}

// ---- 滞回状态机（纯逻辑，可单测） ----

export class RegimeMachine {
  private state: MarketRegime
  private streak = 0

  constructor(initial: MarketRegime = 'range') {
    this.state = initial
  }

  get current(): MarketRegime {
    return this.state
  }

  update(signals: RegimeSignals): MarketRegime {
    const dir: 'up' | 'down' | null =
      signals.breakoutUpPct >= BREADTH_THRESHOLD || signals.btcBreakout === 'up' ? 'up'
      : signals.breakoutDownPct >= BREADTH_THRESHOLD || signals.btcBreakout === 'down' ? 'down'
      : null

    if (this.state === 'range') {
      if (dir !== null) {
        this.streak++
        if (this.streak >= ENTER_PERIODS) {
          this.state = dir === 'up' ? 'trend_up' : 'trend_down'
          this.streak = 0
        }
      } else {
        this.streak = 0
      }
      return this.state
    }

    const activeDir = this.state === 'trend_up' ? 'up' : 'down'
    if (dir === activeDir) {
      this.streak = 0
      return this.state
    }
    // 信号消失或出现反向信号都计入退出计数
    this.streak++
    if (this.streak >= EXIT_PERIODS) {
      this.state = 'range'
      this.streak = 0
    }
    return this.state
  }
}

// ---- 信号计算 ----

interface CandleSeries {
  timestamps: number[]
  candles: string[][]
}

/** 单品种在给定时点是否贴近 N 日通道边缘（用上轨/下轨不含当根） */
function channelEdge(series: CandleSeries, t: number, barMs: number): 'up' | 'down' | null {
  let idx = series.timestamps.length - 1
  while (idx >= 0 && series.timestamps[idx] + barMs > t) idx--
  if (idx < DONCHIAN_BARS) return null
  let upper = -Infinity
  let lower = Infinity
  for (let j = idx - DONCHIAN_BARS; j < idx; j++) {
    upper = Math.max(upper, Number(series.candles[j][3]))
    lower = Math.min(lower, Number(series.candles[j][2]))
  }
  const close = Number(series.candles[idx][1])
  if (!Number.isFinite(close) || !Number.isFinite(upper) || !Number.isFinite(lower)) return null
  if (close >= upper * EDGE_RATIO) return 'up'
  if (close <= lower * (2 - EDGE_RATIO)) return 'down'
  return null
}

export function computeSignals(pool: Map<string, CandleSeries>, t: number, barMs: number): RegimeSignals | null {
  let n = 0
  let up = 0
  let down = 0
  let btc: 'up' | 'down' | null = null
  for (const [pair, series] of pool) {
    const edge = channelEdge(series, t, barMs)
    if (pair === 'BTC-USDT-SWAP') btc = edge
    if (edge === null) continue
    n++
    if (edge === 'up') up++
    else down++
  }
  if (n === 0) return null
  return { breakoutUpPct: up / n, breakoutDownPct: down / n, btcBreakout: btc }
}

// ---- 回测用：批量生成 regime 时间线 ----

export async function computeRegimeSeries(
  pairs: string[],
  startMs: number,
  endMs: number,
  intervalMs: number,
  onWarning?: (msg: string) => void
): Promise<Array<{ time: number; state: MarketRegime }>> {
  const barMs = barDurationMs(REGIME_TIMEFRAME)
  if (!barMs) throw new Error(`Unsupported regime timeframe: ${REGIME_TIMEFRAME}`)

  const pool = new Map<string, CandleSeries>()
  const poolPairs = [...new Set([...pairs.map(toOkxSwapInstrument), 'BTC-USDT-SWAP'])]
  for (const pair of poolPairs) {
    try {
      const data = await getCachedHistoricalCandles(pair, REGIME_TIMEFRAME, startMs, endMs, DONCHIAN_BARS + 10)
      if (data.timestamps.length > 0) pool.set(pair, data)
    } catch (err) {
      onWarning?.(`${pair} ${REGIME_TIMEFRAME}: regime 取数失败 (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  const machine = new RegimeMachine()
  const series: Array<{ time: number; state: MarketRegime }> = []
  let last: MarketRegime | null = null
  for (let t = Math.ceil(startMs / intervalMs) * intervalMs; t <= endMs; t += intervalMs) {
    const signals = computeSignals(pool, t, barMs)
    const state = signals ? machine.update(signals) : machine.current
    if (state !== last) {
      series.push({ time: t, state })
      last = state
    }
  }
  return series
}

/** 二分查找时点 t 的 regime（series 为切换点列表，按时间升序） */
export function regimeAt(series: Array<{ time: number; state: MarketRegime }>, t: number): MarketRegime {
  let state: MarketRegime = 'range'
  for (const point of series) {
    if (point.time > t) break
    state = point.state
  }
  return state
}

// ---- 实盘用：当前状态持久化 ----

export async function loadRegimeState(): Promise<RegimeState | null> {
  try {
    return JSON.parse(await fs.readFile(REGIME_FILE, 'utf-8')) as RegimeState
  } catch {
    return null
  }
}

/**
 * 用最新 K 线刷新 regime 并持久化。状态机从上次的持久状态继续，
 * 保证重启服务后滞回计数不丢失。
 */
export async function refreshRegime(pairs: string[]): Promise<RegimeState> {
  const barMs = barDurationMs(REGIME_TIMEFRAME)!
  const now = Date.now()
  const pool = new Map<string, CandleSeries>()
  const poolPairs = [...new Set([...pairs.map(toOkxSwapInstrument), 'BTC-USDT-SWAP'])]
  for (const pair of poolPairs) {
    try {
      const data = await getCachedHistoricalCandles(pair, REGIME_TIMEFRAME, now - (DONCHIAN_BARS + 10) * barMs, now, 0)
      if (data.timestamps.length > 0) pool.set(pair, data)
    } catch (err) {
      console.warn(`[Regime] ${pair} 取数失败:`, err instanceof Error ? err.message : err)
    }
  }
  const signals = computeSignals(pool, now, barMs)
  const prev = await loadRegimeState()
  const machine = new RegimeMachine(prev?.state ?? 'range')
  const state = signals ? machine.update(signals) : machine.current
  const next: RegimeState = { state, updatedAt: now, signals: signals ?? undefined }
  await atomicWriteJson(REGIME_FILE, next)
  return next
}

// ---- 仓位调节（C：regime 只调仓位系数，不切换入场规则——风格路由 v1 已被证伪） ----

/** range 用 sizeRange（默认 0.5），趋势用 sizeTrend（默认 1.5） */
export function sizeFactorForRegime(regime: MarketRegime, task?: NotifyTask): number {
  const sizeRange = task?.regimeRouting?.sizeRange ?? 0.5
  const sizeTrend = task?.regimeRouting?.sizeTrend ?? 1.5
  return regime === 'range' ? sizeRange : sizeTrend
}
