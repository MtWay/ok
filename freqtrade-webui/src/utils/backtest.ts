import type { CandleData, Trade, Signal, BacktestParams, BacktestResult, OptimizationResult, SignalScore } from '@/types'

export function calculateMA(data: number[][], period: number): (number | string)[] {
  const result: (number | string)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push('-'); continue }
    let sum = 0
    for (let j = 0; j < period; j++) sum += data[i - j][1]
    result.push(sum / period)
  }
  return result
}

export function calculateADX(data: number[][], period: number): number[] {
  const result: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(15); continue }
    let trSum = 0, dmPlusSum = 0, dmMinusSum = 0
    for (let j = 1; j <= period && i - j >= 0; j++) {
      const high = data[i - j + 1][3]
      const low = data[i - j + 1][2]
      const prevHigh = data[i - j][3]
      const prevLow = data[i - j][2]
      const prevClose = data[i - j][1]
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
      const dmPlus = high - prevHigh > prevLow - low ? Math.max(high - prevHigh, 0) : 0
      const dmMinus = prevLow - low > high - prevHigh ? Math.max(prevLow - low, 0) : 0
      trSum += tr; dmPlusSum += dmPlus; dmMinusSum += dmMinus
    }
    const dx = trSum > 0 ? Math.abs(dmPlusSum - dmMinusSum) / trSum * 100 : 0
    result.push(Math.min(dx, 50))
  }
  return result
}

export function runBacktest(
  dates: string[],
  data: number[][],
  params: BacktestParams
): BacktestResult {
  const { maFast, maSlow, adxThreshold, stopLoss, takeProfit, enableShort, initialCapital, stakeAmount } = params

  const maFastValues = calculateMA(data, maFast)
  const maSlowValues = calculateMA(data, maSlow)
  const adxValues = calculateADX(data, 14)

  const signals: Signal[] = []
  let position = 0
  const trades: Trade[] = []
  let entryPrice = 0
  let entryIndex = 0
  let capital = initialCapital
  const equityCurve: number[] = []

  for (let i = 1; i < data.length; i++) {
    const prevFast = parseFloat(maFastValues[i - 1] as string)
    const currFast = parseFloat(maFastValues[i] as string)
    const prevSlow = parseFloat(maSlowValues[i - 1] as string)
    const currSlow = parseFloat(maSlowValues[i] as string)
    const adx = adxValues[i]
    const close = data[i][1]

    if (isNaN(prevFast) || isNaN(currFast) || isNaN(prevSlow) || isNaN(currSlow)) {
      equityCurve.push(capital)
      continue
    }

    if (position === 0) {
      if (currFast > currSlow) {
        position = 1
        entryPrice = close
        entryIndex = i
        signals.push({ index: i, type: 'buy', price: close })
        equityCurve.push(capital)
        continue
      } else if (enableShort && currFast < currSlow) {
        position = -1
        entryPrice = close
        entryIndex = i
        signals.push({ index: i, type: 'short', price: close })
        equityCurve.push(capital)
        continue
      }
    }

    if (prevFast <= prevSlow && currFast > currSlow && adx > adxThreshold && position === 0) {
      position = 1
      entryPrice = close
      entryIndex = i
      signals.push({ index: i, type: 'buy', price: close })
    } else if (enableShort && prevFast >= prevSlow && currFast < currSlow && adx > adxThreshold && position === 0) {
      position = -1
      entryPrice = close
      entryIndex = i
      signals.push({ index: i, type: 'short', price: close })
    } else if (position === 1) {
      const pnl = (close - entryPrice) / entryPrice
      if ((prevFast >= prevSlow && currFast < currSlow) || pnl <= -stopLoss || pnl >= takeProfit) {
        const tradePnl = (close - entryPrice) / entryPrice
        capital += stakeAmount * tradePnl
        trades.push({
          entryIndex, exitIndex: i,
          entryPrice, exitPrice: close, pnl: tradePnl,
          entryTime: dates[entryIndex], exitTime: dates[i],
          direction: 'long'
        })
        signals.push({ index: i, type: 'sell', price: close })
        position = -1
        entryPrice = close
        entryIndex = i
        signals.push({ index: i, type: 'short', price: close })
      }
    } else if (position === -1) {
      const pnl = (entryPrice - close) / entryPrice
      if ((prevFast <= prevSlow && currFast > currSlow) || pnl <= -stopLoss || pnl >= takeProfit) {
        const tradePnl = (entryPrice - close) / entryPrice
        capital += stakeAmount * tradePnl
        trades.push({
          entryIndex, exitIndex: i,
          entryPrice, exitPrice: close, pnl: tradePnl,
          entryTime: dates[entryIndex], exitTime: dates[i],
          direction: 'short'
        })
        signals.push({ index: i, type: 'cover', price: close })
        position = 1
        entryPrice = close
        entryIndex = i
        signals.push({ index: i, type: 'buy', price: close })
      }
    }

    let currentEquity = capital
    if (position === 1) currentEquity += stakeAmount * (close - entryPrice) / entryPrice
    else if (position === -1) currentEquity += stakeAmount * (entryPrice - close) / entryPrice
    equityCurve.push(currentEquity)
  }

  if (position !== 0 && data.length > 0) {
    const lastIdx = data.length - 1
    const lastClose = data[lastIdx][1]
    if (position === 1) {
      const tradePnl = (lastClose - entryPrice) / entryPrice
      capital += stakeAmount * tradePnl
      trades.push({
        entryIndex, exitIndex: lastIdx,
        entryPrice, exitPrice: lastClose, pnl: tradePnl,
        entryTime: dates[entryIndex], exitTime: dates[lastIdx],
        direction: 'long'
      })
      signals.push({ index: lastIdx, type: 'sell', price: lastClose })
    } else if (position === -1) {
      const tradePnl = (entryPrice - lastClose) / entryPrice
      capital += stakeAmount * tradePnl
      trades.push({
        entryIndex, exitIndex: lastIdx,
        entryPrice, exitPrice: lastClose, pnl: tradePnl,
        entryTime: dates[entryIndex], exitTime: dates[lastIdx],
        direction: 'short'
      })
      signals.push({ index: lastIdx, type: 'cover', price: lastClose })
    }
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = capital
    }
  }

  const totalReturn = ((equityCurve[equityCurve.length - 1] - initialCapital) / initialCapital * 100)
  const winRate = trades.length > 0 ? (trades.filter(t => t.pnl > 0).length / trades.length * 100) : 0

  let maxDrawdown = 0
  let peak = equityCurve[0] || initialCapital
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return { totalReturn, trades, winRate, maxDrawdown, equityCurve, signals }
}

