/**
 * 双向布林均值回归回测引擎。
 *
 * 语义镜像 position-signals.ts 的 detectBollinger，并按讨论结论扩展为双向
 * （见 品种策略匹配讨论记录.md）：
 *
 * - 多头：low 触及下轨 → 以下轨价买入；close 回到中轨 → 离场
 * - 空头：high 触及上轨 → 以上轨价做空；close 回到中轨 → 离场
 * - 止损：stopLossPct 固定百分比，或入场价 ∓ 2×ATR(14)（与 detectBollinger 一致）
 * - reverseOnOppositeBand=false（默认）：持多碰上轨不反手，仅继续持仓
 * - minBandwidthPct：带宽（(upper-lower)/middle %）低于下限不入场——薄利
 *   策略的生死线（网格 minStepPercent 同款教训）
 * - erThreshold：Kaufman ER（窗口起点前的数据，不含当根）超过阈值判定单边，
 *   禁止入场（趋势保护；用 ER 而非 ADX，复用 trendQuality.ts）
 * - slippagePct：成交价向不利方向偏移（买入更高/卖出更低），用于敏感性分析
 *
 * 手续费与 turtleBacktest.ts 对齐：名义价值 × 0.0005 × 双边。
 * K 线布局：[open, close, low, high, volume]，oldest → newest。
 */

import { calculateATR } from './shared/indicators.js'
import { computeBollingerBands } from './position-indicators.js'
import { calculateKaufmanER } from './trendQuality.js'

export const BOLLINGER_FEE_RATE = 0.0005

export interface BollingerBacktestParams {
  period: number              // 布林周期，默认 20
  stdDev: number              // 标准差倍数，默认 2
  stopLossPct?: number        // 固定百分比止损；缺省用 2×ATR
  reverseOnOppositeBand?: boolean  // 触及对侧轨道时反手（默认 false=只平不反）
  minBandwidthPct?: number    // 带宽下限（%），默认 0=关闭
  erThreshold?: number        // ER 上限，超过禁入，默认 0=关闭
  erLookback?: number         // ER 窗口，默认 20
  slippagePct?: number        // 滑点（%），默认 0
  riskPct?: number            // 每笔风险占权益 %，默认 1
}

export const DEFAULT_BOLLINGER_BACKTEST_PARAMS: BollingerBacktestParams = {
  period: 20,
  stdDev: 2,
  reverseOnOppositeBand: false,
  minBandwidthPct: 0,
  erThreshold: 0,
  erLookback: 20,
  slippagePct: 0,
  riskPct: 1,
}

export interface BollingerTrade {
  pair: string
  side: 'long' | 'short'
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  qty: number
  pnl: number
  pnlPct: number
  closeReason: 'middle' | 'stop_loss' | 'reverse' | 'backtest_end'
  bars: number
}

interface BollPosition {
  side: 'long' | 'short'
  entryPrice: number
  entryTime: number
  entryIdx: number
  qty: number
  stopPrice: number
}

