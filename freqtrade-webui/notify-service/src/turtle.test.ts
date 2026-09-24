import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TurtleSystem, DEFAULT_TURTLE_PARAMS } from './turtle.js'
import type { TurtleBar } from './types.js'

function bar(time: number, open: number, high: number, low: number, close: number): TurtleBar {
  return { time, open, high, low, close }
}

describe('TurtleSystem', () => {
  const params = { ...DEFAULT_TURTLE_PARAMS.S1 }
  const equity = 10000

  it('enters long on breakout above entry channel', () => {
    const system = new TurtleSystem(params, equity)
    // entryChannel = { high: 100, low: 80 }, exitChannel = { high: 95, low: 85 }
    // atr = 2
    const ctx = {
      entryChannel: { high: 100, low: 80 },
      exitChannel: { high: 95, low: 85 },
      atr: 2,
      isLast: false,
    }
    // bar.high > 100 → long entry
    const actions = system.onBar(bar(1, 99, 101, 98, 100), ctx)
    assert.equal(actions.length, 1)
    assert.equal(actions[0].kind, 'entry')
    assert.equal(actions[0].side, 'long')
    // Entry at max(open=99, channel.high=100) = 100
    assert.equal(actions[0].price, 100)
    assert.equal(actions[0].stopPrice, 100 - 2 * 2) // 2N stop = 96
  })

  it('enters short on breakout below entry channel', () => {
    const system = new TurtleSystem(params, equity)
    const ctx = {
      entryChannel: { high: 100, low: 80 },
      exitChannel: { high: 95, low: 85 },
      atr: 2,
      isLast: false,
    }
    // bar.low < 80 → short entry
    const actions = system.onBar(bar(1, 81, 82, 79, 80), ctx)
    assert.equal(actions.length, 1)
    assert.equal(actions[0].kind, 'entry')
    assert.equal(actions[0].side, 'short')
    assert.equal(actions[0].price, 80) // min(open=81, channel.low=80) = 80
    assert.equal(actions[0].stopPrice, 80 + 2 * 2) // 2N stop = 84
  })

  it('exits long on close below exit channel low', () => {
    const system = new TurtleSystem(params, equity)
    // Enter first
    const entryCtx = {
      entryChannel: { high: 100, low: 80 },
      exitChannel: { high: 95, low: 85 },
      atr: 2,
      isLast: false,
    }
    system.onBar(bar(1, 99, 101, 98, 100), entryCtx)
    // Price drifts up, stop stays at 96, but exit channel rises to 105
    // Now close < 105 (exit channel low) but low > 96 (stop)
    const exitCtx = {
      entryChannel: { high: 110, low: 90 },
      exitChannel: { high: 110, low: 105 },
      atr: 2,
      isLast: false,
    }
    const actions = system.onBar(bar(2, 106, 107, 104, 104), exitCtx)
    assert.equal(actions.length, 1)
    assert.equal(actions[0].kind, 'exit')
    assert.equal(actions[0].reason, 'channel_exit')
  })

  it('adds unit on 0.5N favorable move and ratchets stop', () => {
    const system = new TurtleSystem(params, equity)
    const ctx = {
      entryChannel: { high: 100, low: 80 },
      exitChannel: { high: 95, low: 85 },
      atr: 2,
      isLast: false,
    }
    // Enter at 100
    system.onBar(bar(1, 99, 101, 98, 100), ctx)
    // Add: bar.high >= 100 + 0.5*2 = 101
    const actions = system.onBar(bar(2, 100, 102, 99, 101), ctx)
    assert.equal(actions.length, 1)
    assert.equal(actions[0].kind, 'add')
    assert.equal(actions[0].units, 2)
    // Stop ratchets to 101 - 2*2 = 97 (new unit entry - 2N)
    assert.equal(actions[0].stopPrice, 97)
  })

  it('respects maxUnits limit', () => {
    const system = new TurtleSystem(params, equity)
    const ctx = {
      entryChannel: { high: 100, low: 80 },
      exitChannel: { high: 95, low: 85 },
      atr: 2,
      isLast: false,
    }
    // Enter + 3 adds (total 4 units)
    system.onBar(bar(1, 99, 101, 98, 100), ctx)
    system.onBar(bar(2, 100, 102, 99, 101), ctx)
    system.onBar(bar(3, 101, 103, 100, 102), ctx)
    system.onBar(bar(4, 102, 104, 101, 103), ctx)
    // 5th add should be rejected
    const actions = system.onBar(bar(5, 103, 105, 102, 104), ctx)
    assert.equal(actions.length, 0)
  })

  it('skip filter blocks entry after loss in same direction', () => {
    const paramsWithSkip = { ...params, skipLastLossFilter: true }
    const system = new TurtleSystem(paramsWithSkip, equity)
    const ctx = {
      entryChannel: { high: 100, low: 80 },
      exitChannel: { high: 95, low: 85 },
      atr: 2,
      isLast: false,
    }
    // Enter long
    system.onBar(bar(1, 99, 101, 98, 100), ctx)
    // Stop out at loss (stop = 96)
    system.onBar(bar(2, 97, 98, 95, 96), ctx)
    // Next long breakout should be skipped
    const actions = system.onBar(bar(3, 99, 101, 98, 100), ctx)
    assert.equal(actions.length, 0)
    // But short breakout should still work
    const shortActions = system.onBar(bar(4, 81, 82, 79, 80), ctx)
    assert.equal(shortActions.length, 1)
    assert.equal(shortActions[0].side, 'short')
  })

  it('forces close on isLast', () => {
    const system = new TurtleSystem(params, equity)
    const ctx = {
      entryChannel: { high: 100, low: 80 },
      exitChannel: { high: 95, low: 85 },
      atr: 2,
      isLast: false,
    }
    system.onBar(bar(1, 99, 101, 98, 100), ctx)
    const actions = system.onBar(bar(2, 100, 101, 99, 100), { ...ctx, isLast: true })
    assert.equal(actions.length, 1)
    assert.equal(actions[0].kind, 'exit')
    assert.equal(actions[0].reason, 'backtest_end')
  })
})
