import test from 'node:test'
import assert from 'node:assert/strict'
import { computeIndicators, computeGridBounds, gridLevelPrice } from './position-indicators.js'
import { detectGrid, detectMaCross, detectBollinger, detectPivot, detectTurtle } from './position-signals.js'
import type { GridIndicators, PositionState, PositionTask, PositionStrategy } from './types.js'

/** 造一段收盘价序列，K 线布局 [open, close, low, high, volume] */
function candlesFromCloses(closes: number[]): string[][] {
  return closes.map(c => [String(c), String(c), String(c * 0.99), String(c * 1.01), '1000'])
}

function flatState(overrides: Partial<PositionState> = {}): PositionState {
  return { taskId: 't1', status: 'flat', updatedAt: 0, ...overrides }
}

function taskOf(strategy: PositionStrategy, params: any): PositionTask {
  return {
    id: 't1', name: 'test', enabled: true, pair: 'BTC-USDT-SWAP',
    strategy, interval: '15m', params, createdAt: 0, updatedAt: 0,
  }
}

test('grid snapshot exposes the same numbers detectGrid triggers on', () => {
  const params = { lookback: 20, gridCount: 4 }
  const candles = candlesFromCloses([
    100, 102, 104, 106, 108, 110, 112, 114, 116, 118,
    120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100.5,
  ])
  const bounds = computeGridBounds(candles, params)!
  const state = flatState()

  const snap = computeIndicators(taskOf('grid', params), candles, state)!
  assert.equal(snap.kind, 'grid')
  assert.equal(snap.lower, bounds.lowerPrice)
  assert.equal(snap.upper, bounds.upperPrice)
  assert.equal(snap.step, bounds.step)
  assert.equal(snap.nextLevel, params.gridCount)

  // 构造一根正好跌破某一层网格线的 K 线。网格上下界由同一批 K 线算出，
  // 换收盘价会连带改变层位，所以直接搜出真正触发的那根。
  const history = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134, 136]
  let found: { candles: string[][]; level: number; price: number } | undefined
  for (let last = 100; last <= 136 && !found; last += 0.5) {
    const candles = candlesFromCloses([...history, last])
    const state = flatState()
    const entry = detectGrid({ candles, state, now: 0 }, params).find(a => a.type === 'grid_entry') as any
    if (entry) found = { candles, level: entry.level, price: entry.price }
  }

  assert.ok(found, 'expected a grid_entry on some down-crossing candle')
  const snap2 = computeIndicators(taskOf('grid', params), found!.candles, flatState()) as GridIndicators
  assert.equal(snap2.nextLevel, found!.level)
  assert.equal(snap2.nextLevelPrice, found!.price)
  assert.equal(gridLevelPrice(bounds, params.gridCount, found!.level), bounds.lowerPrice + found!.level * bounds.step)
})

test('grid snapshot skips occupied levels when picking the next one', () => {
  const params = { lookback: 20, gridCount: 4 }
  const candles = candlesFromCloses([
    100, 102, 104, 106, 108, 110, 112, 114, 116, 118,
    120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100.5,
  ])
  const state = flatState({
    status: 'long',
    gridLevels: [{ level: 4, price: 119, tpPrice: 121, planId: 'p4' }],
  })
  const snap = computeIndicators(taskOf('grid', params), candles, state) as GridIndicators
  assert.equal(snap.nextLevel, 3)
  assert.equal(snap.levels.length, 1)
  assert.equal(snap.levels[0].level, 4)
})

