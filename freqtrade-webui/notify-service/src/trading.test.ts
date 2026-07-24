import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAutoPlanPrices, calculatePlan } from './trading.js'
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

test('selects USDT swaps by real 24-hour turnover', () => {
  const pairs = selectPopularSwapPairs([
    { instId: 'ETH-USDT-SWAP', volCcy24h: '200' },
    { instId: 'BTC-USDT-SWAP', volCcy24h: '500' },
    { instId: 'BTC-USDC-SWAP', volCcy24h: '1000' },
    { instId: 'ZERO-USDT-SWAP', volCcy24h: '0' },
  ], 2)
  assert.deepEqual(pairs, ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'])
})
