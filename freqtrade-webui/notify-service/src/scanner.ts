import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { scoreSymbol } from './shared/trendScore.js'
import type { NotifyTask, ScanResult } from './types.js'

const POPULAR_PAIRS = [
  'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT',
  'ADA-USDT', 'AVAX-USDT', 'DOT-USDT', 'MATIC-USDT', 'LINK-USDT'
]

// 代理配置
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined

if (proxyUrl) {
  console.log(`[Scanner] Using proxy: ${proxyUrl}`)
}

async function fetchOKXCandles(pair: string, timeframe: string, limit: number): Promise<string[][]> {
  const instId = pair
  const bar = timeframe
  let allData: string[][] = []
  let after = ''

  // OKX限制每次最多300根K线，需要分页
  while (allData.length < limit) {
    const remaining = limit - allData.length
    const batchSize = Math.min(300, remaining)

    let url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${batchSize}`
    if (after) {
      url += `&after=${after}`
    }

    try {
      const res = await fetch(url, { agent } as any)
      const json: any = await res.json()

      if (json.code !== '0' || !json.data || json.data.length === 0) {
        break
      }

      allData = allData.concat(json.data)

      if (json.data.length < batchSize) {
        break
      }

      // OKX返回的最后一根K线的时间戳作为下一页的after参数
      after = json.data[json.data.length - 1][0]
    } catch (err) {
      console.error(`[Scanner] Failed to fetch ${pair} ${timeframe}:`, err)
      break
    }
  }

  return allData.reverse() // OKX返回的是从新到旧，需要反转
}

function isScored(entry: any): entry is ScanResult {
  return !entry.insufficientData
}

export async function scanPremiumPairs(task: NotifyTask): Promise<ScanResult[]> {
  const pairs = task.pairs.includes('*') ? POPULAR_PAIRS : task.pairs
  const results: ScanResult[] = []

  console.log(`[Scanner] Scanning ${pairs.length} pairs with timeframes: ${task.timeframes.join(', ')}`)

  for (const pair of pairs) {
    for (const tf of task.timeframes) {
      try {
        const candles = await fetchOKXCandles(pair, tf, 500)

        if (candles.length === 0) {
          console.log(`[Scanner] No data for ${pair} ${tf}`)
          continue
        }

        const score = scoreSymbol(pair, tf, candles)

        if (isScored(score) &&
            score.trendScore >= task.filters.minTrendScore &&
            score.riskRewardTight >= task.filters.minRiskReward &&
            score.trailingStopPercent <= task.filters.maxTrailingStop) {
          results.push(score)
          console.log(`[Scanner] ✓ ${pair} ${tf} - Score:${score.trendScore} R/R:${score.riskRewardTight.toFixed(2)} Stop:${score.trailingStopPercent.toFixed(2)}%`)
        }
      } catch (err) {
        console.error(`[Scanner] Error scanning ${pair} ${tf}:`, err)
      }
    }
  }

  console.log(`[Scanner] Found ${results.length} premium pairs`)
  return results
}
