import test from 'node:test'
import assert from 'node:assert/strict'
import { basicAuthorization, buildAutoPlanPrices, calculatePlan, canExecutePlan, failZombiePlans, findFreqtradeTrade, findOrphanTrades, hardStopPercent, isPairBlocked, isSourceKeyBlocked, nextExecutionRetryAt, orphanCloseAction, planHardStopRatio, resolveCloseReason, sanitizeSignal, toTimestamp, updateShadowPlan } from './trading.js'
import { __setTradingSettingsForTest, getTradingSettings } from './settings.js'
import { dropUnclosedCandles, normalizeOkxCandles, selectPopularSwapPairs, resolveMultiTimeframeConfig } from './scanner.js'

test('sizes a long plan from risk and rejects invalid direction prices', () => {
  const plan = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 102, takeProfit2: 104, equity: 10_000, riskFraction: 0.005,
    leverage: 2,
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

test('drops only the trailing in-progress candle', () => {
  const hour = 3_600_000
  const now = hour * 10 // exactly on the hour
  const candle = (openTs: number) => [String(openTs), '1', '1', '1', '1', '0', '0', '0']
  // Candles are oldest-first after fetchOKXCandles reverses them.
  const data = [candle(hour * 7), candle(hour * 8), candle(hour * 9)]
  // hour*9 candle closes at hour*10 = now → already closed, keep everything
  assert.equal(dropUnclosedCandles(data, '1H', now).length, 3)
  // one second before the close → the last candle is still in progress
  assert.deepEqual(dropUnclosedCandles(data, '1H', now - 1), data.slice(0, 2))
  // unparseable bar disables the filter
  assert.equal(dropUnclosedCandles(data, '1M', now - 1).length, 3)
  // empty input stays empty
  assert.deepEqual(dropUnclosedCandles([], '1H', now), [])
})

test('normalizes raw OKX candles to [open, close, low, high, volume]', () => {
  // Raw: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
  const raw = [['1700000000000', '100', '110', '90', '105', '1234', '0', '0', '1']]
  assert.deepEqual(normalizeOkxCandles(raw), [['100', '105', '90', '110', '1234']])
  assert.deepEqual(normalizeOkxCandles([]), [])
})

test('derives valid second targets even when a swing target is farther than 2R', () => {
  const short = buildAutoPlanPrices('short', 100, 105, 80)
  assert.ok(short.takeProfit2 < short.takeProfit1)
  assert.doesNotThrow(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'short', ...short, equity: 10_000, leverage: 2,
  }))

  const long = buildAutoPlanPrices('long', 100, 95, 120)
  assert.ok(long.takeProfit2 > long.takeProfit1)
  assert.doesNotThrow(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', ...long, equity: 10_000, leverage: 2,
  }))
})

