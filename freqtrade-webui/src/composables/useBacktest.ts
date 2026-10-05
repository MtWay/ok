import { ref } from 'vue'
import type { BacktestEvalEntry, BacktestResult, Trade } from '../types'
import { resolveCost, fillFee, fundingAccrual, barMsFromDates } from './useExecutionCost'
import { calculateATR } from './useStrategyEngines'

// ADX 延迟确认门槛，数值来自 freqtrade_userdir/adx_sweep.py 的扫描
export const DEFAULT_ADX_THRESHOLD = 12
export const DEFAULT_ADX_CONFIRM_BARS = 24

export function useBacktest() {
  const result = ref<BacktestResult | null>(null)

  // 计算移动平均线 - 与原始 HTML 保持一致，返回字符串数组
  function calculateMA(data: string[][], period: number): string[] {
    const result: string[] = []
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push('-')
        continue
      }
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += parseFloat(data[i - j][1])
      }
      result.push((sum / period).toFixed(8))
    }
    return result
  }

  // 计算 ADX - Wilder 平滑，与 talib.ADX 对齐
  function calculateADX(data: string[][], period: number): number[] {
    const adx: number[] = new Array(data.length).fill(NaN)
    if (data.length <= period) return adx

    const tr: number[] = []
    const dmPlus: number[] = []
    const dmMinus: number[] = []

    for (let i = 1; i < data.length; i++) {
      const high = parseFloat(data[i][3])
      const low = parseFloat(data[i][2])
      const prevHigh = parseFloat(data[i - 1][3])
      const prevLow = parseFloat(data[i - 1][2])
      const prevClose = parseFloat(data[i - 1][1])

      const upMove = high - prevHigh
      const downMove = prevLow - low

      tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
      dmPlus.push(upMove > downMove ? Math.max(upMove, 0) : 0)
      dmMinus.push(downMove > upMove ? Math.max(downMove, 0) : 0)
    }

    // Wilder 平滑：首值取简单和，之后 prev - prev/period + cur
    const smooth = (arr: number[]): number[] => {
      const out: number[] = new Array(arr.length).fill(NaN)
      let sum = 0
      for (let i = 0; i < period; i++) sum += arr[i]
      out[period - 1] = sum
      for (let i = period; i < arr.length; i++) {
        out[i] = out[i - 1] - out[i - 1] / period + arr[i]
      }
      return out
    }

    const trS = smooth(tr)
    const dmpS = smooth(dmPlus)
    const dmmS = smooth(dmMinus)

    // DX 序列（偏移 1：tr[0] 对应 data[1]）
    const dx: number[] = new Array(tr.length).fill(NaN)
    for (let i = 0; i < dx.length; i++) {
      if (isNaN(trS[i]) || trS[i] === 0) continue
      dx[i] = Math.abs(dmpS[i] - dmmS[i]) / trS[i] * 100
    }

    // ADX = DX 的 Wilder 平滑，起点为 period-1 + (period-1)
    let firstAdxIdx = -1
    for (let i = 0; i < dx.length; i++) {
      if (!isNaN(dx[i])) { firstAdxIdx = i; break }
    }
    if (firstAdxIdx === -1) return adx

    // 首个 ADX 取前 period 个 DX 的均值（talib 约定），不是整段求和
    let sum = 0
    for (let i = firstAdxIdx; i < firstAdxIdx + period; i++) {
      if (i >= dx.length || isNaN(dx[i])) return adx
      sum += dx[i]
    }

    const adxStart = firstAdxIdx + period - 1
    let prev = sum / period
    adx[adxStart + 1] = prev
    for (let i = adxStart + 1; i < dx.length; i++) {
      if (isNaN(dx[i])) break
      prev = prev - prev / period + dx[i] / period
      adx[i + 1] = prev
    }

    return adx
  }

  // 运行回测
  // ADX 在快慢线交叉当根处于结构性低谷（实测中位数约 8），直接用
  // cross & adx > threshold 会让策略几乎不开仓。改为交叉后最多等待
  // adxConfirmBars 根，期间首次 ADX > adxThreshold 才入场。adxThreshold 为
  // null 时不做 ADX 过滤。默认值来自 offline_backtest.py 的扫描。
  function runBacktestWithParams(
    dates: string[],
    data: string[][],
    maFast: number,
    maSlow: number,
    stopLoss: number,
    takeProfit: number,
    initialCapital: number,
    stakeAmount: number,
    enableShort: boolean,
    reverseSignals = false,
    adxThreshold: number | null = DEFAULT_ADX_THRESHOLD,
    adxConfirmBars = DEFAULT_ADX_CONFIRM_BARS,
    pair = ''
  ): BacktestResult {
    const maFastValues = calculateMA(data, maFast)
    const maSlowValues = calculateMA(data, maSlow)
    const adxValues = adxThreshold === null ? null : calculateADX(data, 14)
    const gated = adxThreshold !== null
    const adxOk = (i: number) => {
      if (!gated || !adxValues) return true
      const v = adxValues[i]
      return !isNaN(v) && v > (adxThreshold as number)
    }

    let capital = initialCapital
    let position = 0 // 0: 空仓, 1: 多仓, -1: 空仓
    let entryPrice = 0
    let entryIndex = 0
    let stopPrice = 0  // ATR 动态止损价格
    let pending: { dir: 1 | -1; expiry: number } | null = null
    const cost = resolveCost(pair)
    const barMs = barMsFromDates(dates)
    let totalFee = 0
    let totalFunding = 0
    let fundingCum = 0
    const trades: Trade[] = []
    const equityCurve: number[] = [initialCapital]
    const evaluationLog: BacktestEvalEntry[] = []
    // ATR 用于动态止损，与实盘一致
    const atrValues = calculateATR(data, 14)

    for (let i = 1; i < data.length; i++) {
      const close = parseFloat(data[i][1])
      const h = parseFloat(data[i][3])
      const l = parseFloat(data[i][2])
      const atr = atrValues[i] ?? close * 0.02
      const prevFast = parseFloat(maFastValues[i - 1])
      const currFast = parseFloat(maFastValues[i])
      const prevSlow = parseFloat(maSlowValues[i - 1])
      const currSlow = parseFloat(maSlowValues[i])

      if (isNaN(prevFast) || isNaN(currFast) || isNaN(prevSlow) || isNaN(currSlow)) {
        equityCurve.push(capital)
        evaluationLog.push({ index: i, date: dates[i], equity: capital, position: 'none', pnlPct: 0, signal: 'hold' })
        continue
      }

      let signal: BacktestEvalEntry['signal'] = 'hold'

      const crossLong = reverseSignals
        ? prevFast >= prevSlow && currFast < currSlow
        : prevFast <= prevSlow && currFast > currSlow
      const crossShort = reverseSignals
        ? prevFast <= prevSlow && currFast > currSlow
        : prevFast >= prevSlow && currFast < currSlow

      let entryDir: 1 | -1 | null = null
      if (position === 0) {
        if (crossLong) {
          pending = gated ? { dir: 1, expiry: i + adxConfirmBars } : null
        } else if (enableShort && crossShort) {
          pending = gated ? { dir: -1, expiry: i + adxConfirmBars } : null
        }

        if (!gated) {
          if (crossLong) entryDir = 1
          else if (enableShort && crossShort) entryDir = -1
        } else if (pending) {
          if (i > pending.expiry) {
            pending = null // 等待窗口内 ADX 未达标，放弃该信号
          } else if (adxOk(i)) {
            entryDir = pending.dir
            pending = null
          }
        }
      }

      if (entryDir !== null) {
        position = entryDir
        entryPrice = close
        entryIndex = i
        // 设置 ATR 动态止损，与实盘一致：2 倍 ATR
        stopPrice = entryDir === 1 ? close - 2 * atr : close + 2 * atr
        const fee = fillFee(stakeAmount, cost)
        totalFee += fee
        capital -= fee
        fundingCum = 0
        signal = entryDir === 1 ? 'buy' : 'sell'
      }
      // 平多 - 死叉、止损、止盈
      else if (position === 1) {
        const pnl = (close - entryPrice) / entryPrice
        const reverseExit = reverseSignals ? prevFast <= prevSlow && currFast > currSlow : prevFast >= prevSlow && currFast < currSlow
        // 止损使用 ATR 动态止损价格，与实盘一致
        const stopLossHit = l <= stopPrice
        if (reverseExit || stopLossHit || pnl >= takeProfit) {
          const tradePnl = stopLossHit ? (stopPrice - entryPrice) / entryPrice : (close - entryPrice) / entryPrice
          const exitP = stopLossHit ? stopPrice : close
          const fee = fillFee(stakeAmount, cost)
          totalFee += fee
          capital += stakeAmount * tradePnl - fee
          trades.push({
            entryIndex,
            exitIndex: i,
            entryPrice,
            exitPrice: exitP,
            pnl: tradePnl,
            entryTime: dates[entryIndex],
            exitTime: dates[i],
            direction: 'long'
          })

          position = 0
          pending = null
          signal = reverseExit ? 'sell' : stopLossHit ? 'stop' : 'take'
        }
      }
      // 平空 - 金叉、止损、止盈
      else if (position === -1) {
        const pnl = (entryPrice - close) / entryPrice
        const reverseExit = reverseSignals ? prevFast >= prevSlow && currFast < currSlow : prevFast <= prevSlow && currFast > currSlow
        // 止损使用 ATR 动态止损价格，与实盘一致
        const stopLossHit = h >= stopPrice
        if (reverseExit || stopLossHit || pnl >= takeProfit) {
          const tradePnl = stopLossHit ? (entryPrice - stopPrice) / entryPrice : (entryPrice - close) / entryPrice
          const exitP = stopLossHit ? stopPrice : close
          const fee = fillFee(stakeAmount, cost)
          totalFee += fee
          capital += stakeAmount * tradePnl - fee
          trades.push({
            entryIndex,
            exitIndex: i,
            entryPrice,
            exitPrice: exitP,
            pnl: tradePnl,
            entryTime: dates[entryIndex],
            exitTime: dates[i],
            direction: 'short'
          })

          position = 0
          pending = null
          signal = reverseExit ? 'buy' : 'stop'
        }
      }

      // 资金费按结算间隔计提：取累计值之差，只让跨过结算点的部分进入本根
      if (position !== 0) {
        const cum = fundingAccrual(stakeAmount, i - entryIndex + 1, position as 1 | -1, barMs, cost)
        const delta = cum - fundingCum
        fundingCum = cum
        totalFunding += delta
        capital -= delta
      } else {
        fundingCum = 0
      }

      let currentEquity = capital
      if (position === 1) {
        currentEquity += stakeAmount * (close - entryPrice) / entryPrice
      } else if (position === -1) {
        currentEquity += stakeAmount * (entryPrice - close) / entryPrice
      }
      equityCurve.push(currentEquity)
      const pnlPct = (currentEquity - initialCapital) / initialCapital * 100
      evaluationLog.push({
        index: i, date: dates[i], equity: currentEquity,
        position: position === 1 ? 'long' : position === -1 ? 'short' : 'none',
        pnlPct, signal,
      })
    }

    // 循环结束还有持仓，按最后一根K线价格平仓
    if (position !== 0 && data.length > 0) {
      const lastIdx = data.length - 1
      const lastClose = parseFloat(data[lastIdx][1])
      if (position === 1) {
        const tradePnl = (lastClose - entryPrice) / entryPrice
        const fee = fillFee(stakeAmount, cost)
        totalFee += fee
        capital += stakeAmount * tradePnl - fee
        trades.push({
          entryIndex,
          exitIndex: lastIdx,
          entryPrice,
          exitPrice: lastClose,
          pnl: tradePnl,
          entryTime: dates[entryIndex],
          exitTime: dates[lastIdx],
          direction: 'long'
        })
      } else if (position === -1) {
        const tradePnl = (entryPrice - lastClose) / entryPrice
        const fee = fillFee(stakeAmount, cost)
        totalFee += fee
        capital += stakeAmount * tradePnl - fee
        trades.push({
          entryIndex,
          exitIndex: lastIdx,
          entryPrice,
          exitPrice: lastClose,
          pnl: tradePnl,
          entryTime: dates[entryIndex],
          exitTime: dates[lastIdx],
          direction: 'short'
        })
      }
      if (equityCurve.length > 0) {
        equityCurve[equityCurve.length - 1] = capital
      }
    }

    const totalReturn = trades.length > 0 ? (capital - initialCapital) / initialCapital : 0
    const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0

    let maxDrawdown = 0
    let peak = equityCurve[0] || initialCapital
    for (const eq of equityCurve) {
      if (eq > peak) peak = eq
      const dd = (peak - eq) / peak
      if (dd > maxDrawdown) maxDrawdown = dd
    }

    return {
      totalReturn,
      trades: trades.length,
      winRate,
      maxDrawdown,
      maFast,
      maSlow,
      tradesList: trades,
      equityCurve,
      evaluationLog,
      totalFee,
      totalFunding,
      isPerp: cost.isPerp,
    }
  }

  // 计算信号评分
  function calculateSignalScore(params: {
    trendSignal: string
    signalAge: number
    adx: number
    winRate: number
    maxDrawdown: number
    totalReturn: number
    trades: number
  }) {
    const { trendSignal, signalAge, adx, winRate, maxDrawdown, totalReturn, trades } = params

    let score = 0
    let action = '观望'
    let level = 'neutral'

    // 趋势信号分数
    if (trendSignal === 'long') score += 30
    else if (trendSignal === 'short') score += 25

    // 信号新鲜度分数（越新越好）
    if (signalAge <= 3) score += 25
    else if (signalAge <= 7) score += 15
    else if (signalAge <= 14) score += 5

    // ADX 趋势强度分数
    if (adx > 30) score += 20
    else if (adx > 20) score += 10

    // 历史胜率分数
    if (winRate > 0.6) score += 15
    else if (winRate > 0.5) score += 10
    else if (winRate > 0.4) score += 5

    // 历史收益分数
    if (totalReturn > 0.5) score += 10
    else if (totalReturn > 0.2) score += 5

    // 回撤惩罚
    if (maxDrawdown > 0.3) score -= 15
    else if (maxDrawdown > 0.2) score -= 10
    else if (maxDrawdown > 0.1) score -= 5

    // 交易次数惩罚（太少的数据不可靠）
    if (trades < 5) score -= 20
    else if (trades < 10) score -= 10

    // 确定操作等级
    if (score >= 70) {
      action = trendSignal === 'long' ? '强烈建议做多' : '强烈建议做空'
      level = 'strong'
    } else if (score >= 50) {
      action = trendSignal === 'long' ? '建议做多' : trendSignal === 'short' ? '建议做空' : '观望'
      level = 'moderate'
    } else if (score >= 30) {
      action = '轻仓试探'
      level = 'weak'
    } else {
      action = '观望'
      level = 'neutral'
    }

    return { score, action, level }
  }

  // 获取当前趋势信号
  function getCurrentSignal(
    data: string[][],
    maFast: number,
    maSlow: number
  ): { trendSignal: 'long' | 'short' | 'neutral'; signalAge: number; currentAdx: number } {
    const maFastValues = calculateMA(data, maFast)
    const maSlowValues = calculateMA(data, maSlow)
    const adxValues = calculateADX(data, 14)
    const lastIdx = data.length - 1

    const currFast = parseFloat(maFastValues[lastIdx]?.toString() || '0')
    const currSlow = parseFloat(maSlowValues[lastIdx]?.toString() || '0')

    let trendSignal: 'long' | 'short' | 'neutral' = 'neutral'
    let signalAge = 0

    if (currFast > currSlow) {
      trendSignal = 'long'
      for (let i = lastIdx; i > 0; i--) {
        const f = parseFloat(maFastValues[i]?.toString() || '0')
        const s = parseFloat(maSlowValues[i]?.toString() || '0')
        const pf = parseFloat(maFastValues[i - 1]?.toString() || '0')
        const ps = parseFloat(maSlowValues[i - 1]?.toString() || '0')
        if (isNaN(f) || isNaN(s) || isNaN(pf) || isNaN(ps)) continue
        if (pf <= ps && f > s) {
          signalAge = lastIdx - i
          break
        }
      }
    } else if (currFast < currSlow) {
      trendSignal = 'short'
      for (let i = lastIdx; i > 0; i--) {
        const f = parseFloat(maFastValues[i]?.toString() || '0')
        const s = parseFloat(maSlowValues[i]?.toString() || '0')
        const pf = parseFloat(maFastValues[i - 1]?.toString() || '0')
        const ps = parseFloat(maSlowValues[i - 1]?.toString() || '0')
        if (isNaN(f) || isNaN(s) || isNaN(pf) || isNaN(ps)) continue
        if (pf >= ps && f < s) {
          signalAge = lastIdx - i
          break
        }
      }
    }

    return {
      trendSignal,
      signalAge,
      currentAdx: adxValues[lastIdx] || 0
    }
  }

  return {
    result,
    calculateMA,
    calculateADX,
    runBacktestWithParams,
    calculateSignalScore,
    getCurrentSignal
  }
}
