/**
 * 端到端验证：「精选品种验证」任务 + 熔断(A) + 信号新鲜度(B) + regime 仓位调节(C)
 * 跑 3/1~9/5 六个月回测，对比无熔断基线（-86%）。
 * 直接调用 runTaskBacktest，不走 HTTP 服务。
 * 用法: npx tsx src/run-regime-backtest.ts
 */
import { getTask } from './storage.js'
import { runTaskBacktest } from './backtest.js'

const TASK_ID = 'task_1788753692847_lsukdbywf'
const START = Date.parse('2026-03-01T00:00:00.000Z')
const END = Date.parse('2026-09-05T23:59:59.999Z')

const task = await getTask(TASK_ID)
if (!task) throw new Error(`Task ${TASK_ID} not found`)

const result = await runTaskBacktest(
  {
    ...task,
    regimeRouting: { enabled: true, sizeRange: 0.5, sizeTrend: 1.5 },
    circuitBreaker: { enabled: true },
    freshness: { risingEdge: true, cooldownAfterStopHours: 24 },
  },
  START,
  END,
  p => console.log(`[${p.percent}%] ${p.message}`),
)

console.log('\n===== 汇总（真实仓） =====')
console.log(`交易 ${result.summary.tradeCount} 笔 | 总收益 ${result.summary.totalPnl.toFixed(2)} USDT (${result.summary.returnPct.toFixed(2)}%)`)
console.log(`胜率 ${result.summary.winRate.toFixed(1)}% | PF ${result.summary.profitFactor.toFixed(2)} | 最大回撤 ${result.summary.maxDrawdown.toFixed(2)}`)

console.log('\n===== 熔断事件 =====')
for (const e of result.breakerLog ?? []) {
  console.log(`${new Date(e.time).toISOString().slice(0, 16)} [${e.event}] ${e.detail}`)
}
if (!result.breakerLog?.length) console.log('（无熔断事件）')

console.log('\n===== Regime 切换 =====')
for (const p of result.regimeLog ?? []) {
  console.log(`${new Date(p.time).toISOString().slice(0, 10)} → ${p.state}`)
}

const shadow = result.shadowTrades ?? []
if (shadow.length > 0) {
  const pnl = shadow.reduce((s, t) => s + t.pnl, 0)
  const wins = shadow.filter(t => t.pnl > 0)
  const gw = wins.reduce((s, t) => s + t.pnl, 0)
  const gl = Math.abs(shadow.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
  console.log('\n===== 影子交易（熔断期间被抑制的信号） =====')
  console.log(`${shadow.length} 笔 | 总收益 ${pnl.toFixed(2)} | 胜率 ${((wins.length / shadow.length) * 100).toFixed(1)}% | PF ${gl > 0 ? (gw / gl).toFixed(2) : 'inf'}`)
}

// 连亏检查：同一品种连续止损的最大次数（验证 NIGHT 类连亏是否缓解）
let maxStreak = 0
let streakPair = ''
const byPair = new Map<string, typeof result.trades>()
for (const t of result.trades) {
  const list = byPair.get(t.pair) ?? []
  list.push(t)
  byPair.set(t.pair, list)
}
for (const [pair, list] of byPair) {
  let streak = 0
  for (const t of list.sort((a, b) => a.exitTime - b.exitTime)) {
    if (t.closeReason === 'plan_stoploss' || t.closeReason === 'plan_trailing_stop') {
      streak++
      if (streak > maxStreak) { maxStreak = streak; streakPair = pair }
    } else {
      streak = 0
    }
  }
}
console.log(`\n===== 连亏检查 =====`)
console.log(`单品种最长连续止损: ${maxStreak} 次 (${streakPair || '-'})`)

console.log(`\n警告 ${result.warnings.length} 条`)
for (const w of result.warnings.slice(0, 10)) console.log(`  ⚠ ${w}`)