test('lifts the first target to at least 2R when the swing target is closer', () => {
  // 5 risk; a swing target 2 away would be a 0.4R payoff — lift it to 2R.
  const short = buildAutoPlanPrices('short', 100, 105, 98)
  assert.equal(short.takeProfit1, 90)
  assert.equal(short.takeProfit2, 85)
  const long = buildAutoPlanPrices('long', 100, 95, 102)
  assert.equal(long.takeProfit1, 110)
  assert.equal(long.takeProfit2, 115)
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

test('parses naive Freqtrade timestamps as UTC, not local time', () => {
  const expected = Date.UTC(2026, 7, 31, 0, 42, 32)
  assert.equal(toTimestamp('2026-08-31T00:42:32'), expected)
  assert.equal(toTimestamp('2026-08-31T00:42:32.123456'), expected + 123)
  // Explicit designators are honored as-is.
  assert.equal(toTimestamp('2026-08-31T00:42:32Z'), expected)
  assert.equal(toTimestamp('2026-08-31T08:42:32+08:00'), expected)
  // Numeric epoch seconds / milliseconds still work.
  assert.equal(toTimestamp(1788136952), 1788136952000)
  assert.equal(toTimestamp(1788136952000), 1788136952000)
  assert.equal(toTimestamp('not a date'), undefined)
  assert.equal(toTimestamp(undefined), undefined)
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

test('plan hard stop sits beyond the plan stop and never below the floor', () => {
  // 2% price stop distance at 2x leverage => 4% margin × 1.2 buffer = 4.8%
  const plan = { entryPrice: 100, stopPrice: 98, leverage: 2 }
  assert.equal(planHardStopRatio(plan), 0.02 * 2 * 1.2)
  // actualEntryPrice takes precedence when known
  assert.equal(planHardStopRatio({ ...plan, actualEntryPrice: 200, stopPrice: 196 }), 0.02 * 2 * 1.2)
  // Extremely tight stop falls back to the 3% floor
  assert.equal(planHardStopRatio({ entryPrice: 100, stopPrice: 99.5, leverage: 1 }), 0.03)
  // Missing/invalid data also falls back to the floor
  assert.equal(planHardStopRatio({ entryPrice: 0, stopPrice: 98, leverage: 2 }), 0.03)
  assert.equal(planHardStopRatio({ entryPrice: 100, stopPrice: 100, leverage: 2 }), 0.03)
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

test('terminal plans do not block the source key for the next signal', () => {
  const now = Date.now()
  const make = (status: string, extra: Record<string, unknown> = {}) => ({ sourceKey: 't:BTC:1h', status, updatedAt: now, ...extra } as any)
  assert.equal(isSourceKeyBlocked([make('open')], 't:BTC:1h', now), true)
  assert.equal(isSourceKeyBlocked([make('approved')], 't:BTC:1h', now), true)
  assert.equal(isSourceKeyBlocked([make('submitting')], 't:BTC:1h', now), true)
  assert.equal(isSourceKeyBlocked([make('pending')], 't:BTC:1h', now), true)
  assert.equal(isSourceKeyBlocked([make('closed')], 't:BTC:1h', now), false)
  assert.equal(isSourceKeyBlocked([make('submit_failed', { updatedAt: now - 31 * 60_000 })], 't:BTC:1h', now), false)
  assert.equal(isSourceKeyBlocked([make('rejected')], 't:BTC:1h', now), false)
  assert.equal(isSourceKeyBlocked([make('closed')], 't:ETH:1h', now), false)
})

test('submit_failed blocks re-creation while retrying or inside the cooldown', () => {
  const now = Date.now()
  const make = (extra: Record<string, unknown> = {}) => ({ sourceKey: 't:BTC:1h', status: 'submit_failed', updatedAt: now - 5 * 60_000, ...extra } as any)
  // A retry is still scheduled — the original plan may yet become open.
  assert.equal(isSourceKeyBlocked([make({ nextRetryAt: now + 15_000 })], 't:BTC:1h', now), true)
  // Retries exhausted but the failure is recent — stay inside the cooldown.
  assert.equal(isSourceKeyBlocked([make()], 't:BTC:1h', now), true)
  // Cooldown over and no retry pending — the next signal may create a plan.
  assert.equal(isSourceKeyBlocked([make({ updatedAt: now - 31 * 60_000 })], 't:BTC:1h', now), false)
  // A different source key is unaffected.
  assert.equal(isSourceKeyBlocked([make()], 't:ETH:1h', now), false)
})

test('sanitizeSignal keeps valid scanner signals and rejects malformed ones', () => {
  const valid = { timeframe: '1h', trendScore: 3, riskRewardTight: 2, trailingStopPercent: 1.5, strategyRecommendation: 'trend_long' }
  assert.deepEqual(sanitizeSignal(valid), valid)
  assert.equal(sanitizeSignal(undefined), undefined)
  assert.equal(sanitizeSignal(null), undefined)
  assert.equal(sanitizeSignal('1h'), undefined)
  assert.equal(sanitizeSignal({ ...valid, timeframe: '' }), undefined)
  assert.equal(sanitizeSignal({ ...valid, trendScore: 'x' }), undefined)
  assert.equal(sanitizeSignal({ ...valid, trailingStopPercent: Number.NaN }), undefined)
})

test('unfilled orphan trades are deleted, filled ones force-exited', () => {
  assert.equal(orphanCloseAction({ amount: 0 }), 'delete')
  assert.equal(orphanCloseAction({}), 'delete')
  assert.equal(orphanCloseAction({ amount: '0' }), 'delete')
  assert.equal(orphanCloseAction({ amount: 1250.5 }), 'forceexit')
})

test('orphan sweep skips tracked and in-flight trades', () => {
  const now = 1_000_000_000_000
  const old = now - 10 * 60_000
  const young = now - 60_000
  const statuses = [
    { trade_id: 1, pair: 'BTC/USDT:USDT', open_date_ts: old },   // tracked
    { trade_id: 2, pair: 'ETH/USDT:USDT', open_date_ts: old },   // orphan
    { trade_id: 3, pair: 'SOL/USDT:USDT', open_date_ts: young }, // in-flight grace
    { trade_id: 4, pair: 'XRP/USDT:USDT' },                      // no date => orphan
  ]
  const orphans = findOrphanTrades(statuses, new Set(['1']), now)
  assert.deepEqual(orphans.map(o => o.trade_id), [2, 4])
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

test('sizes a fixed-margin plan without requiring equity', () => {
  const plan = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 104, takeProfit2: 106, margin: 300, leverage: 2,
  })
  assert.equal(plan.margin, 300)
  assert.equal(plan.notional, 600)
  assert.equal(plan.maxLoss, 12)
  // The notional cap still applies to oversized margins.
  const capped = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 104, takeProfit2: 106, margin: 2000, leverage: 2,
  })
  assert.equal(capped.notional, 2_500)
  assert.equal(capped.margin, 1_250)
})

test('defaults leverage to the runtime trading settings and caps explicit values', () => {
  __setTradingSettingsForTest(undefined) // env-seeded defaults: fixedMargin 5, leverage 20, equity 100
  assert.deepEqual(getTradingSettings(), { fixedMargin: 5, leverage: 20, equity: 100 })
  const plan = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 104, takeProfit2: 106, margin: 5,
  })
  assert.equal(plan.leverage, 20)
  assert.equal(plan.notional, 100)
  assert.equal(plan.maxLoss, 2)
  // Settings updates apply to the next plan without a restart.
  __setTradingSettingsForTest({ fixedMargin: 7, leverage: 10, equity: 200 })
  const updated = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 104, takeProfit2: 106, margin: 7,
  })
  assert.equal(updated.leverage, 10)
  assert.equal(updated.notional, 70)
  // An explicit leverage above the setting is capped by the setting.
  assert.equal(calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 104, takeProfit2: 106, margin: 7, leverage: 20,
  }).leverage, 10)
  __setTradingSettingsForTest(undefined)
})

