import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TurtleTrade } from './types.js'

// Test the summary computation logic (extracted for testing)
function computeSummary(trades: TurtleTrade[], initialEquity: number) {
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
  const returnPct = initialEquity > 0 ? (totalPnl / initialEquity) * 100 : 0
  const tradeCount = trades.length
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const winRate = tradeCount > 0 ? (wins.length / tradeCount) * 100 : 0
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
  const avgWin = wins.length > 0 ? grossWin / wins.length : 0
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0

  let peak = initialEquity
  let maxDrawdown = 0
  let equity = initialEquity
  const sortedTrades = [...trades].sort((a, b) => a.exitTime - b.exitTime)
  for (const trade of sortedTrades) {
    equity += trade.pnl
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return { totalPnl, returnPct, tradeCount, winRate, profitFactor, maxDrawdown, avgWin, avgLoss }
}

function makeTrade(pnl: number, exitTime: number): TurtleTrade {
  return {
    pair: 'BTC-USDT-SWAP',
    system: 'S1',
    side: 'long',
    entryTime: exitTime - 3600000,
    entryAvgPrice: 100,
    exitTime,
    exitPrice: 100 + pnl,
    units: 1,
    unitEntries: [100],
    qty: 1,
    pnl,
    pnlPct: pnl,
    closeReason: 'channel_exit',
    bars: 10,
  }
}

describe('turtleBacktest summary', () => {
  it('computes summary correctly', () => {
    const trades = [
      makeTrade(100, 1000),
      makeTrade(-50, 2000),
      makeTrade(200, 3000),
    ]
    const summary = computeSummary(trades, 10000)
    assert.equal(summary.totalPnl, 250)
    assert.equal(summary.returnPct, 2.5)
    assert.equal(summary.tradeCount, 3)
    assert.equal(summary.winRate, (2 / 3) * 100)
    assert.equal(summary.profitFactor, 300 / 50)
    assert.equal(summary.avgWin, 150)
    assert.equal(summary.avgLoss, 50)
  })

  it('computes max drawdown correctly', () => {
    const trades = [
      makeTrade(100, 1000), // equity: 10100
      makeTrade(-200, 2000), // equity: 9900, dd=200
      makeTrade(50, 3000), // equity: 9950, dd=150
      makeTrade(300, 4000), // equity: 10250
    ]
    const summary = computeSummary(trades, 10000)
    assert.equal(summary.maxDrawdown, 200)
  })

  it('handles empty trades', () => {
    const summary = computeSummary([], 10000)
    assert.equal(summary.totalPnl, 0)
    assert.equal(summary.tradeCount, 0)
    assert.equal(summary.winRate, 0)
    assert.equal(summary.maxDrawdown, 0)
  })
})