export function backtestBollingerPair(
  pair: string,
  candles: string[][],
  timestamps: number[],
  params: Partial<BollingerBacktestParams>,
  subEquity: number,
): { trades: BollingerTrade[]; finalEquity: number } {
  const p: BollingerBacktestParams = { ...DEFAULT_BOLLINGER_BACKTEST_PARAMS, ...params }
  const trades: BollingerTrade[] = []
  let equity = subEquity
  // 状态对象而非裸 let：pos 在闭包内被改写，裸 let 会被 TS 收窄成 never
  const st: { pos: BollPosition | null } = { pos: null }

  const atrSeries = calculateATR(candles, 14)
  const slip = (p.slippagePct ?? 0) / 100
  const buyAt = (price: number) => price * (1 + slip)
  const sellAt = (price: number) => price * (1 - slip)

  const closeTrade = (i: number, rawPrice: number, reason: BollingerTrade['closeReason']) => {
    const pos = st.pos
    if (!pos) return
    const exitPrice = pos.side === 'long' ? sellAt(rawPrice) : buyAt(rawPrice)
    const gross = pos.side === 'long'
      ? (exitPrice - pos.entryPrice) * pos.qty
      : (pos.entryPrice - exitPrice) * pos.qty
    const fee = pos.entryPrice * pos.qty * BOLLINGER_FEE_RATE * 2
    const pnl = gross - fee
    equity += pnl
    trades.push({
      pair,
      side: pos.side,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime: timestamps[i],
      exitPrice,
      qty: pos.qty,
      pnl,
      pnlPct: subEquity > 0 ? (pnl / subEquity) * 100 : 0,
      closeReason: reason,
      bars: i - pos.entryIdx,
    })
    st.pos = null
  }

  const tryEnter = (i: number, side: 'long' | 'short', rawPrice: number) => {
    const entryPrice = side === 'long' ? buyAt(rawPrice) : sellAt(rawPrice)
    const atr = atrSeries[i - 1] ?? atrSeries[i] ?? entryPrice * 0.02
    const stopPrice = p.stopLossPct
      ? (side === 'long' ? entryPrice * (1 - p.stopLossPct / 100) : entryPrice * (1 + p.stopLossPct / 100))
      : (side === 'long' ? entryPrice - 2 * atr : entryPrice + 2 * atr)
    const riskDistance = Math.abs(entryPrice - stopPrice)
    if (riskDistance <= 0) return
    const riskAmount = ((p.riskPct ?? 1) / 100) * equity
    const qty = riskAmount / riskDistance
    if (qty <= 0) return
    st.pos = { side, entryPrice, entryTime: timestamps[i], entryIdx: i, qty, stopPrice }
  }

  for (let i = 1; i < candles.length; i++) {
    const isLast = i === candles.length - 1
    const open = parseFloat(candles[i][0])
    const close = parseFloat(candles[i][1])
    const low = parseFloat(candles[i][2])
    const high = parseFloat(candles[i][3])

    // 轨道用前 N 根（不含当根），与 computeBollingerBands 的实盘口径一致
    const bands = computeBollingerBands(candles, p.period, p.stdDev, i)

    if (isLast && st.pos) {
      closeTrade(i, close, 'backtest_end')
      continue
    }

    if (st.pos) {
      const pos = st.pos
      // 保守顺序：同根 K 线先判止损（与海龟回测一致，跳空按更不利的 open）
      if (pos.side === 'long' && low <= pos.stopPrice) {
        closeTrade(i, Math.min(open, pos.stopPrice), 'stop_loss')
        continue
      }
      if (pos.side === 'short' && high >= pos.stopPrice) {
        closeTrade(i, Math.max(open, pos.stopPrice), 'stop_loss')
        continue
      }
      if (!bands) continue
      // 回归中轨离场（收盘口径，与 detectBollinger 一致）
      if (pos.side === 'long' && close >= bands.middle) {
        closeTrade(i, close, 'middle')
        continue
      }
      if (pos.side === 'short' && close <= bands.middle) {
        closeTrade(i, close, 'middle')
        continue
      }
      // 触及对侧轨道：默认只平不反；reverseOnOppositeBand 开时反手
      if (p.reverseOnOppositeBand) {
        if (pos.side === 'long' && high >= bands.upper) {
          closeTrade(i, bands.upper, 'reverse')
          tryEnter(i, 'short', bands.upper)
        } else if (pos.side === 'short' && low <= bands.lower) {
          closeTrade(i, bands.lower, 'reverse')
          tryEnter(i, 'long', bands.lower)
        }
      }
      continue
    }

    // 空仓：过滤器 + 入场
    if (!bands || bands.middle <= 0) continue
    if (p.minBandwidthPct && p.minBandwidthPct > 0) {
      const bandwidthPct = ((bands.upper - bands.lower) / bands.middle) * 100
      if (bandwidthPct < p.minBandwidthPct) continue
    }
    if (p.erThreshold && p.erThreshold > 0) {
      // ER 用当根之前的数据（slice 不含 i），避免用当根收盘判断当根入场
      const er = calculateKaufmanER(candles.slice(0, i), p.erLookback ?? 20)
      if (er > p.erThreshold) continue
    }
    // 同根同时触上下轨的极端情况：按与 open 的距离选近侧，避免随意偏向
    const touchLong = low <= bands.lower
    const touchShort = high >= bands.upper
    if (touchLong && touchShort) {
      if (open - bands.lower <= bands.upper - open) tryEnter(i, 'long', bands.lower)
      else tryEnter(i, 'short', bands.upper)
    } else if (touchLong) {
      tryEnter(i, 'long', bands.lower)
    } else if (touchShort) {
      tryEnter(i, 'short', bands.upper)
    }
  }

  return { trades, finalEquity: equity }
}