test('rejects stop distances beyond the default 8% cap', () => {
  assert.throws(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 91,
    takeProfit1: 118, takeProfit2: 127, margin: 300, leverage: 2,
  }), /at most 8\.0%/)
  assert.throws(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'short', entryPrice: 100, stopPrice: 109,
    takeProfit1: 82, takeProfit2: 73, margin: 300, leverage: 2,
  }), /at most 8\.0%/)
})

test('lowers leverage so wide stops still fire before liquidation', () => {
  // 5% stop distance: 10x already fits (cap 16x), 20x is lowered to 16x and
  // the swing stop price is left untouched.
  const input = {
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 95,
    takeProfit1: 110, takeProfit2: 120, margin: 5,
  }
  const kept = calculatePlan({ ...input, leverage: 10 })
  assert.equal(kept.leverage, 10)
  assert.equal(kept.maxLoss, 2.5)
  const lowered = calculatePlan({ ...input, leverage: 20 })
  assert.equal(lowered.leverage, 16)
  assert.equal(lowered.stopPrice, 95)
  assert.ok(Math.abs(lowered.maxLoss - 80 * 0.05) < 1e-9)
  // An 8% stop at 20x runs at 10x.
  const wide = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 92,
    takeProfit1: 116, takeProfit2: 124, margin: 5, leverage: 20,
  })
  assert.equal(wide.leverage, 10)
  assert.equal(wide.stopPrice, 92)
  // The leverage reduction also applies with a wider maxStopDistance override.
  const overridden = calculatePlan({ ...input, leverage: 20, maxStopDistance: 0.10 })
  assert.equal(overridden.leverage, 16)
})

