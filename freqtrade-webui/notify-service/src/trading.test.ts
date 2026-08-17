import test from 'node:test'
import assert from 'node:assert/strict'
import { basicAuthorization, buildAutoPlanPrices, calculatePlan, canExecutePlan, findFreqtradeTrade, hardStopPercent, nextExecutionRetryAt, resolveCloseReason } from './trading.js'
import { selectPopularSwapPairs, resolveMultiTimeframeConfig } from './scanner.js'

test('sizes a long plan from risk and rejects invalid direction prices', () => {
  const plan = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 102, takeProfit2: 104, equity: 10_000, riskFraction: 0.005,
  })
  assert.equal(plan.notional, 2_500)
  assert.equal(plan.margin, 1_250)
  assert.equal(plan.maxLoss, 50)
  assert.throws(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'short', entryPrice: 100, stopPrice: 98,
    takeProfit1: 102, takeProfit2: 104, equity: 10_000,
  }), /invalid short prices/)
})

test('caps risk fraction and minimum stop distance', () => {
  assert.throws(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 99.8,
    takeProfit1: 101, takeProfit2: 102, equity: 10_000, riskFraction: 0.005,
  }), /at least 0.5%/)
  assert.throws(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 102, takeProfit2: 104, equity: 10_000, riskFraction: 0.02,
  }), /between 0 and 0.01/)
})

test('keeps legacy notification tasks single-timeframe by default', () => {
  const config = resolveMultiTimeframeConfig({ filters: {} as any })
  assert.equal(config.enabled, false)
  assert.equal(config.higherTimeframe, '4H')
})

test('derives valid second targets even when a swing target is farther than 2R', () => {
  const short = buildAutoPlanPrices('short', 100, 105, 80)
  assert.ok(short.takeProfit2 < short.takeProfit1)
  assert.doesNotThrow(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'short', ...short, equity: 10_000,
  }))

  const long = buildAutoPlanPrices('long', 100, 95, 120)
  assert.ok(long.takeProfit2 > long.takeProfit1)
  assert.doesNotThrow(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', ...long, equity: 10_000,
  }))
})

test('retries failed submissions with a capped exponential backoff', () => {
  const now = 1_000_000
  assert.equal(nextExecutionRetryAt(1, now), now + 15_000)
  assert.equal(nextExecutionRetryAt(2, now), now + 30_000)
  const plan = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 102, takeProfit2: 104, equity: 10_000,
  })
  const failed = { ...plan, id: 'test', status: 'submit_failed' as const, executionEnabled: false as const, createdAt: now, updatedAt: now, executionAttempts: 1, nextRetryAt: now + 1 }
  assert.equal(canExecutePlan(failed, now), false)
  assert.equal(canExecutePlan(failed, now + 1), true)
  assert.equal(canExecutePlan({ ...failed, executionAttempts: 3, nextRetryAt: undefined }, now + 1), false)
})

test('uses HTTP Basic Auth for the Freqtrade token endpoint', () => {
  assert.equal(basicAuthorization('freqtrader', 'freqtrader'), 'Basic ZnJlcXRyYWRlcjpmcmVxdHJhZGVy')
})

test('hard stop defaults to 3% and honors a positive env override', () => {
  assert.equal(hardStopPercent(undefined), 3)
  assert.equal(hardStopPercent('5'), 5)
  assert.equal(hardStopPercent('0'), 3)
  assert.equal(hardStopPercent('-2'), 3)
  assert.equal(hardStopPercent('abc'), 3)
})

test('refuses to match a Freqtrade trade id reused by a different pair', () => {
  const trades = { trades: [{ trade_id: 7, pair: 'ATH/USDT:USDT', close_rate: 0.4 }] }
  assert.equal(findFreqtradeTrade(trades, '7', 'KAITO/USDT:USDT'), undefined)
  assert.equal(findFreqtradeTrade(trades, '7', 'ATH/USDT:USDT')?.pair, 'ATH/USDT:USDT')
  assert.equal(findFreqtradeTrade([{ id: 8, pair: 'BTC/USDT:USDT' }], '8', 'BTC/USDT:USDT')?.pair, 'BTC/USDT:USDT')
})

test('keeps the plan close reason when Freqtrade only reports force_exit', () => {
  const base = { id: 'p1', closeReason: 'plan_take_profit' } as any
  assert.equal(resolveCloseReason(base, { sell_reason: 'force_exit' }), 'plan_take_profit')
  assert.equal(resolveCloseReason(base, {}), 'plan_take_profit')
  assert.equal(resolveCloseReason(base, { sell_reason: 'stop_loss' }), 'stop_loss')
  assert.equal(resolveCloseReason({ id: 'p2' } as any, { sell_reason: 'force_exit' }), 'force_exit')
  assert.equal(resolveCloseReason({ id: 'p3' } as any, {}), undefined)
})

test('selects USDT swaps by real 24-hour turnover', () => {
  const pairs = selectPopularSwapPairs([
    { instId: 'ETH-USDT-SWAP', volCcy24h: '200' },
    { instId: 'BTC-USDT-SWAP', volCcy24h: '500' },
    { instId: 'BTC-USDC-SWAP', volCcy24h: '1000' },
    { instId: 'ZERO-USDT-SWAP', volCcy24h: '0' },
  ], 2)
  assert.deepEqual(pairs, ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'])
})
