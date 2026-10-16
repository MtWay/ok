/**
 * 品种-策略匹配验证：海龟 vs 布林的滚动窗口对比。
 *
 * 回答两个问题（见 品种策略匹配讨论记录.md）：
 * 1. 持久性：品种的"海龟超额收益"排名在相邻窗口间是否稳定
 * 2. 可预测性：窗口起点的 oscillation 分数能否预测该窗口的超额收益
 *
 * 用法: npx tsx src/run-strategy-fit.ts
 * 环境变量:
 *   TF=4H            K线周期（默认 4H）
 *   MONTHS=7         回看月数（默认 7）
 *   WINDOW_DAYS=60   窗口长度（默认 60 天）
 *   STEP_DAYS=30     窗口步长（默认 30 天）
 *   SLIPPAGES=0,0.05,0.1  布林滑点敏感性档位（%）
 *   PAIRS=BTC,ETH    指定品种（缺省用最近一次 oscillation 扫描池）
 *   SUB_EQUITY=1000  每品种每策略子权益
 */
import 'dotenv/config' // 加载 .env 的 HTTPS_PROXY 等，OKX 直连不可达时走代理
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCachedHistoricalCandles } from './candleCache.js'
import { barDurationMs, getPopularPairs, runWithConcurrency } from './scanner.js'
import { backtestPair, computeSummary } from './turtleBacktest.js'
import { backtestBollingerPair } from './bollingerBacktest.js'
import { computeOscillationScore, DEFAULT_OSCILLATION_PARAMS, loadOscillationLatest } from './oscillation.js'
import { analyzeFit, edgeOf, type FitWindowRecord } from './strategyFit.js'
import { atomicWriteJson } from './storage.js'

const __filename = fileURLToPath(import.meta.url)
const OUT_DIR = path.join(path.dirname(__filename), '../data/strategy-fit')

const TF = process.env.TF ?? '4H'
const MONTHS = Number(process.env.MONTHS ?? 7)
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 60)
const STEP_DAYS = Number(process.env.STEP_DAYS ?? 30)
const SLIPPAGES = (process.env.SLIPPAGES ?? '0,0.05,0.1').split(',').map(Number)
const SUB_EQUITY = Number(process.env.SUB_EQUITY ?? 1000)
const OSC_LOOKBACK = DEFAULT_OSCILLATION_PARAMS.lookbackBars

async function resolvePairs(): Promise<string[]> {
  if (process.env.PAIRS) {
    return process.env.PAIRS.split(',').map(s => s.trim().toUpperCase().replace(/\/USDT(:USDT)?$/, '-USDT-SWAP'))
  }
  // 品种池只是"选哪些品种"，与扫描时的 timeframe 无关；优先用最大的那份扫描
  for (const tf of ['1H', '4H']) {
    const scan = await loadOscillationLatest(tf)
    if (scan && scan.results.length >= 10) {
      console.log(`[Fit] 品种池：oscillation ${tf} 扫描（${scan.results.length} 个）`)
      return scan.results.map(r => r.pair)
    }
  }
  console.log('[Fit] 无 oscillation 扫描结果，回退到 popular 品种池')
  return getPopularPairs()
}

