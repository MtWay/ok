import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  barDurationMs,
  evaluatePairFromCandles,
  getPopularPairs,
  resolveMultiTimeframeConfig,
  runWithConcurrency,
  type HistoricalCandles,
} from './scanner.js'
import { getCachedHistoricalCandles } from './candleCache.js'
import { atomicWriteJson } from './storage.js'
import { getTradingSettings } from './settings.js'
import { buildAutoPlanPrices } from './trading.js'
import {
  computeRegimeSeries,
  regimeAt,
  REGIME_TIMEFRAME,
} from './regime.js'
import { CircuitBreaker, resolveBreakerConfig } from './circuit-breaker.js'
import type { BacktestJob, BacktestResult, BacktestTrade, MarketRegime, NotifyTask, ScanResult } from './types.js'

/**
 * 通知任务（策略）历史回测引擎。
 *
 * 用任务的筛选规则（9 条 rules + 多周期配置）在历史行情上回放评估：
 * 每个评估时点只用当时已收盘的最近 300 根 K 线（严格无未来函数），
 * 命中信号且无持仓时按信号收盘价入场，出场规则对齐实盘
 * （trading.ts 的 exitReasonForPlan：固定止损/止盈 + 2×ATR 移动止损）。
 *
 * 回放按全局时间轴推进（而非逐品种），因为熔断器是跨品种的状态机
 * （滚动胜率/权益回撤依赖真实时间顺序）。可选叠加：
 * - regime 仓位调节：range/trend 用不同仓位系数，不切换入场规则
 * - 权益熔断：触发后停开真实仓，信号转影子仓，影子 PF 达标后半仓恢复
 * - 信号新鲜度：上升沿触发 + 止损后品种冷却
 */

// 双边手续费率（按名义价值，开平各收一次）
const FEE_RATE = 0.0005
// 取数并发上限，与调试扫描一致
const FETCH_CONCURRENCY = 6
// 每个评估点可见的 K 线窗口（与实时扫描 fetchOKXCandles(pair, tf, 300) 对齐）
const WINDOW_SIZE = 300

const INTERVAL_MS: Record<NotifyTask['interval'], number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '12h': 12 * 3_600_000,
  '24h': 24 * 3_600_000,
}

const __filename = fileURLToPath(import.meta.url)
const BACKTEST_DIR = path.join(path.dirname(__filename), '../data/backtests')

function backtestFile(taskId: string): string {
  // taskId 由服务端生成（task_xxx），仍兜底去掉路径分隔符
  return path.join(BACKTEST_DIR, `${taskId.replace(/[\\/]/g, '_')}.json`)
}

export async function saveBacktestJob(job: BacktestJob): Promise<void> {
  await atomicWriteJson(backtestFile(job.taskId), job)
  // 完成时额外归档一份带时间戳的副本，历史回测结果不被重跑覆盖
  if (job.status === 'completed') {
    await atomicWriteJson(backtestArchiveFile(job.taskId, job.completedAt ?? Date.now()), job)
  }
}

function backtestArchiveFile(taskId: string, completedAt: number): string {
  return path.join(BACKTEST_DIR, `${taskId.replace(/[\\/]/g, '_')}_${completedAt}.json`)
}

export async function loadBacktestJob(taskId: string): Promise<BacktestJob | undefined> {
  try {
    return JSON.parse(await fs.readFile(backtestFile(taskId), 'utf-8')) as BacktestJob
  } catch (err: any) {
    if (err.code === 'ENOENT') return undefined
    throw err
  }
}

interface OpenPosition {
  pair: string
  timeframe: string
  side: 'long' | 'short'
  entryTime: number
  entryPrice: number
  stopPrice: number
  takeProfit: number
  trailingStopPercent: number
  /** 移动止损锚定的峰值价（long 取持仓期最高价，short 取最低价） */
  peak: number
  matchedRules: string[]
  /** regime 仓位系数（range=0.5，趋势=1.0）；未启用 regime 路由时为 undefined */
  sizeFactor?: number
}

export interface BacktestProgress {
  message: string
  percent: number
}

/** 止损类平仓（固定止损/移动止损）——freshness 冷却的触发源 */
function closeReasonIsStop(reason: BacktestTrade['closeReason']): boolean {
  return reason === 'plan_stoploss' || reason === 'plan_trailing_stop'
}

