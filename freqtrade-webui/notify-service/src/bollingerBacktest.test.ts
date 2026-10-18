import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { backtestBollingerPair } from './bollingerBacktest.js'
import { computeBollingerBands } from './position-indicators.js'

// K 线布局：[open, close, low, high, volume]
function mkCandle(i: number, open: number, close: number, low: number, high: number): string[] {
  return [String(open), String(close), String(low), String(high), '0']
}

/**
 * 构造交替收盘 101/99 的序列：任意 20 根窗口 mean=100, sd=1，
 * 轨道恒为 lower=98 / middle=100 / upper=102。high/low=close±0.2 不触轨。
 */
function alternatingCandles(n: number): { candles: string[][]; timestamps: number[] } {
  const candles: string[][] = []
  const timestamps: number[] = []
  for (let i = 0; i < n; i++) {
    const close = i % 2 === 0 ? 101 : 99
    const open = i === 0 ? 100 : (i % 2 === 0 ? 99 : 101)
    candles.push(mkCandle(i, open, close, close - 0.2, close + 0.2))
    timestamps.push(i * 3_600_000)
  }
  return { candles, timestamps }
}

const PARAMS = { period: 20, stdDev: 2, stopLossPct: 5 }

describe('backtestBollingerPair', () => {
  it('交替序列不触轨 → 无交易', () => {
    const { candles, timestamps } = alternatingCandles(30)
    const { trades } = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, PARAMS, 1000)
    assert.equal(trades.length, 0)
  })

  it('low 触及下轨 → 以下轨价开多，收盘回中轨离场', () => {
    const { candles, timestamps } = alternatingCandles(30)
    // bar 25: 低点刺破下轨 98，但收盘保持 99（不回中轨，当场不离场）
    candles[25] = mkCandle(25, 101, 99, 97.5, 101.2)
    const bands = computeBollingerBands(candles, 20, 2, 25)!
    assert.ok(Math.abs(bands.lower - 98) < 1e-9, `lower 应为 98，实际 ${bands.lower}`)

    const { trades } = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, PARAMS, 1000)
    assert.equal(trades.length, 1)
    const t = trades[0]
    assert.equal(t.side, 'long')
    assert.equal(t.entryPrice, 98)
    assert.equal(t.closeReason, 'middle')
    // bar 26 收盘 101 >= 中轨 100 → 以 101 离场
    assert.equal(t.exitPrice, 101)
    // qty = 1%×1000 / (98 - 98×0.95) = 10 / 4.9
    const qty = 10 / 4.9
    const expectedPnl = (101 - 98) * qty - 98 * qty * 0.0005 * 2
    assert.ok(Math.abs(t.pnl - expectedPnl) < 1e-9, `pnl ${t.pnl} != ${expectedPnl}`)
    assert.ok(t.pnl > 0)
  })

  it('high 触及上轨 → 以上轨价开空，收盘回中轨离场', () => {
    const { candles, timestamps } = alternatingCandles(30)
    candles[25] = mkCandle(25, 101, 101, 100.8, 102.5) // 刺破上轨 102
    candles[26] = mkCandle(26, 101, 99, 98.8, 101.2)  // 收盘 99 <= 中轨 → 离场
    const { trades } = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, PARAMS, 1000)
    assert.equal(trades.length, 1)
    const t = trades[0]
    assert.equal(t.side, 'short')
    assert.equal(t.entryPrice, 102)
    assert.equal(t.closeReason, 'middle')
    assert.equal(t.exitPrice, 99)
    const qty = 10 / (102 * 1.05 - 102)
    const expectedPnl = (102 - 99) * qty - 102 * qty * 0.0005 * 2
    assert.ok(Math.abs(t.pnl - expectedPnl) < 1e-9)
  })

  it('持仓中低点破止损 → 按 min(open, stop) 止损离场', () => {
    const { candles, timestamps } = alternatingCandles(30)
    candles[25] = mkCandle(25, 101, 99, 97.5, 101.2) // 开多 @98，止损 93.1
    candles[26] = mkCandle(26, 95, 96, 93, 96.5)     // low 93 <= 93.1 → min(95, 93.1)=93.1
    const { trades } = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, PARAMS, 1000)
    assert.equal(trades.length, 1)
    const t = trades[0]
    assert.equal(t.closeReason, 'stop_loss')
    assert.ok(Math.abs(t.exitPrice - 93.1) < 1e-9, `exit ${t.exitPrice}`)
    assert.ok(t.pnl < 0)
  })

  it('滑点使成交价向不利方向偏移', () => {
    const { candles, timestamps } = alternatingCandles(30)
    candles[25] = mkCandle(25, 101, 99, 97.5, 101.2)
    const { trades } = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, { ...PARAMS, slippagePct: 0.1 }, 1000)
    assert.equal(trades.length, 1)
    const t = trades[0]
    assert.ok(Math.abs(t.entryPrice - 98 * 1.001) < 1e-9)
    assert.ok(Math.abs(t.exitPrice - 101 * 0.999) < 1e-9)
  })

  it('带宽下限：minBandwidthPct 高于实际带宽时禁入', () => {
    // 交替序列带宽 = (102-98)/100 = 4%
    const { candles, timestamps } = alternatingCandles(30)
    candles[25] = mkCandle(25, 101, 99, 97.5, 101.2)
    const blocked = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, { ...PARAMS, minBandwidthPct: 5 }, 1000)
    assert.equal(blocked.trades.length, 0)
    const allowed = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, { ...PARAMS, minBandwidthPct: 3 }, 1000)
    assert.equal(allowed.trades.length, 1)
  })

  it('ER 趋势保护：单边上行中触及下轨，高 ER 禁入、关闭过滤则入场', () => {
    // 稳步上行：每根 +0.2，ER(20)≈1；窗口 sd 使下轨≈当前价-6.3，
    // bar 25 的低点 100.5 足以刺破下轨（无过滤时会入场）
    const candles: string[][] = []
    const timestamps: number[] = []
    for (let i = 0; i < 30; i++) {
      const close = 100 + i * 0.2
      candles.push(mkCandle(i, close - 0.2, close, close - 0.3, close + 0.1))
      timestamps.push(i * 3_600_000)
    }
    const bands = computeBollingerBands(candles, 20, 2, 25)!
    candles[25] = mkCandle(25, 104.8, 105, bands.lower - 0.1, 105.1)

    const blocked = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, { ...PARAMS, erThreshold: 0.3 }, 1000)
    assert.equal(blocked.trades.length, 0)
    const allowed = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, PARAMS, 1000)
    assert.ok(allowed.trades.length >= 1)
    assert.equal(allowed.trades[0].side, 'long')
  })

  it('reverseOnOppositeBand=false（默认）持多碰上轨不反手', () => {
    const { candles, timestamps } = alternatingCandles(27)
    candles[25] = mkCandle(25, 101, 99, 97.5, 101.2)  // 开多 @98
    candles[26] = mkCandle(26, 99, 99.5, 98.8, 102.5) // 最后一根：高点碰上轨
    const { trades } = backtestBollingerPair('T-USDT-SWAP', candles, timestamps, PARAMS, 1000)
    assert.equal(trades.length, 1)
    assert.equal(trades[0].closeReason, 'backtest_end') // 不反手、不在上轨离场
    assert.equal(trades[0].side, 'long')
  })

  it('reverseOnOppositeBand=true 持多碰上轨 → 平多反手开空', () => {
    const { candles, timestamps } = alternatingCandles(28)
    candles[25] = mkCandle(25, 101, 99, 97.5, 101.2)  // 开多 @98
    candles[26] = mkCandle(26, 99, 99.5, 98.8, 102.5) // 碰上轨 → 平多 + 开空 @102
    const { trades } = backtestBollingerPair('T-USDT-SWAP', candles, timestamps,
      { ...PARAMS, reverseOnOppositeBand: true }, 1000)
    assert.equal(trades.length, 2)
    assert.equal(trades[0].side, 'long')
    assert.equal(trades[0].closeReason, 'reverse')
    assert.equal(trades[0].exitPrice, 102)
    assert.equal(trades[1].side, 'short')
    assert.equal(trades[1].entryPrice, 102)
    assert.equal(trades[1].closeReason, 'backtest_end')
  })
})
