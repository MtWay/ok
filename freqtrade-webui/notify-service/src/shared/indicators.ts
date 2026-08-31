// Shared utility functions for both frontend and backend
// Adapted from ../src/composables/useBacktest.ts

export function calculateMA(data: string[][], period: number): string[] {
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

// ATR(period)，Wilder 平滑，与前端 useTrendScore.ts 及 TA-Lib ta.ATR 保持一致
// K 线布局：[open, close, low, high, volume]
export function calculateATR(data: string[][], period = 14): number[] {
  const atr: number[] = []
  const trueRanges: number[] = []

  for (let i = 0; i < data.length; i++) {
    const high = parseFloat(data[i][3])
    const low = parseFloat(data[i][2])
    if (i === 0) {
      trueRanges.push(high - low)
      atr.push(trueRanges[0])
      continue
    }
    const prevClose = parseFloat(data[i - 1][1])
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trueRanges.push(tr)

    if (i < period) {
      const sum = trueRanges.slice(0, i + 1).reduce((a, b) => a + b, 0)
      atr.push(sum / (i + 1))
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period)
    }
  }

  return atr
}

export function calculateADX(data: string[][], period: number): number[] {
  const adx: number[] = []

  for (let i = 0; i < data.length; i++) {
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