export async function runTaskBacktest(
  task: NotifyTask,
  startMs: number,
  endMs: number,
  onProgress?: (progress: BacktestProgress) => void
): Promise<BacktestResult> {
  const startedAt = Date.now()
  const warnings: string[] = []
  const settings = getTradingSettings()
  const intervalMs = INTERVAL_MS[task.interval] ?? INTERVAL_MS['1h']
  const multiTimeframe = resolveMultiTimeframeConfig(task)
  const pairs = task.pairs.includes('*') ? await getPopularPairs() : task.pairs

  // ---- regime 仓位调节（C：只调仓位系数，不切换入场规则）----
  const regimeEnabled = task.regimeRouting?.enabled === true
  const regimeSizeRange = task.regimeRouting?.sizeRange ?? 0.5
  const regimeSizeTrend = task.regimeRouting?.sizeTrend ?? 1.5
  let regimeSeries: Array<{ time: number; state: MarketRegime }> = []
  if (regimeEnabled) {
    onProgress?.({ message: '计算市场 regime 时间线', percent: 1 })
    // regime 状态机的"期"固定为 4H（ENTER_PERIODS/EXIT_PERIODS 按 4H 校准），
    // 与任务扫描间隔解耦，否则 1H 任务会 3 小时进趋势、6 小时退出，滞回失效
    const regimeIntervalMs = barDurationMs(REGIME_TIMEFRAME) ?? intervalMs
    regimeSeries = await computeRegimeSeries(pairs, startMs, endMs, regimeIntervalMs, msg => warnings.push(msg))
    if (regimeSeries.length === 0) {
      warnings.push('regime 时间线为空（4H 数据不足），全程按 range 仓位系数处理')
    }
  }

  // ---- 熔断（A）与信号新鲜度（B）配置 ----
  const breakerEnabled = task.circuitBreaker?.enabled === true
  const breaker = breakerEnabled ? new CircuitBreaker(task.id, resolveBreakerConfig(task)) : undefined
  const breakerLog: NonNullable<BacktestResult['breakerLog']> = []
  const risingEdge = task.freshness?.risingEdge === true
  const stopCooldownMs = Math.max(0, task.freshness?.cooldownAfterStopHours ?? 0) * 3_600_000

  // 该任务涉及的全部周期：勾选周期 + 多周期小周期
  const timeframes = task.timeframes
  const lowerTimeframe = multiTimeframe.enabled ? multiTimeframe.lowerTimeframe : undefined
  const fetchTimeframes = lowerTimeframe !== undefined
    ? [...new Set([...timeframes, lowerTimeframe])]
    : timeframes

  // ---- 取数：pair × timeframe 各取一次（含 300 根预热），优先读本地持久
  // 缓存（candleCache.ts），缺口才请求 OKX；本轮回测内再用内存 Map 共享 ----
  const cache = new Map<string, HistoricalCandles>()
  const fetchJobs: Array<{ pair: string; tf: string }> = []
  for (const pair of pairs) {
    for (const tf of fetchTimeframes) fetchJobs.push({ pair, tf })
  }
  let fetched = 0
  onProgress?.({ message: `拉取历史 K 线 0/${fetchJobs.length}`, percent: 2 })
  await runWithConcurrency(fetchJobs, FETCH_CONCURRENCY, async ({ pair, tf }) => {
    const key = `${pair}|${tf}`
    try {
      const data = await getCachedHistoricalCandles(pair, tf, startMs, endMs, WINDOW_SIZE)
      if (data.candles.length === 0) {
        warnings.push(`${pair} ${tf}: 区间内无 K 线数据`)
      } else {
        cache.set(key, data)
      }
    } catch (err) {
      warnings.push(`${pair} ${tf}: 取数失败 (${err instanceof Error ? err.message : String(err)})`)
    }
    fetched++
    if (fetched % 10 === 0 || fetched === fetchJobs.length) {
      onProgress?.({ message: `拉取历史 K 线 ${fetched}/${fetchJobs.length}`, percent: 2 + Math.round((fetched / Math.max(fetchJobs.length, 1)) * 28) })
    }
  })

  // ---- 评估时点：按任务 interval 对齐（与定时器 cron 的整点触发对齐） ----
  const evalTimes: number[] = []
  for (let t = Math.ceil(startMs / intervalMs) * intervalMs; t <= endMs; t += intervalMs) {
    evalTimes.push(t)
  }
  if (evalTimes.length === 0) {
    warnings.push('区间内没有评估时点（区间小于扫描间隔）')
  }

  // ---- 回放：全局时间轴 × 各品种状态 ----
  // 熔断器是跨品种状态机（滚动胜率/权益回撤），必须按真实时间顺序推进，
  // 因此不再逐品种回放，而是每个评估时点遍历所有品种。
  const trades: BacktestTrade[] = []
  // 熔断 tripped 期间的影子交易：被抑制的真实信号用同一出场逻辑模拟
  const shadowTrades: BacktestTrade[] = []

  const FINE_TIMEFRAME = '5m'
  const fineBarMs = barDurationMs(FINE_TIMEFRAME) ?? 5 * 60_000

  // 持仓追踪器工厂：真实仓与影子仓共用同一套出场逻辑。
  // 出场优先级与实盘 exitReasonForPlan 一致：固定止损 → 固定止盈 → 移动止损
  //（用之前更新的峰值，避免同根 K 线先高后低的路径假设），最后再用本根极值更新峰值。
  const makeTracker = (pair: string, exitData: HistoricalCandles, exitBarMs: number, record: (trade: BacktestTrade) => void) => {
    let position: OpenPosition | undefined
    let ambiguousResolved = 0
    let ambiguousFallback = 0

    const closePosition = (exitTime: number, exitPrice: number, closeReason: BacktestTrade['closeReason']) => {
      if (!position) return
      const sizeFactor = position.sizeFactor ?? 1
      const notional = settings.fixedMargin * settings.leverage * sizeFactor
      const quantity = notional / position.entryPrice
      const gross = (exitPrice - position.entryPrice) * quantity * (position.side === 'long' ? 1 : -1)
      const pnl = gross - notional * FEE_RATE * 2
      record({
        pair: position.pair,
        timeframe: position.timeframe,
        side: position.side,
        entryTime: position.entryTime,
        entryPrice: position.entryPrice,
        exitTime,
        exitPrice,
        stopPrice: position.stopPrice,
        takeProfit: position.takeProfit,
        trailingStopPercent: position.trailingStopPercent,
        pnl,
        // 百分比相对实际占用保证金（含仓位系数）
        pnlPct: settings.fixedMargin > 0 ? (pnl / (settings.fixedMargin * sizeFactor)) * 100 : 0,
        closeReason,
        matchedRules: position.matchedRules,
        sizeFactor: position.sizeFactor,
      })
      position = undefined
    }

    const applyBar = (high: number, low: number, closeTime: number): boolean => {
      if (!position) return true
      if (position.side === 'long') {
        if (low <= position.stopPrice) { closePosition(closeTime, position.stopPrice, 'plan_stoploss'); return true }
        if (high >= position.takeProfit) { closePosition(closeTime, position.takeProfit, 'plan_take_profit'); return true }
        const trailing = position.peak * (1 - position.trailingStopPercent / 100)
        if (position.trailingStopPercent > 0 && low <= trailing) { closePosition(closeTime, trailing, 'plan_trailing_stop'); return true }
        position.peak = Math.max(position.peak, high)
      } else {
        if (high >= position.stopPrice) { closePosition(closeTime, position.stopPrice, 'plan_stoploss'); return true }
        if (low <= position.takeProfit) { closePosition(closeTime, position.takeProfit, 'plan_take_profit'); return true }
        const trailing = position.peak * (1 + position.trailingStopPercent / 100)
        if (position.trailingStopPercent > 0 && high >= trailing) { closePosition(closeTime, trailing, 'plan_trailing_stop'); return true }
        position.peak = Math.min(position.peak, low)
      }
      return false
    }

    // 歧义 K 线：单根同时覆盖止盈和止损，无法判断盘中先碰哪个。
    // 按需拉该时间段的 5m 细粒度 K 线（走持久缓存，重复回测不再请求），
    // 按时间顺序重放还原路径；取数失败或 5m 内仍歧义时退回保守假设
    //（applyBar 固定止损优先）。
    const checkExit = async (index: number) => {
      if (!position) return
      const high = Number(exitData.candles[index][3])
      const low = Number(exitData.candles[index][2])
      const closeTime = exitData.timestamps[index] + exitBarMs

      const ambiguous = position.side === 'long'
        ? low <= position.stopPrice && high >= position.takeProfit
        : high >= position.stopPrice && low <= position.takeProfit

      if (ambiguous && fineBarMs < exitBarMs) {
        const barOpen = exitData.timestamps[index]
        let resolved = false
        try {
          // 覆盖 [barOpen, barOpen + exitBarMs) 内的全部 5m 子K线
          const fine = await getCachedHistoricalCandles(pair, FINE_TIMEFRAME, barOpen, barOpen + exitBarMs - 1, 0)
          for (let j = 0; j < fine.timestamps.length; j++) {
            const fineHigh = Number(fine.candles[j][3])
            const fineLow = Number(fine.candles[j][2])
            if (applyBar(fineHigh, fineLow, fine.timestamps[j] + fineBarMs)) { resolved = true; break }
          }
        } catch (err) {
          console.warn(`[Backtest] ${pair} 细粒度取数失败，按保守假设处理:`, err instanceof Error ? err.message : err)
        }
        if (resolved) {
          ambiguousResolved++
          return
        }
        // 取数失败或子K线未覆盖极值（数据缺漏）→ 退回保守假设（applyBar 固定止损优先）
        ambiguousFallback++
        console.warn(`[Backtest] ${pair} ${new Date(barOpen).toISOString()} 歧义K线无法解析（5m数据缺漏），保守按止损处理`)
      }

      applyBar(high, low, closeTime)
    }

    return {
      get hasPosition() { return position !== undefined },
      open: (pos: OpenPosition) => { position = pos },
      closePosition,
      checkExit,
      ambiguousStats: () => ({ resolved: ambiguousResolved, fallback: ambiguousFallback }),
    }
  }

  type Tracker = ReturnType<typeof makeTracker>

  // 每个品种的回放状态
  interface PairReplayState {
    pair: string
    exitData: HistoricalCandles
    exitBarMs: number
    activeTimeframes: string[]
    realTracker: Tracker
    shadowTracker?: Tracker
    /** exitIdx 指向首个尚未处理的出场 K 线（timestamps 升序） */
    exitIdx: number
    /** 窗口右边界指针：evalTimes 递增，各周期已收盘 K 线数只增不减，
     *  指针单调前进，避免每个时点从数组尾部 O(n) 回扫（整体 O(n²)） */
    hiPtrs: Map<string, number>
    loPtr: number
    /** 上升沿检测：上次评估是否命中（仅 freshness.risingEdge 时使用） */
    prevMatched: Map<string, boolean>
    /** 上次止损/移动止损平仓时间（freshness.cooldownAfterStopHours） */
    lastStopAt?: number
  }

  const pairStates: PairReplayState[] = []
  for (const pair of pairs) {
    // 出场检查用该 pair 最小周期的 K 线（粒度最细）
    const exitTf = fetchTimeframes
      .filter(tf => cache.has(`${pair}|${tf}`))
      .sort((a, b) => (barDurationMs(a) ?? Infinity) - (barDurationMs(b) ?? Infinity))[0]
    if (!exitTf) continue
    const exitData = cache.get(`${pair}|${exitTf}`)!
    const exitBarMs = barDurationMs(exitTf)!

    // 该 pair 可参与评估的周期（缺数据的周期整 pair 只告警一次）
    const activeTimeframes = timeframes.filter(tf => {
      if (cache.has(`${pair}|${tf}`)) return true
      warnings.push(`${pair} ${tf}: 无数据，跳过该周期评估`)
      return false
    })
    if (activeTimeframes.length === 0) continue

    const state: PairReplayState = {
      pair,
      exitData,
      exitBarMs,
      activeTimeframes,
      realTracker: makeTracker(pair, exitData, exitBarMs, trade => {
        trades.push(trade)
        // 熔断：真实平仓后检查触发（滚动胜率 + 权益回撤）
        if (breaker) {
          realPnls.push({ time: trade.exitTime, pnl: trade.pnl })
          equityNow += trade.pnl
          equityPoints.push({ time: trade.exitTime, equity: equityNow })
          // 统计基线：恢复/进入试探后只算 statsResetAt 之后的交易和权益峰值，
          // 否则窗口里残留的旧亏损会让 probe/恢复后几小时内再次误触发
          const resetAt = breaker.current.statsResetAt ?? 0
          if (resetAt !== lastResetAt) {
            // 基线刚被重置（checkRecovery/onProbeClose 在本时点之前触发）：
            // 峰值种子必须是基线时刻的实际权益，而不是初始本金——否则历史亏损
            // 会让回撤永远 >maxDrawdown，probe 永远无法通过
            lastResetAt = resetAt
            equityAtReset = equityNow - trade.pnl
          }
          const sinceReset = realPnls.filter(p => p.time >= resetAt)
          const peakSinceReset = equityPoints
            .filter(p => p.time >= resetAt)
            .reduce((peak, p) => Math.max(peak, p.equity), equityAtReset)
          const drawdownPct = settings.equity > 0 ? ((peakSinceReset - equityNow) / settings.equity) * 100 : 0
          const ev = breaker.shouldTrip(sinceReset.map(p => p.pnl), drawdownPct, trade.exitTime, trade.pnl)
          if (ev) breakerLog.push({ time: trade.exitTime, event: ev.event, detail: ev.detail })
          // probe 按平仓判定胜负：试探仓平仓累计满 probeTrades 笔后由 onProbeClose 判定
          const probeEv = breaker.onProbeClose(trade.exitTime)
          if (probeEv) breakerLog.push({ time: trade.exitTime, event: probeEv.event, detail: probeEv.detail })
        }
        // 新鲜度：止损类平仓记录冷却起点
        if (closeReasonIsStop(trade.closeReason)) state.lastStopAt = trade.exitTime
      }),
      shadowTracker: breakerEnabled ? makeTracker(pair, exitData, exitBarMs, trade => {
        shadowTrades.push(trade)
        shadowPnls.push(trade.pnl)
      }) : undefined,
      exitIdx: 0,
      hiPtrs: new Map(activeTimeframes.map(tf => [tf, 0])),
      loPtr: 0,
      prevMatched: new Map(),
    }
    pairStates.push(state)
  }

  // 熔断统计：真实平仓盈亏序列 + 权益曲线（用于回撤触发）
  const realPnls: Array<{ time: number; pnl: number }> = []
  const shadowPnls: number[] = []
  let equityNow = settings.equity
  // 权益历史点（每笔真实平仓后），用于 statsResetAt 之后的回撤计算
  const equityPoints: Array<{ time: number; equity: number }> = []
  // 统计基线跟踪：statsResetAt 变化时快照当时权益，作为回撤峰值种子
  let lastResetAt = 0
  let equityAtReset = settings.equity

  // 回放是同步 CPU 密集循环，定期让出事件循环，
  // 否则 /backtest/latest 轮询会长时间得不到响应（前端 5s 超时后进度"消失"）
  let sinceYield = 0
  const yieldEventLoop = async () => {
    if (++sinceYield >= 25) {
      sinceYield = 0
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  for (let ti = 0; ti < evalTimes.length; ti++) {
    const t = evalTimes[ti]
    await yieldEventLoop()
    if (ti % 200 === 0) {
      onProgress?.({
        message: `回放评估 ${ti}/${evalTimes.length}`,
        percent: 30 + Math.round((ti / Math.max(evalTimes.length, 1)) * 68),
      })
    }

    // 熔断恢复检查：冷却期满且影子 PF 达标 → probe
    if (breaker && breaker.current.phase === 'tripped') {
      const ev = breaker.checkRecovery(shadowPnls, t)
      if (ev) breakerLog.push({ time: t, event: ev.event, detail: ev.detail })
    }

    // regime 仓位系数（C：只调仓位，不切规则）
    const regime = regimeEnabled ? regimeAt(regimeSeries, t) : undefined
    const regimeSizeFactor = regime === undefined ? undefined
      : regime === 'range' ? regimeSizeRange : regimeSizeTrend
    const breakerFactor = breaker?.sizeFactor() ?? 1

    for (const ps of pairStates) {
      // 先处理收盘时刻 <= t 的出场 K 线（该时点之前价格怎么走与评估无关）
      while (ps.exitIdx < ps.exitData.timestamps.length && ps.exitData.timestamps[ps.exitIdx] + ps.exitBarMs <= t) {
        await ps.realTracker.checkExit(ps.exitIdx)
        await ps.shadowTracker?.checkExit(ps.exitIdx)
        ps.exitIdx++
      }

      // 同一 pair 同时只持一仓（对齐实盘币种占用规则）；影子仓独立计数
      const tripped = breaker !== undefined && breaker.current.phase === 'tripped'
      const needReal = !tripped && !ps.realTracker.hasPosition
      const needShadow = ps.shadowTracker !== undefined && !ps.shadowTracker.hasPosition
      if (!needReal && !needShadow) continue

      // 止损冷却：该品种上次止损/移动止损平仓后 N 小时内禁止开真实仓（影子照记）
      const inStopCooldown = stopCooldownMs > 0 && ps.lastStopAt !== undefined && t - ps.lastStopAt < stopCooldownMs

      for (const tf of ps.activeTimeframes) {
        const data = cache.get(`${ps.pair}|${tf}`)!
        const tfBarMs = barDurationMs(tf)
        if (!tfBarMs) continue
        // 该时点可见窗口：开盘时间 + 周期 <= t 的最近 WINDOW_SIZE 根（指针单调前进）
        let hi = ps.hiPtrs.get(tf)!
        while (hi < data.timestamps.length && data.timestamps[hi] + tfBarMs <= t) hi++
        ps.hiPtrs.set(tf, hi)
        if (hi === 0) continue
        const candles = data.candles.slice(Math.max(0, hi - WINDOW_SIZE), hi)

        let lowerCandles: string[][] = []
        if (lowerTimeframe !== undefined) {
          const lowerData = cache.get(`${ps.pair}|${lowerTimeframe}`)
          const lowerBarMs = barDurationMs(lowerTimeframe)
          if (!lowerData || !lowerBarMs) continue
          while (ps.loPtr < lowerData.timestamps.length && lowerData.timestamps[ps.loPtr] + lowerBarMs <= t) ps.loPtr++
          lowerCandles = lowerData.candles.slice(Math.max(0, ps.loPtr - WINDOW_SIZE), ps.loPtr)
        }

        let evaluation
        try {
          evaluation = evaluatePairFromCandles(ps.pair, tf, candles, lowerCandles, task, multiTimeframe, true)
        } catch (err) {
          warnings.push(`${ps.pair} ${tf} @${new Date(t).toISOString()}: 评估异常 (${err instanceof Error ? err.message : String(err)})`)
          continue
        }
        const score = evaluation?.score
        const matched = evaluation?.debug.matched === true && !!score
          && (score.direction === 'long' || score.direction === 'short')
          && !!score.currentPrice && !!score.stopLossTight && !!score.takeProfit

        // 上升沿：仅"上次未命中 → 本次命中"才算信号（评分达标是状态不是事件）
        const edgeKey = `${ps.pair}|${tf}`
        const prevMatched = ps.prevMatched.get(edgeKey) ?? false
        ps.prevMatched.set(edgeKey, matched)
        const signalFires = matched && (!risingEdge || !prevMatched)

        if (!signalFires || !score) continue

        if (needReal && !inStopCooldown && !ps.realTracker.hasPosition) {
          // 组合仓位系数：regime × 熔断（probe 半仓）
          const sizeFactor = (regimeSizeFactor ?? 1) * breakerFactor
          try {
            ps.realTracker.open(openPositionFromScore(ps.pair, score, t, sizeFactor === 1 ? undefined : sizeFactor))
          } catch (err) {
            // 止损价与入场价相等等无效价格（实盘 buildAutoPlanPrices 同样拒绝），跳过
            warnings.push(`${ps.pair} ${tf} @${new Date(t).toISOString()}: 无效开仓价格 (${err instanceof Error ? err.message : String(err)})`)
          }
        } else if (tripped && ps.shadowTracker && !ps.shadowTracker.hasPosition) {
          // 熔断期间：信号转影子仓（不计仓位系数，用于恢复判断）
          try {
            ps.shadowTracker.open(openPositionFromScore(ps.pair, score, t, undefined))
          } catch {
            // 无效价格直接跳过，影子交易不记 warning
          }
        }

        // 一个时点一个 pair 每种仓最多开一单；两边都有仓后可提前结束本时点
        if (ps.realTracker.hasPosition && (!ps.shadowTracker || ps.shadowTracker.hasPosition)) break
      }
    }
  }

  // 区间尾部：处理剩余出场 K 线并按最后可见收盘价强制平仓
  for (const ps of pairStates) {
    while (ps.exitIdx < ps.exitData.timestamps.length && ps.exitData.timestamps[ps.exitIdx] < endMs) {
      await ps.realTracker.checkExit(ps.exitIdx)
      await ps.shadowTracker?.checkExit(ps.exitIdx)
      ps.exitIdx++
    }
    for (const tracker of [ps.realTracker, ps.shadowTracker]) {
      if (!tracker?.hasPosition) continue
      let hi = ps.exitData.timestamps.length
      while (hi > 0 && ps.exitData.timestamps[hi - 1] + ps.exitBarMs > endMs) hi--
      if (hi > 0) tracker.closePosition(endMs, Number(ps.exitData.candles[hi - 1][1]), 'backtest_end')
    }
    const amb = ps.realTracker.ambiguousStats()
    const shadowAmb = ps.shadowTracker?.ambiguousStats()
    const resolved = amb.resolved + (shadowAmb?.resolved ?? 0)
    const fallback = amb.fallback + (shadowAmb?.fallback ?? 0)
    if (resolved > 0 || fallback > 0) {
      console.log(`[Backtest] ${ps.pair}: ${resolved + fallback} 根歧义K线（止盈止损同现），5m 解析 ${resolved} 根，保守处理 ${fallback} 根`)
    }
  }

  // ---- 汇总 ----
  onProgress?.({ message: '汇总结果', percent: 99 })
  trades.sort((a, b) => a.exitTime - b.exitTime)
  shadowTrades.sort((a, b) => a.exitTime - b.exitTime)
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0)
  const wins = trades.filter(trade => trade.pnl > 0)
  const losses = trades.filter(trade => trade.pnl < 0)
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0))

  const equityCurve: Array<{ time: number; equity: number }> = [{ time: startMs, equity: settings.equity }]
  let equity = settings.equity
  let peak = settings.equity
  let maxDrawdown = 0
  for (const trade of trades) {
    equity += trade.pnl
    equityCurve.push({ time: trade.exitTime, equity })
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak - equity)
  }

  return {
    taskId: task.id,
    taskName: task.name,
    start: startMs,
    end: endMs,
    startedAt,
    completedAt: Date.now(),
    settings: { fixedMargin: settings.fixedMargin, leverage: settings.leverage, equity: settings.equity },
    summary: {
      totalPnl,
      returnPct: settings.equity > 0 ? (totalPnl / settings.equity) * 100 : 0,
      tradeCount: trades.length,
      winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      maxDrawdown,
      avgWin: wins.length > 0 ? grossWin / wins.length : 0,
      avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    },
    trades,
    equityCurve,
    warnings,
    ...(regimeEnabled ? { regimeLog: regimeSeries } : {}),
    ...(breakerEnabled ? { shadowTrades, breakerLog } : {}),
  }
}

function openPositionFromScore(pair: string, score: ScanResult, entryTime: number, sizeFactor?: number): OpenPosition {
  // 与实盘建仓对齐：原始摆动止盈常被最近的 swing 压得很近（~0.4%），
  // 实盘 buildAutoPlanPrices 会把 TP1 抬升到至少 2R，回测必须同样处理，
  // 否则会产生大量实盘不会存在的微利止盈单
  const prices = buildAutoPlanPrices(
    score.direction as 'long' | 'short',
    score.currentPrice,
    score.stopLossTight,
    score.takeProfit,
  )
  return {
    pair,
    timeframe: score.timeframe,
    side: score.direction as 'long' | 'short',
    entryTime,
    entryPrice: score.currentPrice,
    stopPrice: prices.stopPrice,
    takeProfit: prices.takeProfit1,
    trailingStopPercent: score.trailingStopPercent,
    peak: score.currentPrice,
    matchedRules: (score.ruleChecks ?? []).filter(check => check.passed).map(check => check.label),
    sizeFactor,
  }
}
