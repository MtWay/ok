import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePlan } from './trading.js'

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
