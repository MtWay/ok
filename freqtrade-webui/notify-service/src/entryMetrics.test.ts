import assert from 'node:assert/strict'
import { calculateEntryMetrics } from './entryMetrics.js'
import { calculateATR } from './shared/indicators.js'

// K 线布局：[open, close, low, high, volume]
function candle(open: number, close: number, low: number, high: number): string[] {
  return [open, close, low, high, 1].map(String)
}

// 1) ATR 必须是 Wilder 平滑（与前端 useTrendScore.ts / TA-Lib 一致），
//    而不是最近 14 根的简单平均
{
  // 28 根 K：前 26 根 TR=1，第 27 根 TR=15，第 28 根 TR=1
  const data: string[][] = []
  let price = 100
  for (let i = 0; i < 26; i++) {
    data.push(candle(price, price + 0.5, price - 0.5, price + 0.5))
    price += 0.5 // 收盘连续、无跳空，保证 TR = high - low = 1
  }
  const spikeOpen = price
  data.push(candle(spikeOpen, spikeOpen, spikeOpen, spikeOpen + 15)) // TR=15
  const last = spikeOpen
  data.push(candle(last, last + 0.5, last - 0.5, last + 0.5)) // TR=1

  const atr = calculateATR(data)
  // Wilder 递推：atr[25]=1 → atr[26]=(1*13+15)/14=2 → atr[27]=(2*13+1)/14=27/14
  const expected = 27 / 14
  assert.ok(Math.abs(atr[atr.length - 1] - expected) < 1e-9, `Wilder ATR expected ${expected}, got ${atr[atr.length - 1]}`)
  // 简单平均版本会算出 (12*1+15+1)/14 = 2，必须能区分开
  assert.ok(Math.abs(atr[atr.length - 1] - 2) > 0.01, 'ATR should not be a plain 14-period SMA')
}

// 2) pullbackAtr 衡量"当前价"相对窗口极值的回撤，而不是窗口内历史最大回撤
{
  // 上升趋势中曾经跌到 110，但当前价已反弹回 120（窗口最高 120）
  // 新口径：回撤 = (120 - 120) / ATR = 0；旧口径会误报 (120 - 110) / ATR ≈ 5
  const data: string[][] = []
  for (let i = 0; i < 10; i++) data.push(candle(100 + i, 101 + i, 99.5 + i, 101.5 + i)) // 爬到 110 附近
  data.push(candle(110, 109, 108.5, 120))   // 冲高到 120
  data.push(candle(109, 110, 108.5, 110.5))
  data.push(candle(110, 111, 108.5, 111.5)) // 下探 108.5
  for (let i = 0; i < 7; i++) data.push(candle(111 + i, 112 + i, 110.5 + i, 112.5 + i)) // 反弹
  data.push(candle(118, 120, 117.5, 120))   // 当前收在 120，回到窗口最高点

  const metrics = calculateEntryMetrics(data, 'long')
  assert.equal(metrics.pullbackAtr, 0, `price already recovered, pullback should be 0, got ${metrics.pullbackAtr}`)

  // 对照：当前价确实从高点回落时，回撤 = (最高 - 现价) / ATR
  const pulled = data.slice(0, -1).concat([candle(118, 116, 115.5, 118.5)])
  const atr = calculateATR(pulled)
  const expectedPullback = (120 - 116) / atr[atr.length - 1]
  const pulledMetrics = calculateEntryMetrics(pulled, 'long')
  assert.ok(Math.abs(pulledMetrics.pullbackAtr - expectedPullback) < 1e-9,
    `pullback expected ${expectedPullback}, got ${pulledMetrics.pullbackAtr}`)
}

console.log('entryMetrics regression tests passed')
