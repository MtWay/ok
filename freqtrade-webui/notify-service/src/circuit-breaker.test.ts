/**
 * circuit-breaker.ts 单测：触发 / 冷却等待 / 影子PF恢复 / probe半仓 / 再触发冷却翻倍 / 复位。
 * 运行: npx tsx src/circuit-breaker.test.ts
 */
import assert from 'node:assert'
import { CircuitBreaker, rollingPF, rollingWinRate, type BreakerConfig } from './circuit-breaker.js'

const config: BreakerConfig = {
  windowTrades: 20,
  minWinRate: 35,
  maxDrawdownPct: 15,
  cooldownHours: 24,
  maxCooldownHours: 168,
  shadowMinTrades: 10,
  shadowMinPF: 1.2,
  probeTrades: 5,
}

const H = 3_600_000
const t0 = Date.now()

// ---- rollingWinRate / rollingPF ----
assert.strictEqual(rollingWinRate([], 20), null, '空样本不触发')
assert.strictEqual(rollingWinRate([1, -1, 1], 20), null, '样本不足窗口一半不触发')
assert.strictEqual(rollingWinRate([...Array(10).fill(-1)], 20), 0, '10连亏胜率0')
assert.strictEqual(rollingWinRate([...Array(7).fill(1), ...Array(13).fill(-1)], 20), 35, '20笔7胜=35%')
assert.strictEqual(rollingPF([1, 1, -1]), 2, 'PF=2/1')
assert.strictEqual(rollingPF([1, 1]), Infinity, '无亏损有盈利=Infinity')
assert.strictEqual(rollingPF([-1, -1]), 0, '无盈利=0')

// ---- 1. 胜率触发 ----
{
  const b = new CircuitBreaker('task1', config)
  assert.strictEqual(b.sizeFactor(), 1)
  const pnls = [...Array(14).fill(-1), ...Array(6).fill(1)] // 20笔6胜=30% < 35%
  const ev = b.shouldTrip(pnls, 0)
  assert.ok(ev && ev.event === 'trip', '胜率低于阈值应触发')
  assert.strictEqual(b.current.phase, 'tripped')
  assert.strictEqual(b.sizeFactor(), 0, 'tripped 不开真实仓')
  assert.strictEqual(b.current.cooldownHours, 24, '首次触发冷却不翻倍')
}

// ---- 2. 回撤触发 ----
{
  const b = new CircuitBreaker('task2', config)
  const ev = b.shouldTrip([], 16)
  assert.ok(ev && ev.event === 'trip', '回撤超阈值应触发')
  assert.strictEqual(b.shouldTrip([], 20), null, '已 tripped 不重复触发')
}

// ---- 3. 冷却期内不恢复 ----
{
  const b = new CircuitBreaker('task3', config)
  b.shouldTrip([], 20)
  const goodShadow = [...Array(10).fill(2)]
  assert.strictEqual(b.checkRecovery(goodShadow, t0 + 12 * H), null, '冷却期内不恢复')
}

// ---- 4. 冷却期满：样本不足 / PF 不达标 → 继续等待；达标 → probe ----
{
  const b = new CircuitBreaker('task4', config)
  b.shouldTrip([], 20)
  const after = t0 + 25 * H
  let ev = b.checkRecovery([1, -1], after)
  assert.ok(ev && ev.event === 'cooldown' && ev.detail.includes('样本不足'), '影子样本不足继续等待')
  ev = b.checkRecovery([...Array(5).fill(1), ...Array(5).fill(-2)], after)
  assert.ok(ev && ev.event === 'cooldown' && ev.detail.includes('PF'), '影子 PF 不达标继续等待')
  assert.strictEqual(b.current.phase, 'tripped')
  ev = b.checkRecovery([...Array(8).fill(2), ...Array(2).fill(-1)], after)
  assert.ok(ev && ev.event === 'probe', '影子 PF 达标进 probe')
  assert.strictEqual(b.current.phase, 'probe')
  assert.strictEqual(b.sizeFactor(), 0.5, 'probe 半仓')
}

