/**
 * 海龟单策略品种优选的 walk-forward 验证。
 *
 * 复用 run-strategy-fit 的结果（每品种×窗口的海龟 S2 收益），检验：
 * "用过去窗口的海龟收益排名选品种，能否在下一窗口跑赢全品种平均？"
 *
 * 三个检验：
 * 1. 排名持久性：相邻窗口海龟 S2 收益排名的 Spearman
 * 2. 单窗 walk-forward：按上一窗口收益取前 1/3，看下一窗口是否跑赢均值
 * 3. 双窗 walk-forward：按过去两窗口均值取前 1/3（更稳的排名信号）
 *
 * 用法: npx tsx src/run-turtle-select.ts [fit报告路径]
 *   缺省读 data/strategy-fit/ 下最新的 fit_*.json
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { spearman, pearson } from './strategyFit.js'

const __filename = fileURLToPath(import.meta.url)
const FIT_DIR = path.join(path.dirname(__filename), '../data/strategy-fit')

interface FitRecord {
  pair: string
  windowIndex: number
  turtleS2ReturnPct: number
  turtleTradeCount: number
}

interface StepResult {
  window: number
  signal: 'prev1' | 'prev2'
  topPairs: string[]
  topMeanNext: number
  allMeanNext: number
  bottomMeanNext: number
  excess: number // topMeanNext - allMeanNext
}

async function latestFitFile(): Promise<string> {
  const arg = process.argv[2]
  if (arg) return arg
  const files = (await fs.readdir(FIT_DIR)).filter(f => f.startsWith('fit_')).sort()
  if (files.length === 0) throw new Error(`无 fit 报告：${FIT_DIR}`)
  return path.join(FIT_DIR, files[files.length - 1])
}

function simulate(
  byWindow: Map<number, Map<string, number>>,
  windowIds: number[],
  lookback: 1 | 2,
): StepResult[] {
  const steps: StepResult[] = []
  for (let k = lookback; k < windowIds.length; k++) {
    const w = windowIds[k]
    // 排名信号：过去 lookback 个窗口的收益均值
    const signal = new Map<string, number>()
    for (let b = 1; b <= lookback; b++) {
      for (const [pair, ret] of byWindow.get(windowIds[k - b])!) {
        signal.set(pair, (signal.get(pair) ?? 0) + ret / lookback)
      }
    }
    const next = byWindow.get(w)!
    // 只评在信号窗和下一窗都有数据的品种
    const eligible = [...signal.keys()].filter(p => next.has(p))
    if (eligible.length < 6) continue
    const ranked = eligible.sort((a, b) => signal.get(b)! - signal.get(a)!)
    const third = Math.max(1, Math.floor(ranked.length / 3))
    const top = ranked.slice(0, third)
    const bottom = ranked.slice(-third)
    const meanOf = (pairs: string[]) => pairs.reduce((s, p) => s + next.get(p)!, 0) / pairs.length
    const allMean = meanOf(eligible)
    const topMean = meanOf(top)
    steps.push({
      window: w,
      signal: lookback === 1 ? 'prev1' : 'prev2',
      topPairs: top,
      topMeanNext: topMean,
      allMeanNext: allMean,
      bottomMeanNext: meanOf(bottom),
      excess: topMean - allMean,
    })
  }
  return steps
}

async function main() {
  const file = await latestFitFile()
  console.log(`[Select] 读取 ${file}`)
  const report = JSON.parse(await fs.readFile(file, 'utf-8'))
  const records: FitRecord[] = report.tiers.slip_0.records

  const byWindow = new Map<number, Map<string, number>>()
  for (const r of records) {
    if (!byWindow.has(r.windowIndex)) byWindow.set(r.windowIndex, new Map())
    byWindow.get(r.windowIndex)!.set(r.pair, r.turtleS2ReturnPct)
  }
  const windowIds = [...byWindow.keys()].sort((a, b) => a - b)
  console.log(`[Select] ${windowIds.length} 个窗口，每窗 ${byWindow.get(windowIds[0])!.size}~${byWindow.get(windowIds[windowIds.length - 1])!.size} 品种`)

  // 1) 海龟 S2 收益排名的相邻窗口持久性
  console.log('\n===== 1) 海龟收益排名持久性（Spearman） =====')
  const persist: number[] = []
  for (let k = 0; k + 1 < windowIds.length; k++) {
    const a = byWindow.get(windowIds[k])!
    const b = byWindow.get(windowIds[k + 1])!
    const common = [...a.keys()].filter(p => b.has(p))
    const s = spearman(common.map(p => a.get(p)!), common.map(p => b.get(p)!))
    persist.push(s)
    console.log(`  窗口 ${windowIds[k]}→${windowIds[k + 1]}: ${s.toFixed(3)} (${common.length} 品种)`)
  }
  const meanP = persist.reduce((x, y) => x + y, 0) / persist.length
  console.log(`  均值: ${meanP.toFixed(3)}`)

  // 2)+3) walk-forward 模拟
  for (const lookback of [1, 2] as const) {
    const steps = simulate(byWindow, windowIds, lookback)
    console.log(`\n===== ${lookback === 1 ? '2' : '3'}) walk-forward（按过去${lookback}窗收益取前1/3） =====`)
    console.log('  step  window  top1/3下窗   全体下窗   后1/3下窗   超额')
    let wins = 0
    for (const st of steps) {
      if (st.excess > 0) wins++
      console.log(
        `        ${String(st.window).padStart(5)}  ${st.topMeanNext.toFixed(2).padStart(9)}  ${st.allMeanNext.toFixed(2).padStart(9)}  ${st.bottomMeanNext.toFixed(2).padStart(9)}  ${st.excess >= 0 ? '+' : ''}${st.excess.toFixed(2)}`
      )
    }
    if (steps.length > 0) {
      const meanExcess = steps.reduce((s, x) => s + x.excess, 0) / steps.length
      const bottomMean = steps.reduce((s, x) => s + x.bottomMeanNext, 0) / steps.length
      const topMean = steps.reduce((s, x) => s + x.topMeanNext, 0) / steps.length
      const allMean = steps.reduce((s, x) => s + x.allMeanNext, 0) / steps.length
      console.log(`  胜率(超额>0): ${wins}/${steps.length} | 平均超额: ${meanExcess >= 0 ? '+' : ''}${meanExcess.toFixed(2)}%/窗`)
      console.log(`  均值: top1/3 ${topMean.toFixed(2)} | 全体 ${allMean.toFixed(2)} | 后1/3 ${bottomMean.toFixed(2)}`)
      // 超额与 0 的相关性粗检：top-bottom 价差才是纯多头选择能力的度量
      const tb = steps.map(x => x.topMeanNext - x.bottomMeanNext)
      console.log(`  top-后1/3 价差均值: ${(tb.reduce((s, x) => s + x, 0) / tb.length).toFixed(2)}%/窗`)
    } else {
      console.log('  样本不足')
    }
  }

  // 附加：当前最新窗口的排名（若要现在选品种，看这张表）
  const lastW = windowIds[windowIds.length - 1]
  const last = byWindow.get(lastW)!
  const ranked = [...last.entries()].sort((a, b) => b[1] - a[1])
  console.log(`\n===== 最新窗口（${lastW}）海龟 S2 收益排名 =====`)
  for (const [p, r] of ranked) {
    console.log(`  ${p.padEnd(24)} ${r.toFixed(2).padStart(8)}`)
  }
}

await main()
