import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 隔离信号/状态文件路径，避免测试写穿到真实 freqtrade_userdir
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-signals-'))
process.env.GRID_SIGNALS_FILE = path.join(tmp, 'grid_signals.json')
process.env.GRID_STATE_FILE = path.join(tmp, 'grid_state.json')

const { upsertGridSignal, removeGridSignal, loadGridSignals, loadActiveGridPairs, loadGridStatePairs, isSignalActive } = await import('./grid-signals.js')

const SIGNALS_FILE: string = process.env.GRID_SIGNALS_FILE!
const STATE_FILE_PATH: string = process.env.GRID_STATE_FILE!

const SIG = (pair: string, createdAt: number, ttlMs = 3600_000) => ({
  id: `grid_t_${createdAt}`, pair, leverage: 3, layerMargin: 5,
  gridCount: 8, lookback: 120, stopPercent: 2, minStepPercent: 0.3,
  createdAt, ttlMs,
})

test('upsert merges by pair and prunes expired signals', async () => {
  const now = Date.now()
  await upsertGridSignal(SIG('ONE/USDT:USDT', now - 1000))
  await upsertGridSignal(SIG('BOME/USDT:USDT', now - 1000))
  // ONE 的活跃信号被同品种新信号替换；BOME 写一条已过期的一起验证清理
  await upsertGridSignal(SIG('ONE/USDT:USDT', now))
  await upsertGridSignal({ ...SIG('CASHCAT/USDT:USDT', now - 2 * 3600_000), ttlMs: 3600_000 })

  const active = await loadGridSignals(now)
  const pairs = active.map(s => s.pair).sort()
  assert.deepEqual(pairs, ['BOME/USDT:USDT', 'ONE/USDT:USDT'])
  const one = active.find(s => s.pair === 'ONE/USDT:USDT')!
  assert.equal(one.createdAt, now)
})

test('removeGridSignal removes only the target pair', async () => {
  const now = Date.now()
  await upsertGridSignal(SIG('ONE/USDT:USDT', now))
  await upsertGridSignal(SIG('BOME/USDT:USDT', now))
  await removeGridSignal('ONE/USDT:USDT')
  assert.deepEqual((await loadActiveGridPairs(now)).size, 1)
})

test('loadGridStatePairs returns pairs with a fresh heartbeat only', async () => {
  const now = Date.now()
  fs.writeFileSync(STATE_FILE_PATH, JSON.stringify({
    'ONE/USDT:USDT': { last_seen_ms: now - 30_000 },
    'BOME/USDT:USDT': { last_seen_ms: now - 2 * 3600_000 },
  }))
  const pairs = await loadGridStatePairs(3600_000, now)
  assert.deepEqual([...pairs], ['ONE/USDT:USDT'])
})

test('isSignalActive honours createdAt + ttlMs', () => {
  const now = 1_800_000_000_000
  assert.equal(isSignalActive(SIG('P', now - 1000), now), true)
  assert.equal(isSignalActive(SIG('P', now - 3700_000), now), false)
})