// ---- 5. probe 试探期满且整体盈利 → active（重置统计基线） ----
{
  const b = new CircuitBreaker('task5', config)
  b.shouldTrip([], 20)
  b.checkRecovery([...Array(10).fill(2)], Date.now() + 25 * H)
  // 试探仓平仓：前 4 笔不恢复（按平仓判定）；每笔平仓盈利（shouldTrip 的 closedPnl 累计）
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(b.shouldTrip([1, 1, 1], 0, Date.now(), 2), null, '试探盈利单不应触发')
    assert.strictEqual(b.onProbeClose(), null, '试探平仓未满不恢复')
  }
  assert.strictEqual(b.shouldTrip([1, 1, 1], 0, Date.now(), 2), null)
  const ev = b.onProbeClose()
  assert.ok(ev && ev.event === 'recovered', '第5笔试探平仓且整体盈利后恢复')
  assert.strictEqual(b.current.phase, 'active')
  assert.strictEqual(b.sizeFactor(), 1)
  assert.ok(b.current.statsResetAt !== undefined, '恢复后应有统计基线')
  assert.strictEqual(b.current.cooldownHours, 24, '恢复后冷却回到初始值')
}

// ---- 5b. probe 试探期满但整体亏损 → 重新 trip，冷却翻倍 ----
{
  const b = new CircuitBreaker('task5b', config)
  b.shouldTrip([], 20)
  b.checkRecovery([...Array(10).fill(2)], Date.now() + 25 * H)
  for (let i = 0; i < 4; i++) {
    b.shouldTrip([], 0, Date.now(), -1) // 试探平仓亏损累计
    b.onProbeClose()
  }
  b.shouldTrip([], 0, Date.now(), -1)
  const ev = b.onProbeClose()
  assert.ok(ev && ev.event === 'trip', '试探整体亏损应重新熔断')
  assert.strictEqual(b.current.phase, 'tripped')
  assert.strictEqual(b.current.cooldownHours, 48, '冷却翻倍 24→48')
}

// ---- 6. probe 期间滚动统计再触发 → 冷却翻倍；翻倍有上限 ----
{
  const b = new CircuitBreaker('task6', config)
  b.shouldTrip([], 20)
  b.checkRecovery([...Array(10).fill(2)], Date.now() + 25 * H)
  assert.strictEqual(b.current.phase, 'probe')
  const ev = b.shouldTrip([], 20) // probe 中回撤再次超标
  assert.ok(ev && ev.event === 'trip', 'probe 期间可再触发')
  assert.strictEqual(b.current.phase, 'tripped')
  assert.strictEqual(b.current.cooldownHours, 48, '冷却翻倍 24→48')
  assert.strictEqual(b.current.tripCount, 2)
  // 48h 内不恢复（trippedAt 用的是真实当前时间，30h 后仍在翻倍冷却期内）
  assert.strictEqual(b.checkRecovery([...Array(10).fill(2)], Date.now() + 30 * H), null, '翻倍冷却期内不恢复')

  // 冷却翻倍封顶：连续触发最多到 maxCooldownHours（168h）
  const b2 = new CircuitBreaker('task6b', config)
  b2.shouldTrip([], 20)
  let now = Date.now()
  for (let i = 0; i < 10; i++) {
    now += (b2.current.cooldownHours + 1) * H
    b2.checkRecovery([...Array(10).fill(2)], now)
    assert.strictEqual(b2.current.phase, 'probe')
    b2.shouldTrip([], 20, now) // probe 中再触发
    assert.strictEqual(b2.current.phase, 'tripped')
  }
  assert.strictEqual(b2.current.cooldownHours, 168, '冷却翻倍封顶 168h')
}

// ---- 7. 手动复位 ----
{
  const b = new CircuitBreaker('task7', config)
  b.shouldTrip([], 20)
  b.reset()
  assert.strictEqual(b.current.phase, 'active')
  assert.strictEqual(b.current.cooldownHours, 24, '复位后冷却回到初始值')
  assert.ok(b.current.statsResetAt !== undefined, '复位后应有统计基线')
  assert.strictEqual(b.sizeFactor(), 1)
}

console.log('circuit-breaker.test.ts: all assertions passed')
