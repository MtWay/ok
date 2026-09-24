import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { calculateATR } from './shared/indicators.js'
import { getCachedHistoricalCandles } from './candleCache.js'
import { barDurationMs, getPopularPairs, runWithConcurrency } from './scanner.js'
import { atomicWriteJson } from './storage.js'
import { getTradingSettings } from './settings.js'
import { TurtleSystem, DEFAULT_TURTLE_PARAMS } from './turtle.js'
import { loadOscillationLatest } from './oscillation.js'
import type {
  TurtleBacktestConfig,
  TurtleBacktestJob,
  TurtleBacktestResult,
  TurtleBar,
  TurtleParams,
  TurtleSummary,
  TurtleSystemId,
  TurtleTrade,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const TURTLE_BACKTEST_DIR = path.join(path.dirname(__filename), '../data/turtle-backtests')
const TURTLE_JOB_FILE = path.join(TURTLE_BACKTEST_DIR, 'latest.json')

const FEE_RATE = 0.0005

function computeDonchian(candles: string[][], period: number): Array<{ high: number; low: number }> {
  const result: Array<{ high: number; low: number }> = []
  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      // 预热哨兵：永不触发突破（bar.high 永远不大于 Infinity，bar.low 永远不小于 -Infinity）
      result.push({ high: Infinity, low: -Infinity })
      continue
    }
    let high = -Infinity
    let low = Infinity
    for (let j = i - period; j < i; j++) {
      const h = Number(candles[j][3])
      const l = Number(candles[j][2])
      if (h > high) high = h
      if (l < low) low = l
    }
    result.push({ high, low })
  }
  return result
}

function toTurtleBars(timestamps: number[], candles: string[][]): TurtleBar[] {
  return candles.map((c, i) => ({
    time: timestamps[i],
    open: Number(c[0]),
    high: Number(c[3]),
    low: Number(c[2]),
    close: Number(c[1]),
  }))
}

interface PairTradeRecord {
  pair: string
  system: TurtleSystemId
  trade: TurtleTrade
}

