import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectCloseLevels, executeManualClose, CounterPriceDeviationError,
  type ManualCloseDeps,
} from './position-close.js'
import type { PositionState, PositionTask } from './types.js'
import type { TradePlan } from './trading.js'

function taskOf(strategy: PositionTask['strategy']): PositionTask {
  return {
    id: 't1', name: 'test', enabled: true, pair: 'BTC-USDT-SWAP',
    strategy, interval: '15m', params: {} as PositionTask['params'], createdAt: 0, updatedAt: 0,
  }
}

function plan(over: Partial<TradePlan> & { id: string }): TradePlan {
  return {
    pair: 'BTC/USDT:USDT', side: 'long', status: 'open', executionEnabled: true,
    entryPrice: 100, stopPrice: 95, takeProfit1: 110, takeProfit2: 120,
    margin: 100, leverage: 1, notional: 100, maxLoss: 5,
    createdAt: 0, updatedAt: 0, ...over,
  } as TradePlan
}

interface Harness {
  deps: ManualCloseDeps
  closes: Array<{ planId: string; orderType: string; price?: number }>
  marks: string[]
  saved: PositionState | null
}

function harness(state: PositionState, plans: TradePlan[], opts: {
  book?: { bid: number; ask: number; last: number }
  failFor?: (planId: string) => Error | null
} = {}): Harness {
  const closes: Harness['closes'] = []
  const marks: string[] = []
  const h: Harness = { closes, marks, saved: null, deps: null as any }
  h.deps = {
    getState: async () => state,
    saveState: async (_id, s) => { h.saved = s },
    listPlans: async () => plans,
    closePlan: async (planId, _reason, o) => {
      const err = opts.failFor?.(planId)
      if (err) throw err
      closes.push({ planId, orderType: o.orderType, price: o.price })
    },
    markClosed: async planId => { marks.push(planId) },
    getBook: async () => opts.book ?? { bid: 99, ask: 101, last: 100 },
    toInstId: p => p,
  }
  return h
}

test('collects grid levels and classifies live/shadow/no_trade', () => {
  const state: PositionState = {
    taskId: 't1', status: 'long', updatedAt: 0,
    gridLevels: [
      { level: 4, price: 120, tpPrice: 124, planId: 'live1' },
      { level: 3, price: 116, tpPrice: 120, planId: 'shadow1' },
      { level: 2, price: 112, tpPrice: 116, planId: 'pending1' },
    ],
  }
  const plans = [
    plan({ id: 'live1', tradeId: 't-1' }),
    plan({ id: 'shadow1', shadow: true }),
    plan({ id: 'pending1' }),
  ]
  const levels = collectCloseLevels(taskOf('grid'), state, plans)
  assert.deepEqual(levels.map(l => [l.level, l.kind]), [
    [4, 'live'], [3, 'shadow'], [2, 'no_trade'],
  ])
})

test('closing all levels skips shadow and no_trade, removes only closed levels', async () => {
  const state: PositionState = {
    taskId: 't1', status: 'long', updatedAt: 0,
    gridLevels: [
      { level: 4, price: 120, tpPrice: 124, planId: 'live1' },
      { level: 3, price: 116, tpPrice: 120, planId: 'live2' },
      { level: 2, price: 112, tpPrice: 116, planId: 'shadow1' },
      { level: 1, price: 108, tpPrice: 112, planId: 'pending1' },
    ],
  }
  const plans = [
    plan({ id: 'live1', tradeId: 't-1' }),
    plan({ id: 'live2', tradeId: 't-2' }),
    plan({ id: 'shadow1', shadow: true }),
    plan({ id: 'pending1' }),
  ]
  const h = harness(state, plans)

  const result = await executeManualClose(taskOf('grid'), { levels: null, mode: 'market' }, h.deps)

  assert.deepEqual(h.closes.map(c => c.planId).sort(), ['live1', 'live2'])
  assert.deepEqual(h.marks, ['shadow1'])
  assert.deepEqual(result.closed.map(c => c.level).sort(), [2, 3, 4])
  assert.deepEqual(result.skipped.map(s => s.level), [1])
  assert.equal(result.failed.length, 0)

  // 只有真正平掉的层被移除；pending1 那层留在 state 里等重试
  assert.deepEqual(h.saved!.gridLevels!.map(gl => gl.level), [1])
  assert.equal(h.saved!.status, 'long')
})

test('counter mode sends a limit order at the submitted price', async () => {
  const state: PositionState = {
    taskId: 't1', status: 'long', updatedAt: 0,
    gridLevels: [{ level: 2, price: 112, tpPrice: 116, planId: 'live1' }],
  }
  const h = harness(state, [plan({ id: 'live1', tradeId: 't-1' })], {
    book: { bid: 99, ask: 101, last: 100 },
  })

  const result = await executeManualClose(
    taskOf('grid'), { levels: null, mode: 'counter', price: 101.2 }, h.deps,
  )

  assert.deepEqual(h.closes, [{ planId: 'live1', orderType: 'limit', price: 101.2 }])
  assert.equal(result.counterPrice, 101.2)
  assert.equal(result.degraded, undefined)
  assert.equal(h.saved!.status, 'flat')
})