async function main() {
  const barMs = barDurationMs(TF)
  if (!barMs) throw new Error(`Unsupported timeframe: ${TF}`)

  const endMs = Date.now()
  const startMs = endMs - MONTHS * 30 * 86_400_000
  const windowMs = WINDOW_DAYS * 86_400_000
  const stepMs = STEP_DAYS * 86_400_000

  const windows: Array<{ index: number; start: number; end: number }> = []
  for (let w = startMs, i = 0; w + windowMs <= endMs; w += stepMs, i++) {
    windows.push({ index: i, start: w, end: w + windowMs })
  }
  if (windows.length < 2) throw new Error('窗口数不足 2 个，无法做持久性分析')
  console.log(`[Fit] ${TF} 近${MONTHS}个月 | ${windows.length} 个窗口 × ${WINDOW_DAYS}天 (步长${STEP_DAYS}天) | 滑点档 ${SLIPPAGES.join('/')}%`)

  const pairs = await resolvePairs()
  console.log(`[Fit] ${pairs.length} 个品种，开始取数...`)

  // 1) 取数（含 warmup，供窗口起点的 oscillation 评分用）
  const dataByPair = new Map<string, { timestamps: number[]; candles: string[][] }>()
  const warnings: string[] = []
  await runWithConcurrency(pairs, 6, async pair => {
    try {
      const data = await getCachedHistoricalCandles(pair, TF, startMs, endMs, OSC_LOOKBACK + 60)
      if (data.candles.length > 0) dataByPair.set(pair, data)
      else warnings.push(`${pair}: 无数据`)
    } catch (err) {
      warnings.push(`${pair}: 取数失败 (${err instanceof Error ? err.message : String(err)})`)
    }
  })
  console.log(`[Fit] 取数完成 ${dataByPair.size}/${pairs.length}`)
  for (const w of warnings) console.warn(`[Fit] ${w}`)

  // 2) 逐 品种 × 窗口 × 滑点档 回测
  const recordsBySlip = new Map<number, FitWindowRecord[]>(SLIPPAGES.map(s => [s, []]))
  let done = 0
  for (const [pair, data] of dataByPair) {
    for (const win of windows) {
      const winIdx: number[] = []
      for (let i = 0; i < data.timestamps.length; i++) {
        if (data.timestamps[i] >= win.start && data.timestamps[i] < win.end) winIdx.push(i)
      }
      if (winIdx.length < 100) continue // 数据不足一窗
      const first = winIdx[0]
      const last = winIdx[winIdx.length - 1]
      const winCandles = data.candles.slice(first, last + 1)
      const winTimestamps = data.timestamps.slice(first, last + 1)

      // 窗口起点的 oscillation 评分（只用起点之前的数据，保证是预测）
      const preCandles = data.candles.slice(0, first)
      const osc = computeOscillationScore(preCandles, DEFAULT_OSCILLATION_PARAMS)
      if (!osc) continue

      const turtle = await backtestPair(pair, winCandles, winTimestamps, {}, SUB_EQUITY)
      const s1Trades = turtle.trades.filter(t => t.system === 'S1')
      const s2Trades = turtle.trades.filter(t => t.system === 'S2')
      const s1 = computeSummary(s1Trades.map(t => t.trade), SUB_EQUITY)
      const s2 = computeSummary(s2Trades.map(t => t.trade), SUB_EQUITY)

      for (const slip of SLIPPAGES) {
        const boll = backtestBollingerPair(pair, winCandles, winTimestamps, { slippagePct: slip }, SUB_EQUITY)
        const bollSummary = computeSummary(boll.trades, SUB_EQUITY)
        recordsBySlip.get(slip)!.push({
          pair,
          windowIndex: win.index,
          windowStart: win.start,
          turtleS1ReturnPct: s1.returnPct,
          turtleS2ReturnPct: s2.returnPct,
          turtleTradeCount: s1Trades.length + s2Trades.length,
          bollingerReturnPct: bollSummary.returnPct,
          bollingerTradeCount: boll.trades.length,
          oscTotal: osc.total,
          oscEr: osc.er,
          oscAdx: osc.adx,
          oscAtrPct: osc.atrPct,
          oscTouchFreq: osc.touchFreq,
        })
      }
    }
    done++
    if (done % 5 === 0) console.log(`[Fit] 回测进度 ${done}/${dataByPair.size}`)
  }

  // 3) 分析与输出
  const report: Record<string, unknown> = {
    generatedAt: Date.now(),
    config: { TF, MONTHS, WINDOW_DAYS, STEP_DAYS, SLIPPAGES, SUB_EQUITY },
    windows: windows.map(w => ({ index: w.index, start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })),
    warnings,
    tiers: {} as Record<string, unknown>,
  }

  for (const slip of SLIPPAGES) {
    const records = recordsBySlip.get(slip)!
    const analysis = analyzeFit(records)

    console.log(`\n===== 滑点 ${slip}% （${records.length} 个 品种×窗口 样本） =====`)
    console.log(`持久性（相邻窗口 edge 排名 Spearman 均值）: ${analysis.meanPersistence.toFixed(3)}  → ${analysis.verdict.persistent ? '通过(>0.3)' : '未通过'}`)
    for (const p of analysis.persistenceByWindowPair) {
      console.log(`  窗口 ${p.windows[0]}→${p.windows[1]}: ${p.spearman.toFixed(3)} (${p.pairs} 品种)`)
    }
    console.log(`可预测性（oscTotal vs edge）: pooled Pearson ${analysis.pooledPearson.toFixed(3)} / Spearman ${analysis.pooledSpearman.toFixed(3)} → ${analysis.verdict.predictable ? '通过(<-0.2)' : '未通过'}`)
    console.log(`分量相关: ER ${analysis.componentPearson.er.toFixed(3)} | ADX ${analysis.componentPearson.adx.toFixed(3)} | ATR% ${analysis.componentPearson.atrPct.toFixed(3)} | touch ${analysis.componentPearson.touchFreq.toFixed(3)}`)
    ;(report.tiers as Record<string, unknown>)[`slip_${slip}`] = { analysis, records }
  }

  // 品种汇总表（滑点 0 档）：谁的边缘最稳定
  const base = recordsBySlip.get(SLIPPAGES[0]) ?? []
  const byPair = new Map<string, FitWindowRecord[]>()
  for (const r of base) {
    const list = byPair.get(r.pair) ?? []
    list.push(r)
    byPair.set(r.pair, list)
  }
  console.log('\n===== 品种汇总（滑点 0 档，edge = 海龟S2 − 布林，%） =====')
  console.log('pair                     win  avgS2    avgBoll  avgEdge  oscAvg')
  const rows = [...byPair.entries()].map(([pair, list]) => ({
    pair,
    wins: list.length,
    avgS2: list.reduce((s, r) => s + r.turtleS2ReturnPct, 0) / list.length,
    avgBoll: list.reduce((s, r) => s + r.bollingerReturnPct, 0) / list.length,
    avgEdge: list.reduce((s, r) => s + edgeOf(r), 0) / list.length,
    oscAvg: list.reduce((s, r) => s + r.oscTotal, 0) / list.length,
  })).sort((a, b) => b.avgEdge - a.avgEdge)
  for (const r of rows) {
    console.log(
      `${r.pair.padEnd(24)} ${String(r.wins).padStart(3)}  ${r.avgS2.toFixed(2).padStart(7)}  ${r.avgBoll.toFixed(2).padStart(7)}  ${r.avgEdge.toFixed(2).padStart(7)}  ${r.oscAvg.toFixed(1).padStart(6)}`
    )
  }

  await fs.mkdir(OUT_DIR, { recursive: true })
  const outFile = path.join(OUT_DIR, `fit_${Date.now()}.json`)
  await atomicWriteJson(outFile, report)
  console.log(`\n[Fit] 报告已写入 ${outFile}`)
}

await main()
