import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { scoreSymbol } from './shared/trendScore.js'
import type { NotifyTask, ScanResult } from './types.js'

// 从 OKX API 获取热门永续合约交易对
async function fetchPopularPairs(): Promise<string[]> {
  const agent = getProxyAgent()
  try {
    const res = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP', { agent } as any)
    const json: any = await res.json()

    if (json.code !== '0' || !json.data) {
      console.log('[Scanner] Failed to fetch instruments, using fallback pairs')
      return FALLBACK_PAIRS
    }

    // 筛选 USDT 永续合约，按交易量排序取前 50
    const usdtSwaps = json.data
      .filter((inst: any) => inst.instId.endsWith('-USDT-SWAP') && inst.state === 'live')
      .map((inst: any) => ({
        pair: inst.instId.replace('-SWAP', ''),
        volume: parseFloat(inst.volCcy24h || '0')
      }))
      .sort((a: any, b: any) => b.volume - a.volume)
      .slice(0, 50)
      .map((item: any) => item.pair)

    console.log(`[Scanner] Fetched ${usdtSwaps.length} popular pairs from OKX`)
    return usdtSwaps.length > 0 ? usdtSwaps : FALLBACK_PAIRS
  } catch (err) {
    console.error('[Scanner] Error fetching popular pairs:', err)
    return FALLBACK_PAIRS
  }
}

const FALLBACK_PAIRS = [
  'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT',
  'ADA-USDT', 'AVAX-USDT', 'DOT-USDT', 'MATIC-USDT', 'LINK-USDT'
]

// 缓存热门交易对，每小时刷新一次
let cachedPairs: string[] | null = null
let lastFetchTime = 0
const CACHE_DURATION = 60 * 60 * 1000 // 1 hour

async function getPopularPairs(): Promise<string[]> {
  const now = Date.now()
  if (cachedPairs && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedPairs
  }

  cachedPairs = await fetchPopularPairs()
  lastFetchTime = now
  return cachedPairs
}

// 获取代理配置（延迟到调用时读取）
function getProxyAgent() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  if (proxyUrl) {
    console.log(`[Scanner] Using proxy: ${proxyUrl}`)
    return new HttpsProxyAgent(proxyUrl)
  }
  return undefined
}

async function fetchOKXCandles(pair: string, timeframe: string, limit: number): Promise<string[][]> {
  const instId = pair
  const bar = timeframe
  let allData: string[][] = []
  let after = ''
  const agent = getProxyAgent()

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
  const pairs = task.pairs.includes('*') ? await getPopularPairs() : task.pairs
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

        if (isScored(score)) {
          console.log(`[Scanner] ${pair} ${tf} - Score:${score.trendScore} R/R:${score.riskRewardTight.toFixed(2)} Stop:${score.trailingStopPercent.toFixed(2)}%`)

          if (score.trendScore >= task.filters.minTrendScore &&
              score.riskRewardTight >= task.filters.minRiskReward &&
              score.trailingStopPercent <= task.filters.maxTrailingStop) {
            results.push(score)
            console.log(`[Scanner] ✓ MATCH: ${pair} ${tf}`)
          }
        }
      } catch (err) {
        console.error(`[Scanner] Error scanning ${pair} ${tf}:`, err)
      }
    }
  }

  console.log(`[Scanner] Found ${results.length} premium pairs`)
  return results
}