export function runBacktestWithParams(
  dates: string[],
  data: number[][],
  maFast: number,
  maSlow: number,
  adxThreshold: number,
  stopLoss: number,
  takeProfit: number,
  initialCapital: number,
  stakeAmount: number,
  enableShort: boolean = false
): OptimizationResult {
  const result = runBacktest(dates, data, {
    maFast, maSlow, adxThreshold, stopLoss, takeProfit, initialCapital, stakeAmount, enableShort
  })

  return {
    totalReturn: result.totalReturn / 100,
    trades: result.trades.length,
    winRate: result.winRate / 100,
    maxDrawdown: result.maxDrawdown / 100,
    maFast,
    maSlow,
    tradesList: result.trades
  }
}

export function calculateSignalScore(params: {
  trendSignal: string
  signalAge: number
  adx: number
  winRate: number
  maxDrawdown: number
  totalReturn: number
  trades: number
}): SignalScore {
  const { trendSignal, signalAge, adx, winRate, maxDrawdown, totalReturn } = params

  if (trendSignal === 'neutral') return { score: 0, action: '观望', level: 'neutral' }

  let score = 0

  if (signalAge <= 2) score += 30
  else if (signalAge <= 5) score += 20
  else if (signalAge <= 10) score += 10
  else score += 5

  if (winRate >= 0.6) score += 25
  else if (winRate >= 0.5) score += 20
  else if (winRate >= 0.4) score += 15
  else if (winRate >= 0.3) score += 10
  else score += 5

  if (maxDrawdown <= 0.1) score += 20
  else if (maxDrawdown <= 0.15) score += 15
  else if (maxDrawdown <= 0.2) score += 10
  else if (maxDrawdown <= 0.3) score += 5
  else score += 0

  if (adx > 30) score += 15
  else if (adx > 20) score += 10
  else if (adx > 15) score += 5
  else score += 0

  if (totalReturn >= 0.5) score += 10
  else if (totalReturn >= 0.3) score += 8
  else if (totalReturn >= 0.1) score += 5
  else if (totalReturn >= 0) score += 3
  else score += 0

  let action: string, level: 'excellent' | 'good' | 'hold' | 'neutral'
  if (score >= 80) {
    action = trendSignal === 'long' ? '做多 (最佳)' : '做空 (最佳)'
    level = 'excellent'
  } else if (score >= 60) {
    action = trendSignal === 'long' ? '做多 (推荐)' : '做空 (推荐)'
    level = 'good'
  } else if (score >= 40) {
    action = trendSignal === 'long' ? '多仓持有' : '空仓持有'
    level = 'hold'
  } else {
    action = '观望'
    level = 'neutral'
  }

  return { score, action, level }
}

