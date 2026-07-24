import test from 'node:test'
import assert from 'node:assert/strict'
import { basicAuthorization, buildAutoPlanPrices, calculatePlan, canExecutePlan, nextExecutionRetryAt } from './trading.js'
import { selectPopularSwapPairs } from './scanner.js'
import { allowedTradingPairs } from './scheduler.js'

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

test('allows all scanned pairs when the auto-trading whitelist is *', () => {
  assert.equal(allowedTradingPairs('*'), null)
  assert.deepEqual(allowedTradingPairs('BTC/USDT:USDT, ETH/USDT:USDT'), new Set(['BTC/USDT:USDT', 'ETH/USDT:USDT']))
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

test('selects USDT swaps by real 24-hour turnover', () => {
  const pairs = selectPopularSwapPairs([
    { instId: 'ETH-USDT-SWAP', volCcy24h: '200' },
    { instId: 'BTC-USDT-SWAP', volCcy24h: '500' },
    { instId: 'BTC-USDC-SWAP', volCcy24h: '1000' },
    { instId: 'ZERO-USDT-SWAP', volCcy24h: '0' },
  ], 2)
  assert.deepEqual(pairs, ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'])
})