async function backtestPair(
  pair: string,
  candles: string[][],
  timestamps: number[],
  params: Partial<TurtleParams>,
  subEquity: number
): Promise<{ trades: PairTradeRecord[]; finalEquityS1: number; finalEquityS2: number }> {
  const bars = toTurtleBars(timestamps, candles)
  const atrSeries = calculateATR(candles, 20)
  const s1Params: TurtleParams = { ...DEFAULT_TURTLE_PARAMS.S1, ...params, system: 'S1' }
  const s2Params: TurtleParams = { ...DEFAULT_TURTLE_PARAMS.S2, ...params, system: 'S2' }
  const entryChannelS1 = computeDonchian(candles, s1Params.entryBars)
  const exitChannelS1 = computeDonchian(candles, s1Params.exitBars)
  const entryChannelS2 = computeDonchian(candles, s2Params.entryBars)
  const exitChannelS2 = computeDonchian(candles, s2Params.exitBars)

  const systemS1 = new TurtleSystem(s1Params, subEquity)
  const systemS2 = new TurtleSystem(s2Params, subEquity)

  const trades: PairTradeRecord[] = []
  let openTradeS1: { entryTime: number; entryAvgPrice: number; unitEntries: number[]; side: 'long' | 'short'; qty: number } | null = null
  let openTradeS2: { entryTime: number; entryAvgPrice: number; unitEntries: number[]; side: 'long' | 'short'; qty: number } | null = null

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const atr = atrSeries[i - 1] ?? atrSeries[0]
    const isLast = i === bars.length - 1

    // S1
    const actionsS1 = systemS1.onBar(bar, {
      entryChannel: entryChannelS1[i],
      exitChannel: exitChannelS1[i],
      atr,
      isLast,
    })
    for (const action of actionsS1) {
      if (action.kind === 'entry') {
        openTradeS1 = {
          entryTime: bar.time,
          entryAvgPrice: action.price,
          unitEntries: [action.price],
          side: action.side,
          qty: action.qty,
        }
      } else if (action.kind === 'add' && openTradeS1) {
        openTradeS1.unitEntries.push(action.price)
        openTradeS1.qty += action.qty
        openTradeS1.entryAvgPrice = openTradeS1.unitEntries.reduce((sum, p) => sum + p, 0) / openTradeS1.unitEntries.length
      } else if (action.kind === 'exit' && openTradeS1) {
        const gross = openTradeS1.side === 'long'
          ? (action.price - openTradeS1.entryAvgPrice) * openTradeS1.qty
          : (openTradeS1.entryAvgPrice - action.price) * openTradeS1.qty
        const notional = openTradeS1.entryAvgPrice * openTradeS1.qty
        const fee = notional * FEE_RATE * 2
        const pnl = gross - fee
        trades.push({
          pair,
          system: 'S1',
          trade: {
            pair,
            system: 'S1',
            side: openTradeS1.side,
            entryTime: openTradeS1.entryTime,
            entryAvgPrice: openTradeS1.entryAvgPrice,
            exitTime: bar.time,
            exitPrice: action.price,
            units: openTradeS1.unitEntries.length,
            unitEntries: openTradeS1.unitEntries,
            qty: openTradeS1.qty,
            pnl,
            pnlPct: subEquity > 0 ? (pnl / subEquity) * 100 : 0,
            closeReason: action.reason,
            bars: i - bars.findIndex(b => b.time === openTradeS1!.entryTime),
          },
        })
        openTradeS1 = null
      }
    }

    // S2
    const actionsS2 = systemS2.onBar(bar, {
      entryChannel: entryChannelS2[i],
      exitChannel: exitChannelS2[i],
      atr,
      isLast,
    })
    for (const action of actionsS2) {
      if (action.kind === 'entry') {
        openTradeS2 = {
          entryTime: bar.time,
          entryAvgPrice: action.price,
          unitEntries: [action.price],
          side: action.side,
          qty: action.qty,
        }
      } else if (action.kind === 'add' && openTradeS2) {
        openTradeS2.unitEntries.push(action.price)
        openTradeS2.qty += action.qty
        openTradeS2.entryAvgPrice = openTradeS2.unitEntries.reduce((sum, p) => sum + p, 0) / openTradeS2.unitEntries.length
      } else if (action.kind === 'exit' && openTradeS2) {
        const gross = openTradeS2.side === 'long'
          ? (action.price - openTradeS2.entryAvgPrice) * openTradeS2.qty
          : (openTradeS2.entryAvgPrice - action.price) * openTradeS2.qty
        const notional = openTradeS2.entryAvgPrice * openTradeS2.qty
        const fee = notional * FEE_RATE * 2
        const pnl = gross - fee
        trades.push({
          pair,
          system: 'S2',
          trade: {
            pair,
            system: 'S2',
            side: openTradeS2.side,
            entryTime: openTradeS2.entryTime,
            entryAvgPrice: openTradeS2.entryAvgPrice,
            exitTime: bar.time,
            exitPrice: action.price,
            units: openTradeS2.unitEntries.length,
            unitEntries: openTradeS2.unitEntries,
            qty: openTradeS2.qty,
            pnl,
            pnlPct: subEquity > 0 ? (pnl / subEquity) * 100 : 0,
            closeReason: action.reason,
            bars: i - bars.findIndex(b => b.time === openTradeS2!.entryTime),
          },
        })
        openTradeS2 = null
      }
    }
  }

  return {
    trades,
    finalEquityS1: systemS1.currentEquity,
    finalEquityS2: systemS2.currentEquity,
  }
}