test('honours per-plan maxStopDistance override', () => {
  // 6% distance passes the default 8% cap but is rejected by a 5% override.
  assert.throws(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 94,
    takeProfit1: 112, takeProfit2: 118, margin: 300, maxStopDistance: 0.05, leverage: 2,
  }), /at most 5\.0%/)
  // 9% distance (ATR mode on a volatile pair) is accepted with a 10% override.
  const plan = calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 91,
    takeProfit1: 118, takeProfit2: 127, margin: 300, maxStopDistance: 0.10, leverage: 2,
  })
  assert.equal(plan.maxLoss, 600 * 0.09)
  assert.throws(() => calculatePlan({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, stopPrice: 98,
    takeProfit1: 104, takeProfit2: 106, margin: 300, maxStopDistance: 0.5,
  }), /maxStopDistance must be between/)
})

test('pair-level dedupe blocks new plans while any plan for the pair is alive', () => {
  const make = (pair: string, status: string) => ({ pair, status } as any)
  assert.equal(isPairBlocked([make('BTC/USDT:USDT', 'open')], 'BTC/USDT:USDT'), true)
  assert.equal(isPairBlocked([make('BTC/USDT:USDT', 'approved')], 'BTC/USDT:USDT'), true)
  assert.equal(isPairBlocked([make('BTC/USDT:USDT', 'submitting')], 'BTC/USDT:USDT'), true)
  assert.equal(isPairBlocked([make('BTC/USDT:USDT', 'pending')], 'BTC/USDT:USDT'), true)
  // Terminal plans free the pair for the next signal.
  assert.equal(isPairBlocked([make('BTC/USDT:USDT', 'closed')], 'BTC/USDT:USDT'), false)
  assert.equal(isPairBlocked([make('BTC/USDT:USDT', 'submit_failed')], 'BTC/USDT:USDT'), false)
  assert.equal(isPairBlocked([make('BTC/USDT:USDT', 'rejected')], 'BTC/USDT:USDT'), false)
  // A different pair is unaffected.
  assert.equal(isPairBlocked([make('ETH/USDT:USDT', 'open')], 'BTC/USDT:USDT'), false)
  assert.equal(isPairBlocked([], 'BTC/USDT:USDT'), false)
  // Shadow plans occupy no real position — they never block a real plan.
  assert.equal(isPairBlocked([{ pair: 'BTC/USDT:USDT', status: 'open', shadow: true } as any], 'BTC/USDT:USDT'), false)
})

