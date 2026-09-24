import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeOscillationScore, countAlternations, DEFAULT_OSCILLATION_PARAMS } from './oscillation.js'

function makeCandles(prices: number[]): string[][] {
  return prices.map(p => [
    p.toFixed(8),
    p.toFixed(8),
    p.toFixed(8),
    p.toFixed(8),
    '1000',
  ])
}

function makeCandlesOHLC(rows: Array<[number, number, number, number]>): string[][] {
  return rows.map(([o, c, l, h]) => [
    o.toFixed(8),
    c.toFixed(8),
    l.toFixed(8),
    h.toFixed(8),
    '1000',
  ])
}

describe('countAlternations', () => {
  it('counts alternating touches between upper and lower Donchian bands', () => {
    // donchianBars=5, so channel = max/min of prior 5 bars
    // Build a series where bars 5,6,7,8,9 alternate touching upper/lower
    // First 5 bars: prices 100-104 → upper=104, lower=100
    // bar 5: high=104 (touch upper)
    // bar 6: low=100 (touch lower) → alternation 1
    // bar 7: high=104 (touch upper) → alternation 2
    // bar 8: low=100 (touch lower) → alternation 3
    const candles = makeCandlesOHLC([
      [100, 100, 100, 100],
      [101, 101, 101, 101],
      [102, 102, 102, 102],
      [103, 103, 103, 103],
      [104, 104, 104, 104],
      // channel now: upper=104, lower=100
      [102, 102, 100, 102], // low touches lower
      [102, 102, 102, 104], // high touches upper → alt 1
      [102, 102, 100, 102], // low touches lower → alt 2
      [102, 102, 102, 104], // high touches upper → alt 3
    ])
    const result = countAlternations(candles, 5)
    assert.equal(result, 3)
  })

  it('returns 0 for monotonic series', () => {
    const candles = makeCandles([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])
    const result = countAlternations(candles, 3)
    assert.equal(result, 0)
  })
})

describe('computeOscillationScore', () => {
  const params = { ...DEFAULT_OSCILLATION_PARAMS, lookbackBars: 60 }

  it('returns null for insufficient data', () => {
    const candles = makeCandles(Array.from({ length: 10 }, (_, i) => 100 + i))
    const result = computeOscillationScore(candles, params)
    assert.equal(result, null)
  })

  it('scores monotonic trend low (low oscillation)', () => {
    // 61 bars of steady uptrend (need lookbackBars+1 for the function)
    const prices = Array.from({ length: 61 }, (_, i) => 100 + i * 2)
    const candles = makeCandles(prices)
    const result = computeOscillationScore(candles, params)
    assert.ok(result)
    assert.ok(result.total < 30, `trend should score low, got ${result.total}`)
    assert.ok(result.erScore < 30, `ER score should be low for trend, got ${result.erScore}`)
  })

  it('scores oscillating series high', () => {
    // 61 bars alternating up/down around 100
    const prices = Array.from({ length: 61 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5))
    const candles = makeCandles(prices)
    const result = computeOscillationScore(candles, params)
    assert.ok(result)
    assert.ok(result.total > 50, `oscillating should score high, got ${result.total}`)
  })

  it('ATR% component is mathematically correct', () => {
    // Construct candles where ATR is exactly known
    // 61 bars: all close=100, high=102, low=98 → TR = 4 for each bar after first
    // ATR(14) ≈ 4 (after warmup), atrPct = 4/100 * 100 = 4%
    const rows: Array<[number, number, number, number]> = []
    for (let i = 0; i < 61; i++) {
      rows.push([100, 100, 98, 102])
    }
    const candles = makeCandlesOHLC(rows)
    const result = computeOscillationScore(candles, params)
    assert.ok(result)
    // atrPct should be close to 4%
    assert.ok(Math.abs(result.atrPct - 4) < 0.5, `atrPct should be ~4, got ${result.atrPct}`)
  })
})
