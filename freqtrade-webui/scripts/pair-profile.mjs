/**
 * 品种画像 + 回测聚合排名
 *
 * 用法: node scripts/pair-profile.mjs [--top N]
 *
 * 数据源（全部为本地文件，无网络请求）:
 * - notify-service/data/candles/<pair>_1H.json  K线缓存 → 性格画像指标
 * - notify-service/data/backtests/*.json        回测结果 → 品种成交统计
 *
 * 画像指标:
 * - trendPct:   滑动窗口(300根,步长24)调 scoreSymbol，趋势评分>=60 的窗口占比
 * - avgScore:   窗口趋势评分均值
 * - atrPct:     ATR(14)/收盘价 的中位数（%）
 * - feeStopRatio: 双边手续费0.1% / (2×atrPct)，>0.1 说明手续费磨损显著
 * - fakeBreakPct: 20根新高中"刺穿未站稳"的比例（摆动结构可靠度的反向指标）
 * - btcCorr:    与 BTC 1H 对数收益的皮尔逊相关系数（组合分散用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../notify-service/data')
const { scoreSymbol } = require('../notify-service/dist/shared/trendScore.js')
const { calculateADX, calculateATR } = require('../notify-service/dist/shared/indicators.js')

const WINDOW = 300
const STEP = 24
const TREND_SCORE_MIN = 60
const FEE_RATE_ROUND_TRIP = 0.001 // 双边 0.05% × 2，按名义价值

function median(arr) {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 20根新高的假突破率：high 刺穿前20根最高 high 但收盘回落 */
function fakeBreakRate(candles) {
  let breaks = 0
  let fakes = 0
  for (let i = 20; i < candles.length; i++) {
    let prevHigh = -Infinity
    for (let j = i - 20; j < i; j++) prevHigh = Math.max(prevHigh, Number(candles[j][3]))
    const high = Number(candles[i][3])
    const close = Number(candles[i][1])
    if (high > prevHigh) {
      breaks++
      if (close < prevHigh) fakes++
    }
  }
  return breaks > 10 ? fakes / breaks : null
}

function logReturns(series) {
  const out = []
  for (let i = 1; i < series.length; i++) out.push(Math.log(series[i] / series[i - 1]))
  return out
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 30) return null
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y; da += x * x; db += y * y
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null
}

// ---- 加载回测品种统计（合并所有 backtest job 的 trades） ----
function loadBacktestStats() {
  const dir = path.join(DATA_DIR, 'backtests')
  const byPair = new Map()
  if (!fs.existsSync(dir)) return byPair
  for (const file of fs.readdirSync(dir)) {
    // 跳过 taskId_时间戳.json 归档副本，只统计最新结果，避免重复计数
    if (!file.endsWith('.json') || /_\d{13}\.json$/.test(file)) continue
    const job = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
    for (const t of job.result?.trades ?? []) {
      const s = byPair.get(t.pair) ?? { n: 0, pnl: 0, wins: 0, grossWin: 0, grossLoss: 0, worst: 0 }
      s.n++; s.pnl += t.pnl
      if (t.pnl > 0) { s.wins++; s.grossWin += t.pnl } else { s.grossLoss += Math.abs(t.pnl) }
      s.worst = Math.min(s.worst, t.pnl)
      byPair.set(t.pair, s)
    }
  }
  return byPair
}

// ---- 主流程 ----
const files = fs.readdirSync(path.join(DATA_DIR, 'candles')).filter(f => f.endsWith('_1H.json'))
const btStats = loadBacktestStats()

// BTC 基准收益序列（按时间戳对齐）
let btcByTs = null
const rows = []

for (const file of files) {
  const pair = file.replace('_1H.json', '')
  const { timestamps, candles } = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'candles', file), 'utf-8'))
  if (candles.length < WINDOW + 50) continue

  const closes = candles.map(c => Number(c[1]))
  const atrSeries = calculateATR(candles, 14)
  const adxSeries = calculateADX(candles, 14)

  // ATR% 中位数
  const atrPcts = []
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(atrSeries[i]) && closes[i] > 0) atrPcts.push((atrSeries[i] / closes[i]) * 100)
  }
  const atrPct = median(atrPcts)

  // 趋势窗口：滑动调 scoreSymbol
  let trendHits = 0, windows = 0, scoreSum = 0
  let adxOver20 = 0, adxCount = 0
  for (let end = WINDOW; end <= candles.length; end += STEP) {
    const slice = candles.slice(end - WINDOW, end)
    try {
      const r = scoreSymbol(pair, '1H', slice)
      if (!r.insufficientData) {
        windows++
        scoreSum += r.trendScore
        if (r.trendScore >= TREND_SCORE_MIN) trendHits++
      }
    } catch { /* 数据异常窗口跳过 */ }
    const adx = adxSeries[end - 1]
    if (Number.isFinite(adx)) { adxCount++; if (adx > 20) adxOver20++ }
  }

  // BTC 相关性（按时间戳对齐收盘价）
  if (pair === 'BTC-USDT-SWAP') {
    btcByTs = new Map(timestamps.map((ts, i) => [ts, closes[i]]))
  }

  const bt = btStats.get(pair)
  rows.push({
    pair,
    bars: candles.length,
    trendPct: windows > 0 ? (trendHits / windows) * 100 : 0,
    avgScore: windows > 0 ? scoreSum / windows : 0,
    adxPct: adxCount > 0 ? (adxOver20 / adxCount) * 100 : 0,
    atrPct,
    feeStopRatio: atrPct > 0 ? FEE_RATE_ROUND_TRIP / (2 * atrPct / 100) : Infinity,
    fakeBreakPct: fakeBreakRate(candles),
    closesByTs: new Map(timestamps.map((ts, i) => [ts, closes[i]])),
    bt: bt ? {
      n: bt.n, pnl: bt.pnl,
      winRate: (bt.wins / bt.n) * 100,
      pf: bt.grossLoss > 0 ? bt.grossWin / bt.grossLoss : (bt.grossWin > 0 ? Infinity : 0),
      worst: bt.worst,
    } : null,
  })
}