export function generateMockData(pair: string): CandleData {
  const basePrices: Record<string, number> = {
    'BTC-USDT': 42000, 'ETH-USDT': 2200, 'SOL-USDT': 100,
    'XRP-USDT': 0.6, 'DOGE-USDT': 0.08, 'ADA-USDT': 0.5,
    'AVAX-USDT': 35, 'LINK-USDT': 14, 'DOT-USDT': 7,
    'MATIC-USDT': 0.8, 'UNI-USDT': 6, 'LTC-USDT': 70,
    'BCH-USDT': 230, 'ETC-USDT': 19, 'FIL-USDT': 5,
    'NEAR-USDT': 3, 'APT-USDT': 8, 'SUI-USDT': 1.2,
    'ARB-USDT': 1.5, 'OP-USDT': 3, 'PEPE-USDT': 0.000001,
    'WLD-USDT': 2.5, 'TIA-USDT': 5, 'SEI-USDT': 0.4,
    'STRK-USDT': 1.8,
    'BTC-USDT-SWAP': 42000, 'ETH-USDT-SWAP': 2200, 'SOL-USDT-SWAP': 100,
    'XRP-USDT-SWAP': 0.6, 'DOGE-USDT-SWAP': 0.08, 'ADA-USDT-SWAP': 0.5,
    'AVAX-USDT-SWAP': 35, 'LINK-USDT-SWAP': 14, 'DOT-USDT-SWAP': 7,
    'MATIC-USDT-SWAP': 0.8, 'UNI-USDT-SWAP': 6, 'LTC-USDT-SWAP': 70,
    'BCH-USDT-SWAP': 230, 'ETC-USDT-SWAP': 19, 'FIL-USDT-SWAP': 5,
    'NEAR-USDT-SWAP': 3, 'APT-USDT-SWAP': 8, 'SUI-USDT-SWAP': 1.2,
    'ARB-USDT-SWAP': 1.5, 'OP-USDT-SWAP': 3, 'PEPE-USDT-SWAP': 0.000001,
    'WLD-USDT-SWAP': 2.5, 'TIA-USDT-SWAP': 5, 'SEI-USDT-SWAP': 0.4,
    'STRK-USDT-SWAP': 1.8,
    'MEGA-USDT': 0.05, 'MEGA-USDT-SWAP': 0.05
  }
  const base = basePrices[pair] || 100
  const n = 300
  const dates: string[] = []
  const data: number[][] = []
  let price = base
  const startDate = new Date(Date.now() - n * 3600000)

  for (let i = 0; i < n; i++) {
    const date = new Date(startDate.getTime() + i * 3600000)
    dates.push(date.toISOString().slice(0, 19).replace('T', ' '))
    const change = (Math.random() - 0.48) * 0.02
    const trend = Math.sin(i / 50) * 0.001
    price *= (1 + change + trend)
    const open = price * (1 + (Math.random() - 0.5) * 0.002)
    const high = Math.max(open, price) * (1 + Math.random() * 0.01)
    const low = Math.min(open, price) * (1 - Math.random() * 0.01)
    data.push([open, price, low, high, Math.random() * 10000])
  }

  return { dates, data }
}