function computeSummary(trades: TurtleTrade[], initialEquity: number): TurtleSummary {
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
  const returnPct = initialEquity > 0 ? (totalPnl / initialEquity) * 100 : 0
  const tradeCount = trades.length
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const winRate = tradeCount > 0 ? (wins.length / tradeCount) * 100 : 0
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
  const avgWin = wins.length > 0 ? grossWin / wins.length : 0
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0

  // Max drawdown from equity curve
  let peak = initialEquity
  let maxDrawdown = 0
  let equity = initialEquity
  const sortedTrades = [...trades].sort((a, b) => a.exitTime - b.exitTime)
  for (const trade of sortedTrades) {
    equity += trade.pnl
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return { totalPnl, returnPct, tradeCount, winRate, profitFactor, maxDrawdown, avgWin, avgLoss }
}

export async function runTurtleBacktest(
  config: TurtleBacktestConfig,
  onProgress?: (progress: { message: string; percent: number }) => void
): Promise<TurtleBacktestResult> {
  const startedAt = Date.now()
  const warnings: string[] = []
  const settings = getTradingSettings()
  const barMs = barDurationMs(config.timeframe)
  if (!barMs) throw new Error(`Unsupported timeframe: ${config.timeframe}`)

  // Resolve pairs
  let pairs: string[]
  if (config.pairs && config.pairs.length > 0) {
    pairs = config.pairs
  } else if (config.fromOscillation) {
    const scan = await loadOscillationLatest(config.fromOscillation.timeframe ?? config.timeframe)
    if (!scan) throw new Error('No oscillation scan found; run oscillation scan first')
    pairs = scan.results.slice(0, config.fromOscillation.topN).map(r => r.pair)
  } else {
    pairs = await getPopularPairs()
  }

  if (pairs.length === 0) throw new Error('No pairs to backtest')

  const subEquity = settings.equity / (pairs.length * 2)
  onProgress?.({ message: `拉取历史 K 线`, percent: 5 })

  // Fetch candles
  const candleCache = new Map<string, { timestamps: number[]; candles: string[][] }>()
  const warmup = 200
  await runWithConcurrency(pairs, 6, async pair => {
    try {
      const data = await getCachedHistoricalCandles(pair, config.timeframe, config.start, config.end, warmup)
      if (data.candles.length > 0) {
        candleCache.set(pair, data)
      } else {
        warnings.push(`${pair}: 区间内无 K 线数据`)
      }
    } catch (err) {
      warnings.push(`${pair}: 取数失败 (${err instanceof Error ? err.message : String(err)})`)
    }
  })

  onProgress?.({ message: `回放 ${pairs.length} 个品种`, percent: 30 })

  // Backtest each pair
  const allTrades: TurtleTrade[] = []
  let processed = 0
  for (const pair of pairs) {
    const data = candleCache.get(pair)
    if (!data) continue
    const result = await backtestPair(pair, data.candles, data.timestamps, config.params ?? {}, subEquity)
    allTrades.push(...result.trades.map(r => r.trade))
    processed++
    onProgress?.({ message: `回放 ${processed}/${pairs.length}`, percent: 30 + Math.round((processed / pairs.length) * 60) })
  }

  // Compute summaries
  const s1Trades = allTrades.filter(t => t.system === 'S1')
  const s2Trades = allTrades.filter(t => t.system === 'S2')
  const summary = computeSummary(allTrades, settings.equity)
  const bySystem = {
    S1: computeSummary(s1Trades, subEquity * pairs.length),
    S2: computeSummary(s2Trades, subEquity * pairs.length),
  }

  // Equity curve: merge all trades by exit time
  const equityCurve: Array<{ time: number; equity: number }> = []
  let equity = settings.equity
  equityCurve.push({ time: config.start, equity })
  const sortedTrades = [...allTrades].sort((a, b) => a.exitTime - b.exitTime)
  for (const trade of sortedTrades) {
    equity += trade.pnl
    equityCurve.push({ time: trade.exitTime, equity })
  }

  const result: TurtleBacktestResult = {
    start: config.start,
    end: config.end,
    startedAt,
    completedAt: Date.now(),
    timeframe: config.timeframe,
    pairs,
    initialEquity: settings.equity,
    summary,
    bySystem,
    trades: allTrades,
    equityCurve,
    warnings,
  }

  return result
}

export async function saveTurtleJob(job: TurtleBacktestJob): Promise<void> {
  await atomicWriteJson(TURTLE_JOB_FILE, job)
  if (job.status === 'completed') {
    const archive = path.join(TURTLE_BACKTEST_DIR, `turtle_${job.completedAt ?? Date.now()}.json`)
    await atomicWriteJson(archive, job)
  }
}

export async function loadTurtleJob(): Promise<TurtleBacktestJob | undefined> {
  try {
    return JSON.parse(await fs.readFile(TURTLE_JOB_FILE, 'utf-8')) as TurtleBacktestJob
  } catch (err: any) {
    if (err.code === 'ENOENT') return undefined
    throw err
  }
}