test('shadow plans simulate their own stop and take-profit exits', () => {
  const now = 1_000_000_000_000
  const makePlan = (extra: Record<string, unknown> = {}) => ({
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, actualEntryPrice: 100,
    stopPrice: 96, takeProfit1: 108, takeProfit2: 116, leverage: 10, margin: 5,
    status: 'open', shadow: true, createdAt: now, ...extra,
  }) as any
  // Price between stop and target: still open, live PnL tracked.
  const floating = makePlan()
  assert.equal(updateShadowPlan(floating, 97, now), false)
  assert.equal(floating.status, 'open')
  assert.ok(Math.abs(floating.currentProfit - -0.3) < 1e-9)
  assert.ok(Math.abs(floating.currentProfitAbs - -1.5) < 1e-9)
  // Stop hit: simulated fill at the stop level. (Rate exactly at the stop —
  // a deeper gap would trip the hard stop first, as in the real sync.)
  const stopped = makePlan()
  assert.equal(updateShadowPlan(stopped, 96, now), true)
  assert.equal(stopped.closeReason, 'plan_stoploss')
  assert.equal(stopped.exitRate, 96)
  assert.ok(Math.abs(stopped.realizedPnl - -2) < 1e-9)
  // Take-profit hit: simulated fill at the target level.
  const profited = makePlan()
  assert.equal(updateShadowPlan(profited, 110, now), true)
  assert.equal(profited.closeReason, 'plan_take_profit')
  assert.equal(profited.exitRate, 108)
  assert.ok(Math.abs(profited.realizedPnl - 4) < 1e-9)
  // Short side mirrors the math.
  const shorted = makePlan({ side: 'short', stopPrice: 104, takeProfit1: 92, takeProfit2: 84 })
  assert.equal(updateShadowPlan(shorted, 104, now), true)
  assert.equal(shorted.closeReason, 'plan_stoploss')
  assert.ok(Math.abs(shorted.realizedPnl - -2) < 1e-9)
  // A gap far beyond the stop trips the hard stop and settles at market.
  const gapped = makePlan()
  assert.equal(updateShadowPlan(gapped, 94, now), true)
  assert.equal(gapped.closeReason, 'plan_hard_stop')
  assert.equal(gapped.exitRate, 94)
  assert.ok(Math.abs(gapped.realizedPnl - -3) < 1e-9)
  // Invalid rates never close a plan.
  const untouched = makePlan()
  assert.equal(updateShadowPlan(untouched, 0, now), false)
  assert.equal(untouched.status, 'open')
})

test('shadow plans trail the peak and expire after the max age', () => {
  const now = 1_000_000_000_000
  const plan = {
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, actualEntryPrice: 100,
    stopPrice: 96, takeProfit1: 120, takeProfit2: 130, leverage: 10, margin: 5,
    status: 'open', shadow: true, createdAt: now,
    signal: { timeframe: '1H', trendScore: 80, riskRewardTight: 2, trailingStopPercent: 5, strategyRecommendation: 'trend_long' },
  } as any
  // Run up to 110: trailing stop arms at 104.5, still open.
  assert.equal(updateShadowPlan(plan, 110, now), false)
  assert.equal(plan.peakRate, 110)
  // Pull back below the trailing rate: simulated fill at the trailing level.
  assert.equal(updateShadowPlan(plan, 104, now), true)
  assert.equal(plan.closeReason, 'plan_trailing_stop')
  assert.equal(plan.exitRate, 104.5)
  assert.ok(Math.abs(plan.realizedPnl - 2.25) < 1e-9)
  // A plan that never hits a level expires at the max age, marked at market.
  const stale = {
    pair: 'BTC/USDT:USDT', side: 'long', entryPrice: 100, actualEntryPrice: 100,
    stopPrice: 96, takeProfit1: 120, takeProfit2: 130, leverage: 10, margin: 5,
    status: 'open', shadow: true, createdAt: now - 49 * 3_600_000,
  } as any
  assert.equal(updateShadowPlan(stale, 101, now), true)
  assert.equal(stale.closeReason, 'shadow_timeout')
  assert.equal(stale.exitRate, 101)
  assert.ok(Math.abs(stale.realizedPnl - 0.5) < 1e-9)
})

test('fails zombie plans stuck without a trade id past the grace period', () => {
  const now = Date.now()
  const stuck = { id: 'z1', status: 'submitting', updatedAt: now - 6 * 60_000 } as any
  const fresh = { id: 'z2', status: 'submitting', updatedAt: now - 60_000 } as any
  const tracked = { id: 'z3', status: 'open', tradeId: '7', updatedAt: now - 60 * 60_000 } as any
  const stuckOpen = { id: 'z4', status: 'open', updatedAt: now - 60 * 60_000 } as any
  assert.equal(failZombiePlans([stuck, fresh, tracked, stuckOpen], now), 2)
  assert.equal(stuck.status, 'submit_failed')
  assert.match(stuck.executionError, /no trade id/)
  assert.equal(stuck.nextRetryAt, undefined)
  assert.equal(fresh.status, 'submitting')
  assert.equal(tracked.status, 'open')
  assert.equal(stuckOpen.status, 'submit_failed')
})
