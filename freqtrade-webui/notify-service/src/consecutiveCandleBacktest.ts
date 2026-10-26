/**
 * 单边连续（consecutive_candle）回测 —— 口径对齐实盘
 * （detectConsecutiveCandle + trading.ts exitReasonForPlan 的 cc 分支）：
 * - 入场：连续 consecutiveCount 根同向 K 线确认后按收盘价入场
 * - 出场：① 固定 stopAtrMult×ATR 止损与前一根 K 线 low/high 的较紧者
 *   （盘中触价，跳空按更不利的 open）② 连续中断（方向翻非同向）按收盘价退出
 * - 无固定止盈、无移动止损（与实盘一致）
 * - 仓位：1% 风险口径（riskAmount / 止损距离），手续费 0.05%×2
 *
 * 供筛选脚本（run-cc-select.ts）和白名单（cc-whitelist.ts）共用。
 */
import { calculateATR } from './shared/indicators.js'

// 与 turtleBacktest.ts 的 FEE_RATE 一致；就地定义以避免测试拖入
// candleCache/scanner → node-fetch 重依赖（进程不退出，见 turtleAutoCore.ts 注释）
const FEE_RATE = 0.0005

export interface CcBacktestParams {
  consecutiveCount: number
  atrPeriod: number
  stopAtrMult: number
}

/** 与实盘 position-tasks 里的单边连续任务参数一致 */
export const DEFAULT_CC_PARAMS: CcBacktestParams = { consecutiveCount: 5, atrPeriod: 14, stopAtrMult: 2 }

export interface CcTrade {
  pnl: number
  exitTime: number  // bar 下标
  side: 'long' | 'short'
  reason: 'stop' | 'streak_end' | 'backtest_end'
}

export function backtestConsecutiveCandle(
  candles: string[][],
  params: CcBacktestParams = DEFAULT_CC_PARAMS,
  subEquity = 1000,
): CcTrade[] {
  const atrArr = calculateATR(candles, params.atrPeriod)
  const trades: CcTrade[] = []
  let pos: { side: 'long' | 'short'; entry: number; stop: number; qty: number } | null = null

  const streakAt = (i: number): 'bullish' | 'bearish' | 'none' => {
    let bull = 0, bear = 0
    for (let k = i; k >= 0; k--) {
      const o = Number(candles[k][0]), c = Number(candles[k][1])
      if (c > o) { if (bear > 0) break; bull++ }
      else if (c < o) { if (bull > 0) break; bear++ }
      else break
    }
    return bull >= params.consecutiveCount ? 'bullish' : bear >= params.consecutiveCount ? 'bearish' : 'none'
  }

  const close = (i: number, price: number, reason: CcTrade['reason']) => {
    if (!pos) return
    const gross = pos.side === 'long' ? (price - pos.entry) * pos.qty : (pos.entry - price) * pos.qty
    const fee = pos.entry * pos.qty * FEE_RATE * 2
    trades.push({ pnl: gross - fee, exitTime: i, side: pos.side, reason })
    pos = null
  }

  for (let i = params.atrPeriod + 1; i < candles.length; i++) {
    const o = Number(candles[i][0]), c = Number(candles[i][1])
    const l = Number(candles[i][2]), h = Number(candles[i][3])

    if (pos) {
      // 止损：固定 ATR 止损与前一根 K 线极值的较紧者（实盘 previousCandleStopPrice）
      const prevL = Number(candles[i - 1][2]), prevH = Number(candles[i - 1][3])
      const stop = pos.side === 'long' ? Math.max(pos.stop, prevL) : Math.min(pos.stop, prevH)
      if (pos.side === 'long' && l <= stop) { close(i, Math.min(o, stop), 'stop'); continue }
      if (pos.side === 'short' && h >= stop) { close(i, Math.max(o, stop), 'stop'); continue }
      // 连续中断 → 收盘退出（cc_state_exit）
      const streak = streakAt(i)
      if (pos.side === 'long' && streak !== 'bullish') { close(i, c, 'streak_end'); continue }
      if (pos.side === 'short' && streak !== 'bearish') { close(i, c, 'streak_end'); continue }
      continue
    }

    // 空仓：streak 确认后按收盘价入场
    const streak = streakAt(i)
    if (streak === 'none') continue
    const atr = atrArr[i - 1] ?? atrArr[0]
    if (!Number.isFinite(atr) || atr <= 0) continue
    const stopDistance = params.stopAtrMult * atr
    const qty = (subEquity * 0.01) / stopDistance
    pos = streak === 'bullish'
      ? { side: 'long', entry: c, stop: c - stopDistance, qty }
      : { side: 'short', entry: c, stop: c + stopDistance, qty }
  }
  if (pos) close(candles.length - 1, Number(candles[candles.length - 1][1]), 'backtest_end')
  return trades
}
