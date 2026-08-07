import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { scoreSymbol } from './shared/trendScore.js'
import { evaluateMultiTimeframe } from './multiTimeframe.js'
import { calculateEntryMetrics } from './entryMetrics.js'
import type { NotifyTask, ScanResult } from './types.js'

export function selectPopularSwapPairs(tickers: Array<{ instId: string; volCcy24h?: string }>, limit = 70): string[] {
  return tickers
    .filter(ticker => ticker.instId.endsWith('-USDT-SWAP'))
    .map(ticker => ({ pair: ticker.instId, volume: Number(ticker.volCcy24h || 0) }))
    .filter(ticker => Number.isFinite(ticker.volume) && ticker.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit)
    .map(ticker => ticker.pair)
}

// 从 OKX API 获取热门永续合约交易对
async function fetchPopularPairs(): Promise<string[]> {
  const agent = getProxyAgent()
  try {
    const res = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP', { agent } as any)
    const json: any = await res.json()

    if (json.code !== '0' || !json.data) {
      console.log('[Scanner] Failed to fetch SWAP tickers, using fallback pairs')
      return FALLBACK_PAIRS
    }

      // 筛选 USDT 永续合约，按交易量排序取前 70。
    const usdtSwaps = selectPopularSwapPairs(json.data)

    console.log(`[Scanner] Selected ${usdtSwaps.length} USDT swaps by 24h turnover from OKX tickers`)
    return usdtSwaps.length > 0 ? usdtSwaps : FALLBACK_PAIRS
  } catch (err) {
    console.error('[Scanner] Error fetching popular pairs:', err)
    return FALLBACK_PAIRS
  }
}