test('ma_cross snapshot reports the cross that detectMaCross acts on', () => {
  const params = { fastPeriod: 3, slowPeriod: 6 }
  // 上一根快线仍在慢线下方，最后一根跳空上穿
  const closes = [12, 11, 10, 9, 8, 7, 6, 5.5, 6, 14]
  const candles = candlesFromCloses(closes)
  const state = flatState()

  const snap = computeIndicators(taskOf('ma_cross', params), candles, state)!
  assert.equal(snap.kind, 'ma_cross')
  const action = detectMaCross({ candles, state, now: 0 }, params)
  assert.equal((action as any).type, 'entry')
  assert.equal((action as any).reason, 'ma_cross_up')
  assert.equal(snap.cross, 'golden')
  assert.equal(snap.close, (action as any).price)
  assert.equal(snap.stopPrice, (action as any).stopPrice)
  assert.equal(snap.takeProfit1, (action as any).takeProfit1)
  assert.equal(snap.takeProfit2, (action as any).takeProfit2)
})

test('bollinger snapshot bands match detectBollinger entry levels', () => {
  const params = { period: 5, stdDev: 2 }
  const closes = [100, 100, 100, 100, 100, 100, 100, 100, 96, 92]
  const candles = candlesFromCloses(closes)
  const state = flatState()

  const snap = computeIndicators(taskOf('bollinger', params), candles, state)!
  assert.equal(snap.kind, 'bollinger')
  const action = detectBollinger({ candles, state, now: 0 }, params)
  assert.equal((action as any).reason, 'bollinger_lower_touch')
  assert.equal(snap.lower, (action as any).price)
  assert.equal(snap.middle, (action as any).takeProfit1)
  assert.equal(snap.upper, (action as any).takeProfit2)
  assert.ok(Math.abs(snap.bandwidth - (snap.upper - snap.lower) / snap.middle) < 1e-12)
})

test('pivot snapshot bands match detectPivot entry levels', () => {
  const params = { pivotPeriod: 5, threshold: 1, stopPercent: 2 }
  const closes = [100, 101, 102, 101, 100, 99, 98, 96, 95, 94]
  const candles = candlesFromCloses(closes)
  const state = flatState()

  const snap = computeIndicators(taskOf('pivot', params), candles, state)!
  assert.equal(snap.kind, 'pivot')
  const action = detectPivot({ candles, state, now: 0 }, params)
  assert.equal((action as any).type, 'entry')
  assert.ok([snap.s1, snap.s2, snap.r1, snap.r2].includes((action as any).price)
    || (action as any).price === snap.s1 || (action as any).price === snap.s2
    || (action as any).price === snap.r1 || (action as any).price === snap.r2)
  assert.equal(snap.stopPct, 2)
  assert.equal(snap.thresholdPct, 1)
})

test('turtle snapshot exposes channels and next add price', () => {
  const params = { entryBars: 5, exitBars: 3, atrPeriod: 14, maxUnits: 3, unitStepAtr: 1, stopAtr: 2 }
  const closes = [...Array(10).fill(100), 101, 102, 103, 104, 105, 106, 107, 108, 110, 112]
  const candles = candlesFromCloses(closes)
  const state = flatState({ status: 'long', units: [{ price: 100, planId: 'p1', qty: 1 }] })

  const snap = computeIndicators(taskOf('turtle', params), candles, state)!
  assert.equal(snap.kind, 'turtle')
  assert.equal(snap.unitsUsed, 1)
  assert.equal(snap.maxUnits, 3)
  assert.equal(snap.lastUnitPrice, 100)
  assert.ok(snap.entryHigh > snap.entryLow)
  assert.ok(snap.exitHigh > snap.exitLow)

  // 快照给的是触发档位；detectTurtle 的成交价是 max(当根开盘价, 触发档位)，
  // 即不劣于开盘价成交。两者关系必须成立。
  const action = detectTurtle({ candles, state, now: 0 }, params)
  assert.equal(action.type, 'add')
  assert.equal(snap.nextAddPrice, 100 + snap.unitStep)
  assert.equal((action as any).price, Math.max(parseFloat(candles[candles.length - 1][0]), snap.nextAddPrice!))
  assert.equal((action as any).stopPrice, (action as any).price - params.stopAtr * snap.atr)
})
