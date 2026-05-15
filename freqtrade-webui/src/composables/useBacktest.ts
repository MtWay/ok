import { ref } from 'vue'
import type { CandleData, BacktestResult, Trade } from '@/types'

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

  // 计算 ADX - 简化版本，与原始 HTML 保持一致
  function calculateADX(data: string[][], period: number): number[] {
    const adx: number[] = []

    for (let i = 0; i < data.length; i++) {
      // 前 period 根 K 线使用默认值 15
      if (i < period) {
        adx.push(15)
        continue
      }

      let trSum = 0
      let dmPlusSum = 0
      let dmMinusSum = 0

      for (let j = 1; j <= period && i - j >= 0; j++) {
        const high = parseFloat(data[i - j + 1][3])
        const low = parseFloat(data[i - j + 1][2])
        const prevHigh = parseFloat(data[i - j][3])
        const prevLow = parseFloat(data[i - j][2])
        const prevClose = parseFloat(data[i - j][1])

        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
        const dmPlus = high - prevHigh > prevLow - low ? Math.max(high - prevHigh, 0) : 0
        const dmMinus = prevLow - low > high - prevHigh ? Math.max(prevLow - low, 0) : 0

        trSum += tr
        dmPlusSum += dmPlus
        dmMinusSum += dmMinus
      }

      const dx = trSum > 0 ? Math.abs(dmPlusSum - dmMinusSum) / trSum * 100 : 0
      adx.push(Math.min(dx, 50))
    }

    return adx
  }

  // 运行回测
  function runBacktestWithParams(
    dates: string[],
    data: string[][],
    maFast: number,
    maSlow: number,
    adxThreshold: number,
    stopLoss: number,
    takeProfit: number,
    initialCapital: number,
    stakeAmount: number,
    enableShort: boolean
  ): BacktestResult {
    const maFastValues = calculateMA(data, maFast)
    const maSlowValues = calculateMA(data, maSlow)
    const adxValues = calculateADX(data, 14)

    let capital = initialCapital
    let position = 0 // 0: 空仓, 1: 多仓, -1: 空仓
    let entryPrice = 0
    let entryIndex = 0
    const trades: Trade[] = []
    const equityCurve: number[] = [initialCapital]

    for (let i = 1; i < data.length; i++) {
      const close = parseFloat(data[i][1])
      const prevFast = parseFloat(maFastValues[i - 1])
      const currFast = parseFloat(maFastValues[i])
      const prevSlow = parseFloat(maSlowValues[i - 1])
      const currSlow = parseFloat(maSlowValues[i])
      const adx = adxValues[i]

      if (isNaN(prevFast) || isNaN(currFast) || isNaN(prevSlow) || isNaN(currSlow)) {
        equityCurve.push(capital)
        continue
      }

      // 第一次快慢线同时有值时，根据大小关系初始化仓位
      if (position === 0) {
        if (currFast > currSlow) {
          position = 1
          entryPrice = close
          entryIndex = i
          equityCurve.push(capital)
          continue
        } else if (enableShort && currFast < currSlow) {
          position = -1
          entryPrice = close
          entryIndex = i
          equityCurve.push(capital)
          continue
        }
      }

      // 金叉做多 - 如果 ADX 为 NaN 或 0，则忽略 ADX 条件
      const effectiveAdx = isNaN(adx) || adx === 0 ? 100 : adx
      if (prevFast <= prevSlow && currFast > currSlow && effectiveAdx > adxThreshold && position === 0) {
        position = 1
        entryPrice = close
        entryIndex = i
      }
      // 死叉做空
      else if (enableShort && prevFast >= prevSlow && currFast < currSlow && effectiveAdx > adxThreshold && position === 0) {
        position = -1
        entryPrice = close
        entryIndex = i
      }
      // 平多并开空
      else if (position === 1) {
        const pnl = (close - entryPrice) / entryPrice
        if ((prevFast >= prevSlow && currFast < currSlow) || pnl <= -stopLoss || pnl >= takeProfit) {
          const tradePnl = (close - entryPrice) / entryPrice
          capital += stakeAmount * tradePnl
          trades.push({
            entryIndex,
            exitIndex: i,
            entryPrice,
            exitPrice: close,
            pnl: tradePnl,
            entryTime: dates[entryIndex],
            exitTime: dates[i],
            direction: 'long'
          })

          position = -1
          entryPrice = close
          entryIndex = i
        }
      }
      // 平空并开多
      else if (position === -1) {
        const pnl = (entryPrice - close) / entryPrice
        if ((prevFast <= prevSlow && currFast > currSlow) || pnl <= -stopLoss || pnl >= takeProfit) {
          const tradePnl = (entryPrice - close) / entryPrice
          capital += stakeAmount * tradePnl
          trades.push({
            entryIndex,
            exitIndex: i,
            entryPrice,
            exitPrice: close,
            pnl: tradePnl,
            entryTime: dates[entryIndex],
            exitTime: dates[i],
            direction: 'short'
          })

          position = 1
          entryPrice = close
          entryIndex = i
        }
      }

      let currentEquity = capital
      if (position === 1) {
        currentEquity += stakeAmount * (close - entryPrice) / entryPrice
      } else if (position === -1) {
        currentEquity += stakeAmount * (entryPrice - close) / entryPrice
      }
      equityCurve.push(currentEquity)
    }

    // 循环结束还有持仓，按最后一根K线价格平仓
    if (position !== 0 && data.length > 0) {
      const lastIdx = data.length - 1
      const lastClose = parseFloat(data[lastIdx][1])
      if (position === 1) {
        const tradePnl = (lastClose - entryPrice) / entryPrice
        capital += stakeAmount * tradePnl
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
        capital += stakeAmount * tradePnl
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
      equityCurve
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

    const prevFast = parseFloat(maFastValues[lastIdx - 1]?.toString() || '0')
    const currFast = parseFloat(maFastValues[lastIdx]?.toString() || '0')
    const prevSlow = parseFloat(maSlowValues[lastIdx - 1]?.toString() || '0')
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
