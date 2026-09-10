/**
 * 「高区间」任务消融实验：同区间（3/9~9/7）分别只开 A/B/C 之一，定位哪个机制拖累收益。
 * 用法: npx tsx src/run-ablation.ts <A|B|C|AB|AC|BC|off>
 * 基线（全关）和 ABC（全开）已有结果：+17.36 / -8.28。
 */
import { getTask } from './storage.js'
import { runTaskBacktest } from './backtest.js'

const TASK_ID = 'task_1788765528372_ntyshkleb'
const START = Date.parse('2026-03-09T00:00:00.000Z')
const END = Date.parse('2026-09-07T23:59:59.999Z')

const mode = process.argv[2]
if (!mode || !/^(off|A|B|C|AB|AC|BC|ABC)$/.test(mode)) {
  console.error('用法: npx tsx src/run-ablation.ts <off|A|B|C|AB|AC|BC|ABC>')
  process.exit(1)
}

const task = await getTask(TASK_ID)
if (!task) throw new Error(`Task ${TASK_ID} not found`)

const on = (flag: 'A' | 'B' | 'C') => mode.includes(flag)

const result = await runTaskBacktest(
  {
    ...task,
    regimeRouting: { ...task.regimeRouting, enabled: on('C') },
    circuitBreaker: { ...task.circuitBreaker, enabled: on('A') },
    freshness: { ...task.freshness, risingEdge: on('B'), cooldownAfterStopHours: on('B') ? (task.freshness?.cooldownAfterStopHours ?? 12) : 0 },
  },
  START,
  END,
  p => { if (p.percent % 10 === 0) console.log(`[${p.percent}%] ${p.message}`) },
)

const s = result.summary
console.log(`\n===== 消融 ${mode} =====`)
console.log(`交易 ${s.tradeCount} 笔 | 总收益 ${s.totalPnl.toFixed(2)} USDT (${s.returnPct.toFixed(2)}%)`)
console.log(`胜率 ${s.winRate.toFixed(1)}% | PF ${s.profitFactor.toFixed(2)} | 最大回撤 ${s.maxDrawdown.toFixed(2)}`)

const bl = result.breakerLog ?? []
if (bl.length > 0) {
  const cnt: Record<string, number> = {}
  for (const e of bl) cnt[e.event] = (cnt[e.event] ?? 0) + 1
  console.log(`熔断事件: ${JSON.stringify(cnt)}`)
}
const shadow = result.shadowTrades ?? []
if (shadow.length > 0) {
  const pnl = shadow.reduce((sum, t) => sum + t.pnl, 0)
  console.log(`影子交易: ${shadow.length} 笔, 总收益 ${pnl.toFixed(2)}`)
}
