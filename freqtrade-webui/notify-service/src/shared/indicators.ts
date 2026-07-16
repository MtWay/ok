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