// BTC 相关性
if (btcByTs) {
  const btcTs = [...btcByTs.keys()].sort((a, b) => a - b)
  const btcCloses = btcTs.map(ts => btcByTs.get(ts))
  const btcRet = logReturns(btcCloses)
  for (const row of rows) {
    const aligned = []
    const btcAligned = []
    // 对齐共同时间戳后再算收益相关
    const common = btcTs.filter(ts => row.closesByTs.has(ts))
    if (common.length < 40) { row.btcCorr = null; continue }
    const a = common.map(ts => row.closesByTs.get(ts))
    const b = common.map(ts => btcByTs.get(ts))
    row.btcCorr = pearson(logReturns(a), logReturns(b))
  }
}

// ---- 综合评分（0-100）：趋势性40 + 结构可靠25 + 费用友好20 + 波动适中15 ----
for (const r of rows) {
  const trendPart = Math.min(r.trendPct / 50, 1) * 40            // 50% 趋势时间满分
  const structPart = r.fakeBreakPct === null ? 12 : (1 - Math.min(r.fakeBreakPct / 0.6, 1)) * 25
  const feePart = (1 - Math.min(r.feeStopRatio / 0.2, 1)) * 20   // 费用/止损 >0.2 得 0 分
  const volPart = (r.atrPct >= 0.3 && r.atrPct <= 1.5) ? 15 : r.atrPct < 0.3 ? (r.atrPct / 0.3) * 15 : Math.max(0, (2.5 - r.atrPct)) * 10
  r.fitScore = trendPart + structPart + feePart + volPart
  delete r.closesByTs
}

rows.sort((a, b) => b.fitScore - a.fitScore)

const topN = Number(process.argv[process.argv.indexOf('--top') + 1]) || 30
console.log(`品种画像排名（共 ${rows.length} 个，1H，窗口${WINDOW}根/步长${STEP}）`)
console.log('评分 = 趋势性40% + 结构可靠25% + 费用友好20% + 波动适中15%')
console.log()
const header = ['排名', '品种', '画像分', '趋势%', '均分', 'ADX>20%', 'ATR%', '费/损', '假突破%', 'BTC相关', '回测笔数', '回测盈亏', '胜率', 'PF']
console.log(header.join('\t'))
for (const [i, r] of rows.slice(0, topN).entries()) {
  console.log([
    i + 1, r.pair.replace('-USDT-SWAP', ''), r.fitScore.toFixed(0),
    r.trendPct.toFixed(0), r.avgScore.toFixed(0), r.adxPct.toFixed(0),
    r.atrPct.toFixed(2), r.feeStopRatio.toFixed(3),
    r.fakeBreakPct === null ? '-' : (r.fakeBreakPct * 100).toFixed(0),
    r.btcCorr === null ? '-' : r.btcCorr.toFixed(2),
    r.bt?.n ?? 0, r.bt ? r.bt.pnl.toFixed(1) : '-',
    r.bt ? r.bt.winRate.toFixed(0) + '%' : '-',
    r.bt ? (r.bt.pf === Infinity ? '∞' : r.bt.pf.toFixed(2)) : '-',
  ].join('\t'))
}
console.log()
console.log('--- 画像最差 10 个（建议回避） ---')
for (const r of rows.slice(-10)) {
  console.log([r.pair.replace('-USDT-SWAP', ''), '分:' + r.fitScore.toFixed(0), '趋势%:' + r.trendPct.toFixed(0), 'ATR%:' + r.atrPct.toFixed(2), '费/损:' + r.feeStopRatio.toFixed(2), '假突破:' + (r.fakeBreakPct === null ? '-' : (r.fakeBreakPct * 100).toFixed(0)) + '%', r.bt ? `回测:${r.bt.pnl.toFixed(1)}(${r.bt.n}笔)` : ''].join('\t'))
}