test('counter mode rejects a price too far from the opposite side', async () => {
  const state: PositionState = {
    taskId: 't1', status: 'long', updatedAt: 0,
    gridLevels: [{ level: 2, price: 112, tpPrice: 116, planId: 'live1' }],
  }
  const h = harness(state, [plan({ id: 'live1', tradeId: 't-1' })], {
    book: { bid: 99, ask: 101, last: 100 },
  })

  await assert.rejects(
    () => executeManualClose(taskOf('grid'), { levels: null, mode: 'counter', price: 110 }, h.deps),
    CounterPriceDeviationError,
  )
  // 拒绝必须发生在任何下单之前
  assert.equal(h.closes.length, 0)
  assert.equal(h.saved, null)
})

test('a failing layer does not block the others and is left in state', async () => {
  const state: PositionState = {
    taskId: 't1', status: 'long', updatedAt: 0,
    gridLevels: [
      { level: 3, price: 116, tpPrice: 120, planId: 'bad' },
      { level: 2, price: 112, tpPrice: 116, planId: 'good' },
    ],
  }
  const h = harness(
    state,
    [plan({ id: 'bad', tradeId: 't-bad' }), plan({ id: 'good', tradeId: 't-good' })],
    { failFor: id => (id === 'bad' ? new Error('exchange rejected') : null) },
  )

  const result = await executeManualClose(taskOf('grid'), { levels: null, mode: 'market' }, h.deps)

  assert.deepEqual(result.failed.map(f => [f.level, f.error]), [[3, 'exchange rejected']])
  assert.deepEqual(result.closed.map(c => c.level), [2])
  assert.deepEqual(h.saved!.gridLevels!.map(gl => gl.level), [3])
  assert.equal(h.saved!.status, 'long')
})

test('falls back to a market order when the exchange rejects the limit close', async () => {
  const state: PositionState = {
    taskId: 't1', status: 'long', updatedAt: 0,
    gridLevels: [{ level: 2, price: 112, tpPrice: 116, planId: 'live1' }],
  }
  const closes: string[] = []
  const state2 = { ...state }
  const deps: ManualCloseDeps = {
    getState: async () => state2,
    saveState: async () => {},
    listPlans: async () => [plan({ id: 'live1', tradeId: 't-1' })],
    closePlan: async (_id, _r, o) => {
      closes.push(o.orderType)
      if (o.orderType === 'limit') throw new Error('ordertype limit not supported')
    },
    markClosed: async () => {},
    getBook: async () => ({ bid: 99, ask: 101, last: 100 }),
    toInstId: p => p,
  }

  const result = await executeManualClose(
    taskOf('grid'), { levels: null, mode: 'counter', price: 101 }, deps,
  )

  assert.deepEqual(closes, ['limit', 'market'])
  assert.equal(result.degraded, true)
  assert.deepEqual(result.closed.map(c => c.level), [2])
})

test('closing only the selected levels leaves the rest untouched', async () => {
  const state: PositionState = {
    taskId: 't1', status: 'long', updatedAt: 0,
    gridLevels: [
      { level: 4, price: 120, tpPrice: 124, planId: 'a' },
      { level: 3, price: 116, tpPrice: 120, planId: 'b' },
      { level: 2, price: 112, tpPrice: 116, planId: 'c' },
    ],
  }
  const h = harness(state, [
    plan({ id: 'a', tradeId: 'ta' }), plan({ id: 'b', tradeId: 'tb' }), plan({ id: 'c', tradeId: 'tc' }),
  ])

  await executeManualClose(taskOf('grid'), { levels: [3], mode: 'market' }, h.deps)

  assert.deepEqual(h.closes.map(c => c.planId), ['b'])
  assert.deepEqual(h.saved!.gridLevels!.map(gl => gl.level), [4, 2])
  assert.equal(h.saved!.status, 'long')
})

test('a short grid-less task closes its single plan and resets entry fields', async () => {
  const state: PositionState = {
    taskId: 't1', status: 'short', entryPrice: 130, entryTime: 5, planId: 'p1', updatedAt: 0,
  }
  const h = harness(state, [plan({ id: 'p1', tradeId: 't-1', side: 'short' })], {
    book: { bid: 99, ask: 101, last: 100 },
  })

  const result = await executeManualClose(
    taskOf('ma_cross'), { levels: null, mode: 'counter', price: 99 }, h.deps,
  )

  // 平空吃买一价，校验用的是 bid
  assert.deepEqual(h.closes, [{ planId: 'p1', orderType: 'limit', price: 99 }])
  assert.equal(h.saved!.status, 'flat')
  assert.equal(h.saved!.planId, undefined)
  assert.equal(h.saved!.entryPrice, undefined)
  assert.equal(h.saved!.entryTime, undefined)
  assert.equal(result.closed.length, 1)
})
