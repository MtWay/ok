/**
 * 单边连续「信号K线数」扫参：对品种池逐一遍历 consecutiveCount，
 * 对比不同根数的整体收益表现，辅助选择 cc-auto 的信号K线数配置。
 *
 * 每个 (品种, 根数) 跑一次 60 天回测（consecutiveCandleBacktest，
 * 口径对齐实盘），按根数汇总：中位数收益、正收益品种占比、TOP 品种。
 *
 * 用法: npx tsx src/run-cc-sweep.ts [起始根数] [结束根数]
 *   缺省 2..8，品种池读 data/turtle-whitelist.json 参评池，用本地缓存
 */
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { computeSummary } from './turtleBacktest.js'
import { backtestConsecutiveCandle } from './consecutiveCandleBacktest.js'
import { runWithConcurrency } from './scanner.js'

const __filename = fileURLToPath(import.meta.url)
const CANDLE_DIR = path.join(path.dirname(__filename), '../data/candles')
const WHITELIST_FILE = path.join(path.dirname(__filename), '../data/turtle-whitelist.json')

const TIMEFRAME = '4H'        // 本地缓存最新只到 4H
const LOOKBACK_BARS = 360     // 60 天 × 4H
const SUB_EQUITY = 1000
const N_FROM = Number(process.argv[2] ?? 2)
const N_TO = Number(process.argv[3] ?? 8)

async function loadCached(pair: string): Promise<{ timestamps: number[]; candles: string[][] } | null> {
  try {
    const d = JSON.parse(await fs.readFile(path.join(CANDLE_DIR, `${pair}_${TIMEFRAME}.json`), 'utf-8'))
    return { timestamps: d.timestamps.slice(-LOOKBACK_BARS), candles: d.candles.slice(-LOOKBACK_BARS) }
  } catch {
    return null
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

async function main() {
  const wl = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf-8'))
  const pool: string[] = wl.entries.map((e: { pair: string }) => e.pair)
  const ns = Array.from({ length: N_TO - N_FROM + 1 }, (_, i) => N_FROM + i)
  console.log(`[Sweep] 品种池 ${pool.length} 个，信号K线数 ${N_FROM}..${N_TO}，窗口=${LOOKBACK_BARS}×${TIMEFRAME}`)

  // rows[pair][n] = { ret, trades }
  const rows: Record<string, Record<number, { ret: number; trades: number }>> = {}
  let dataEnd = ''
  await runWithConcurrency(pool, 6, async pair => {
    const data = await loadCached(pair)
    if (!data || data.candles.length < 100) return
    dataEnd = new Date(data.timestamps[data.timestamps.length - 1]).toISOString().slice(0, 10)
    rows[pair] = {}
    for (const n of ns) {
      const trades = backtestConsecutiveCandle(data.candles, { consecutiveCount: n, atrPeriod: 14, stopAtrMult: 2 })
      rows[pair][n] = { ret: computeSummary(trades, SUB_EQUITY).returnPct, trades: trades.length }
    }
  })

  // 按根数汇总
  console.log(`\n===== 按信号K线数汇总（${Object.keys(rows).length} 个品种）=====`)
  console.log('根数 | 中位数收益 | 平均收益 | 正收益占比 | 平均笔数')
  for (const n of ns) {
    const rets = Object.values(rows).map(r => r[n].ret)
    const tns = Object.values(rows).map(r => r[n].trades)
    const posRatio = rets.filter(r => r > 0).length / rets.length
    console.log(
      `  ${n}  | ${median(rets).toFixed(2).padStart(9)}% | ${(rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2).padStart(8)}% | ${(posRatio * 100).toFixed(0).padStart(6)}%  | ${(tns.reduce((a, b) => a + b, 0) / tns.length).toFixed(1)}`,
    )
  }

  // 每个根数的 TOP5 品种
  for (const n of ns) {
    const top = Object.entries(rows)
      .map(([pair, r]) => ({ pair, ...r[n] }))
      .filter(r => r.trades >= 3)
      .sort((a, b) => b.ret - a.ret)
      .slice(0, 5)
    console.log(`\n--- ${n} 根 TOP5 ---`)
    top.forEach((r, i) => console.log(`  ${i + 1}. ${r.pair.padEnd(24)} ${r.ret.toFixed(2).padStart(9)}%  (${r.trades} 笔)`))
  }

  // 每个品种的最优根数分布
  const best: Record<number, number> = {}
  for (const r of Object.values(rows)) {
    const n = ns.reduce((a, b) => (r[a].ret >= r[b].ret ? a : b))
    best[n] = (best[n] ?? 0) + 1
  }
  console.log(`\n各品种最优根数分布: ${ns.map(n => `${n}根:${best[n] ?? 0}个`).join('  ')}`)
  console.log(`数据截止: ${dataEnd}（本地缓存）`)
}

await main()
