/**
 * 单边连续（consecutive_candle）品种筛选 —— 与海龟白名单同款方法：
 * 滚动窗口回测 → 收益排名 → minTrades 过滤 → 取前 N。
 *
 * 同时输出同一数据窗口下的海龟 S2 排名，方便"各取前五个"对照。
 * 回测实现见 consecutiveCandleBacktest.ts（口径对齐实盘）。
 *
 * 用法: npx tsx src/run-cc-select.ts
 *   缺省读 data/turtle-whitelist.json 的参评品种池，用本地 candleCache 数据
 */
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { backtestPair, computeSummary } from './turtleBacktest.js'
import { backtestConsecutiveCandle } from './consecutiveCandleBacktest.js'
import { runWithConcurrency } from './scanner.js'

const __filename = fileURLToPath(import.meta.url)
const CANDLE_DIR = path.join(path.dirname(__filename), '../data/candles')
const WHITELIST_FILE = path.join(path.dirname(__filename), '../data/turtle-whitelist.json')

const TIMEFRAME = '4H'          // 本地缓存最新只到 4H（1H 缓存停留在 9 月）
const LOOKBACK_BARS = 360       // 与海龟白名单一致：60 天 × 4H
const MIN_TRADES = 3
const TOP_N = 5
const SUB_EQUITY = 1000

async function loadCached(pair: string): Promise<{ timestamps: number[]; candles: string[][] } | null> {
  try {
    const d = JSON.parse(await fs.readFile(path.join(CANDLE_DIR, `${pair}_${TIMEFRAME}.json`), 'utf-8'))
    return { timestamps: d.timestamps.slice(-LOOKBACK_BARS), candles: d.candles.slice(-LOOKBACK_BARS) }
  } catch {
    return null
  }
}

async function main() {
  const wl = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf-8'))
  const pool: string[] = wl.entries.map((e: { pair: string }) => e.pair)
  console.log(`[Select] 品种池 ${pool.length} 个（来自 turtle-whitelist 参评池），窗口=${LOOKBACK_BARS}×${TIMEFRAME}`)

  const rows: Array<{ pair: string; turtleRet: number; turtleTrades: number; ccRet: number; ccTrades: number; dataEnd: string }> = []
  await runWithConcurrency(pool, 6, async pair => {
    const data = await loadCached(pair)
    if (!data || data.candles.length < 100) return
    // 海龟 S2（经典规则，与白名单筛选口径一致）
    const t = await backtestPair(pair, data.candles, data.timestamps, {}, SUB_EQUITY)
    const s2 = computeSummary(t.trades.filter(x => x.system === 'S2').map(x => x.trade), SUB_EQUITY)
    // 单边连续
    const ccTrades = backtestConsecutiveCandle(data.candles)
    const cc = computeSummary(ccTrades, SUB_EQUITY)
    rows.push({
      pair,
      turtleRet: s2.returnPct, turtleTrades: t.trades.filter(x => x.system === 'S2').length,
      ccRet: cc.returnPct, ccTrades: ccTrades.length,
      dataEnd: new Date(data.timestamps[data.timestamps.length - 1]).toISOString().slice(0, 10),
    })
  })

  const printTop = (title: string, key: 'turtle' | 'cc') => {
    const ranked = rows
      .filter(r => (key === 'turtle' ? r.turtleTrades : r.ccTrades) >= MIN_TRADES)
      .sort((a, b) => (key === 'turtle' ? b.turtleRet - a.turtleRet : b.ccRet - a.ccRet))
    console.log(`\n===== ${title}（交易数≥${MIN_TRADES}，共 ${ranked.length} 个参评）=====`)
    ranked.slice(0, TOP_N).forEach((r, i) => {
      const ret = key === 'turtle' ? r.turtleRet : r.ccRet
      const n = key === 'turtle' ? r.turtleTrades : r.ccTrades
      console.log(`  ${i + 1}. ${r.pair.padEnd(24)} ${ret.toFixed(2).padStart(9)}%  (${n} 笔)`)
    })
    return ranked.slice(0, TOP_N).map(r => r.pair)
  }

  const turtleTop = printTop('海龟 S2 收益排名 TOP5', 'turtle')
  const ccTop = printTop('单边连续收益排名 TOP5', 'cc')
  console.log(`\n海龟 TOP5:   ${turtleTop.join(', ')}`)
  console.log(`单边连续 TOP5: ${ccTop.join(', ')}`)
  const overlap = turtleTop.filter(p => ccTop.includes(p))
  console.log(`重叠: ${overlap.length ? overlap.join(', ') : '无'}`)
  console.log(`\n数据截止: ${rows[0]?.dataEnd ?? '-'}（本地缓存，无代理无法刷新）`)
}

await main()
