import type { CandleData } from '@/types'

const OKX_API_BASE = 'https://www.okx.com/api/v5/market'

export async function fetchOKXData(instId: string, bar: string, limit: string): Promise<number[][]> {
  const url = `${OKX_API_BASE}/candles?instId=${instId}&bar=${bar}&limit=${limit}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const json = await response.json()
  if (json.code !== '0') throw new Error(json.msg)
  return json.data
}

export function parseOKXCandles(candles: number[][]): CandleData {
  candles.reverse()
  const dates: string[] = []
  const data: number[][] = []

  for (const candle of candles) {
    const ts = parseInt(candle[0] as unknown as string)
    const date = new Date(ts)
    dates.push(date.toISOString().slice(0, 19).replace('T', ' '))

    const open = parseFloat(candle[1] as unknown as string)
    const high = parseFloat(candle[2] as unknown as string)
    const low = parseFloat(candle[3] as unknown as string)
    const close = parseFloat(candle[4] as unknown as string)
    const volume = parseFloat(candle[5] as unknown as string)

    data.push([open, close, low, high, volume])
  }

  return { dates, data }
}