const FALLBACK_PAIRS = [
  'BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP', 'DOGE-USDT-SWAP',
  'ADA-USDT-SWAP', 'AVAX-USDT-SWAP', 'DOT-USDT-SWAP', 'MATIC-USDT-SWAP', 'LINK-USDT-SWAP'
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

export function toOkxSwapInstrument(pair: string): string {
  return pair.endsWith('-SWAP') ? pair : `${pair}-SWAP`
}

function displayPair(pair: string): string {
  return pair.replace(/-SWAP$/, '')
}

async function fetchOKXCandles(pair: string, timeframe: string, limit: number): Promise<string[][]> {
  const instId = toOkxSwapInstrument(pair)
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

export function resolveMultiTimeframeConfig(task: Pick<NotifyTask, 'filters'>) {
  return task.filters.multiTimeframe ?? {
    enabled: false,
    higherTimeframe: '4H',
    lowerTimeframe: '1H',
    minHigherTrendScore: 60,
  }
}

export async function scanPremiumPairs(task: NotifyTask): Promise<ScanResult[]> {
  const pairs = task.pairs.includes('*') ? await getPopularPairs() : task.pairs
  const results: ScanResult[] = []

  console.log(`[Scanner] Scanning ${pairs.length} pairs with timeframes: ${task.timeframes.join(', ')}`)

  // Keep tasks created before the multi-timeframe feature working as before.
  // Multi-timeframe filtering is opt-in; enabling it by default would add the
  // strict HTF/LTF hard check to every legacy task and can filter everything.
  const multiTimeframe = resolveMultiTimeframeConfig(task)
  const scanTimeframes = multiTimeframe.enabled ? [multiTimeframe.lowerTimeframe] : task.timeframes

  for (const pair of pairs) {
    for (const tf of scanTimeframes) {
      try {
        const [candles, higherCandles] = await Promise.all([
          fetchOKXCandles(pair, tf, 500),
          multiTimeframe.enabled && multiTimeframe.higherTimeframe !== tf ? fetchOKXCandles(pair, multiTimeframe.higherTimeframe, 500) : Promise.resolve([]),
        ])
        const label = displayPair(pair)

        if (candles.length === 0) {
          console.log(`[Scanner] No data for ${label} ${tf}`)
          continue
        }

        const score = scoreSymbol(label, tf, candles)

        if (isScored(score)) {
          console.log(`[Scanner] ${label} ${tf} - Score:${score.trendScore} R/R:${score.riskRewardTight.toFixed(2)} Stop:${score.trailingStopPercent.toFixed(2)}%`)

          const filters = task.filters || {} as NotifyTask['filters']
          const optional = filters.optionalRules || {}
          const entry = calculateEntryMetrics(candles, score.direction)
          const higherScore = multiTimeframe.enabled ? scoreSymbol(label, multiTimeframe.higherTimeframe, higherCandles) : undefined
          const multiSignal = higherScore && isScored(higherScore)
            ? evaluateMultiTimeframe(higherScore, score, candles, multiTimeframe.minHigherTrendScore)
            : undefined
          if (multiSignal && higherScore && higherScore.direction !== undefined && higherScore.trendScore !== undefined) {
            score.multiTimeframe = {
              higherTimeframe: higherScore.timeframe, higherDirection: higherScore.direction, higherTrendScore: higherScore.trendScore,
              lowerTimeframe: score.timeframe, lowerPhase: multiSignal.phase,
            }
          }
          const checks = [
            { id: 'ma_direction', label: '均线方向正确', passed: score.direction !== 'neutral', detail: score.direction === 'long' ? '多头方向' : score.direction === 'short' ? '空头方向' : '均线方向不明确', hard: true },
            { id: 'trend', label: '顺势而为', passed: score.direction !== 'neutral' && score.trendScore >= 50, detail: `趋势评分 ${score.trendScore}`, hard: true },
            { id: 'htf_ltf', label: '顺大势逆小势', passed: multiTimeframe.enabled ? multiSignal?.passed === true : score.direction !== 'neutral', detail: multiTimeframe.enabled ? (multiSignal?.detail || `无法计算大周期 ${multiTimeframe.higherTimeframe} 信号`) : `当前周期方向 ${score.direction}`, hard: true },
            { id: 'ma_distance', label: '未偏离均线过远', passed: entry.maDistanceAtr <= (optional.maDistance?.maxAtr ?? 1.5), detail: `距 MA20 ${entry.maDistanceAtr.toFixed(2)} ATR` },
            { id: 'pullback', label: '回撤幅度达到要求', passed: entry.pullbackAtr >= (optional.pullback?.minAtr ?? 0.8), detail: `回撤 ${entry.pullbackAtr.toFixed(2)} ATR` },
            { id: 'support_resistance', label: '存在有效支撑/阻力', passed: entry.structureDistanceAtr !== undefined && entry.structureDistanceAtr <= (optional.supportResistance?.maxAtr ?? 1), detail: entry.structureDistanceAtr === undefined ? '未找到有效摆动位' : `距${score.direction === 'long' ? '支撑' : '阻力'} ${entry.structureDistanceAtr.toFixed(2)} ATR` },
            { id: 'trend_score', label: '趋势评分达标', passed: score.trendScore >= (optional.trendScore?.min ?? filters.minTrendScore ?? 60), detail: `评分 ${score.trendScore}` },
            { id: 'risk_reward', label: '盈亏比达标', passed: score.riskRewardTight >= (optional.riskReward?.min ?? filters.minRiskReward ?? 1.5), detail: `盈亏比 ${score.riskRewardTight.toFixed(2)}` },
            { id: 'trailing_stop', label: '移动止损可接受', passed: score.trailingStopPercent <= (optional.trailingStop?.maxPercent ?? filters.maxTrailingStop ?? 5), detail: `移动止损 ${score.trailingStopPercent.toFixed(2)}%` },
          ]
          const hardChecks = checks.filter(check => check.hard)
          const optionalChecks = checks.filter(check => !check.hard)
          const enabledOptional = optionalChecks.filter(check => {
            const config = optional[{ ma_distance: 'maDistance', pullback: 'pullback', support_resistance: 'supportResistance', trend_score: 'trendScore', risk_reward: 'riskReward', trailing_stop: 'trailingStop' }[check.id] as keyof typeof optional] as { enabled?: boolean } | undefined
            return config?.enabled !== false
          })
          const passedOptional = enabledOptional.filter(check => check.passed)
          const minOptionalHits = Math.min(filters.minOptionalHits ?? enabledOptional.length, enabledOptional.length)
          score.ruleChecks = checks
          score.hardRulesPassed = hardChecks.filter(check => check.passed).length
          score.optionalRulesPassed = passedOptional.length
          score.optionalRulesTotal = enabledOptional.length
          const hardPassed = hardChecks.every(check => check.passed)
          const optionalPassed = passedOptional.length >= minOptionalHits
          if (!hardPassed || !optionalPassed) {
            const failedHard = hardChecks.filter(check => !check.passed).map(check => `${check.id}: ${check.detail}`)
            const failedOptional = enabledOptional.filter(check => !check.passed).map(check => `${check.id}: ${check.detail}`)
            console.log(`[Scanner][RULES] REJECT ${label} ${tf} hard=${hardChecks.filter(check => check.passed).length}/${hardChecks.length} optional=${passedOptional.length}/${enabledOptional.length} required=${minOptionalHits} failedHard=[${failedHard.join(' | ')}] failedOptional=[${failedOptional.join(' | ')}]`)
          }
          if (hardPassed && optionalPassed) {
            results.push(score)
            console.log(`[Scanner] ✓ MATCH: ${label} ${tf}`)
          }
        }
      } catch (err) {
        console.error(`[Scanner] Error scanning ${displayPair(pair)} ${tf}:`, err)
      }
    }
  }

  console.log(`[Scanner] Found ${results.length} premium pairs`)
  return results
}
