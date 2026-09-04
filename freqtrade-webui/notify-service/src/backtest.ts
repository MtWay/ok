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
import type { BacktestJob, BacktestResult, BacktestTrade, NotifyTask, ScanResult } from './types.js'

/**
 * 通知任务（策略）历史回测引擎。
 *
 * 用任务的筛选规则（9 条 rules + 多周期配置）在历史行情上回放评估：
 * 每个评估时点只用当时已收盘的最近 300 根 K 线（严格无未来函数），
 * 命中信号且无持仓时按信号收盘价入场，出场规则对齐实盘
 * （trading.ts 的 exitReasonForPlan：固定止损/止盈 + 2×ATR 移动止损）。
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
}

export interface BacktestProgress {
  message: string
  percent: number
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

  // ---- 逐 pair 回放：评估点开仓 + 逐根 K 线管理持仓 ----
  const trades: BacktestTrade[] = []
  let evaluatedPairs = 0
  for (const pair of pairs) {
    evaluatedPairs++
    onProgress?.({
      message: `回放评估 ${evaluatedPairs}/${pairs.length} (${pair})`,
      percent: 30 + Math.round((evaluatedPairs / Math.max(pairs.length, 1)) * 68),
    })

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

    let position: OpenPosition | undefined
    // exitIdx 指向首个尚未处理的出场 K 线（timestamps 升序）
    let exitIdx = 0

    const closePosition = (exitTime: number, exitPrice: number, closeReason: BacktestTrade['closeReason']) => {
      if (!position) return
      const notional = settings.fixedMargin * settings.leverage
      const quantity = notional / position.entryPrice
      const gross = (exitPrice - position.entryPrice) * quantity * (position.side === 'long' ? 1 : -1)
      const pnl = gross - notional * FEE_RATE * 2
      trades.push({
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
        pnlPct: settings.fixedMargin > 0 ? (pnl / settings.fixedMargin) * 100 : 0,
        closeReason,
        matchedRules: position.matchedRules,
      })
      position = undefined
    }

    // 用一根 K 线的 high/low 检查出场，优先级与实盘 exitReasonForPlan 一致：
    // 固定止损 → 固定止盈 → 移动止损（用之前更新的峰值，避免同根 K 线
    // 先高后低的路径假设），最后再用本根极值更新峰值。
    // 返回 true 表示已平仓。
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
    // （applyBar 固定止损优先）。
    const FINE_TIMEFRAME = '5m'
    const fineBarMs = barDurationMs(FINE_TIMEFRAME) ?? 5 * 60_000
    let ambiguousResolved = 0
    let ambiguousFallback = 0

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

    for (const t of evalTimes) {
      // 先处理收盘时刻 <= t 的出场 K 线（该时点之前价格怎么走与评估无关）
      while (exitIdx < exitData.timestamps.length && exitData.timestamps[exitIdx] + exitBarMs <= t) {
        if (position) await checkExit(exitIdx)
        exitIdx++
      }

      // 同一 pair 同时只持一仓（对齐实盘币种占用规则）
      if (position) continue

      for (const tf of activeTimeframes) {
        const data = cache.get(`${pair}|${tf}`)!
        const tfBarMs = barDurationMs(tf)
        if (!tfBarMs) continue
        // 该时点可见窗口：开盘时间 + 周期 <= t 的最近 WINDOW_SIZE 根
        let hi = data.timestamps.length
        while (hi > 0 && data.timestamps[hi - 1] + tfBarMs > t) hi--
        if (hi === 0) continue
        const candles = data.candles.slice(Math.max(0, hi - WINDOW_SIZE), hi)

        let lowerCandles: string[][] = []
        if (lowerTimeframe !== undefined) {
          const lowerData = cache.get(`${pair}|${lowerTimeframe}`)
          const lowerBarMs = barDurationMs(lowerTimeframe)
          if (!lowerData || !lowerBarMs) continue
          let lo = lowerData.timestamps.length
          while (lo > 0 && lowerData.timestamps[lo - 1] + lowerBarMs > t) lo--
          lowerCandles = lowerData.candles.slice(Math.max(0, lo - WINDOW_SIZE), lo)
        }

        let evaluation
        try {
          evaluation = evaluatePairFromCandles(pair, tf, candles, lowerCandles, task, multiTimeframe, true)
        } catch (err) {
          warnings.push(`${pair} ${tf} @${new Date(t).toISOString()}: 评估异常 (${err instanceof Error ? err.message : String(err)})`)
          continue
        }
        const score = evaluation?.score
        if (!evaluation?.debug.matched || !score) continue
        if (score.direction !== 'long' && score.direction !== 'short') continue
        if (!score.currentPrice || !score.stopLossTight || !score.takeProfit) continue

        position = openPositionFromScore(pair, score, t)
        break // 一个时点一个 pair 最多开一仓
      }
    }

    // 区间尾部：处理剩余出场 K 线
    while (exitIdx < exitData.timestamps.length && exitData.timestamps[exitIdx] < endMs) {
      if (position) await checkExit(exitIdx)
      exitIdx++
    }
    // 回测结束仍持仓 → 按最后可见收盘价强制平仓
    if (position) {
      let hi = exitData.timestamps.length
      while (hi > 0 && exitData.timestamps[hi - 1] + exitBarMs > endMs) hi--
      if (hi > 0) closePosition(endMs, Number(exitData.candles[hi - 1][1]), 'backtest_end')
    }
    if (ambiguousResolved > 0 || ambiguousFallback > 0) {
      console.log(`[Backtest] ${pair}: ${ambiguousResolved + ambiguousFallback} 根歧义K线（止盈止损同现），5m 解析 ${ambiguousResolved} 根，保守处理 ${ambiguousFallback} 根`)
    }
  }

  // ---- 汇总 ----
  onProgress?.({ message: '汇总结果', percent: 99 })
  trades.sort((a, b) => a.exitTime - b.exitTime)
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
  }
}

function openPositionFromScore(pair: string, score: ScanResult, entryTime: number): OpenPosition {
  return {
    pair,
    timeframe: score.timeframe,
    side: score.direction as 'long' | 'short',
    entryTime,
    entryPrice: score.currentPrice,
    stopPrice: score.stopLossTight,
    takeProfit: score.takeProfit,
    trailingStopPercent: score.trailingStopPercent,
    peak: score.currentPrice,
    matchedRules: (score.ruleChecks ?? []).filter(check => check.passed).map(check => check.label),
  }
}
