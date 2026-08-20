import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { scoreSymbol } from './shared/trendScore.js'
import { evaluateMultiTimeframe } from './multiTimeframe.js'
import { calculateEntryMetrics } from './entryMetrics.js'
import type { NotifyTask, ScanResult, ScanDebugEntry } from './types.js'

export function selectPopularSwapPairs(tickers: Array<{ instId: string; volCcy24h?: string }>, limit = 70): string[] {
  return tickers
    .filter(ticker => ticker.instId.endsWith('-USDT-SWAP'))
    .map(ticker => ({ pair: ticker.instId, volume: Number(ticker.volCcy24h || 0) }))
    .filter(ticker => Number.isFinite(ticker.volume) && ticker.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit)
    .map(ticker => ticker.pair)
}

const BAR_UNIT_MS: Record<string, number> = { m: 60_000, H: 3_600_000, D: 86_400_000, W: 604_800_000 }

function barDurationMs(bar: string): number | undefined {
  const match = /^(\d+)([mHDW])$/.exec(bar)
  return match ? Number(match[1]) * BAR_UNIT_MS[match[2]] : undefined
}

/**
 * Drop the trailing in-progress candle. OKX returns the still-open candle as
 * the newest entry; at a scan that fires right after the hour it is seconds
 * old (open=high=low≈close), which corrupts MA/ATR/swing calculations. Only
 * the newest candle can be unclosed, and an unparseable bar disables the
 * filter rather than guessing.
 */
export function dropUnclosedCandles(data: string[][], bar: string, now = Date.now()): string[][] {
  const period = barDurationMs(bar)
  if (!period || data.length === 0) return data
  const lastOpenTs = Number(data[data.length - 1][0])
  return Number.isFinite(lastOpenTs) && lastOpenTs + period > now ? data.slice(0, -1) : data
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

/**
 * OKX raw candle [ts, open, high, low, close, vol, ...] → normalized
 * [open, close, low, high, volume], the layout scoreSymbol / entryMetrics /
 * multiTimeframe all read (same as the frontend parseOKXCandles). Feeding raw
 * arrays through interpreted open as close and swapped high/low.
 */
export function normalizeOkxCandles(data: string[][]): string[][] {
  return data.map(candle => [candle[1], candle[4], candle[3], candle[2], candle[5]])
}

async function fetchOKXCandles(pair: string, timeframe: string, limit: number): Promise<string[][]> {
  const instId = toOkxSwapInstrument(pair)
  const bar = timeframe
  let allData: string[][] = []
  let after = ''
  const agent = getProxyAgent()
  const REQUEST_TIMEOUT_MS = 15_000

  // OKX限制每次最多300根K线，需要分页
  while (allData.length < limit) {
    const remaining = limit - allData.length
    const batchSize = Math.min(300, remaining)

    let url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${batchSize}`
    if (after) {
      url += `&after=${after}`
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const res = await fetch(url, { agent, signal: controller.signal } as any)
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
      if (err instanceof Error && err.name === 'AbortError') {
        console.error(`[Scanner] Timeout fetching ${pair} ${timeframe} after ${REQUEST_TIMEOUT_MS}ms`)
      } else {
        console.error(`[Scanner] Failed to fetch ${pair} ${timeframe}:`, err)
      }
      break
    } finally {
      clearTimeout(timeout)
    }
  }

  // OKX 返回从新到旧的原始格式 [ts, open, high, low, close, vol, ...]。
  // 反转为从旧到新并剔除未收盘的最后一根，然后归一化索引。
  return normalizeOkxCandles(dropUnclosedCandles(allData.reverse(), bar))
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

type PairEvaluation = { score?: ScanResult; debug: ScanDebugEntry }

async function evaluateSinglePair(
  pair: string,
  tf: string,
  task: NotifyTask,
  multiTimeframe: ReturnType<typeof resolveMultiTimeframeConfig>
): Promise<PairEvaluation | undefined> {
  const [candles, higherCandles] = await Promise.all([
    fetchOKXCandles(pair, tf, 300),
    multiTimeframe.enabled && multiTimeframe.higherTimeframe !== tf ? fetchOKXCandles(pair, multiTimeframe.higherTimeframe, 300) : Promise.resolve([]),
  ])
  const label = displayPair(pair)

  if (candles.length === 0) {
    console.log(`[Scanner] No data for ${label} ${tf}`)
    return undefined
  }

  const score = scoreSymbol(label, tf, candles)

  if (!isScored(score)) {
    return {
      debug: {
        pair: label,
        timeframe: tf,
        insufficientData: true,
        matched: false,
        rejectReason: '数据不足或无法计算指标',
      },
    }
  }

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

  const rulesConfig = filters.rules
  const trendMinScore = rulesConfig?.trend?.minScore ?? 50
  const allChecks = [
    { id: 'ma_direction', label: '均线方向正确', hard: true, passed: score.direction !== 'neutral', detail: score.direction === 'long' ? '多头方向' : score.direction === 'short' ? '空头方向' : '均线方向不明确' },
    { id: 'trend', label: '顺势而为', hard: true, passed: score.direction !== 'neutral' && score.trendScore >= trendMinScore, detail: `趋势评分 ${score.trendScore} (>=${trendMinScore})` },
    { id: 'htf_ltf', label: '顺大势逆小势', hard: true, passed: multiTimeframe.enabled ? multiSignal?.passed === true : score.direction !== 'neutral', detail: multiTimeframe.enabled ? (multiSignal?.detail || `无法计算大周期 ${multiTimeframe.higherTimeframe} 信号`) : `当前周期方向 ${score.direction}` },
    { id: 'ma_distance', label: '未偏离均线过远', passed: entry.maDistanceAtr <= (rulesConfig?.maDistance?.maxAtr ?? optional.maDistance?.maxAtr ?? 1.5), detail: `距 MA20 ${entry.maDistanceAtr.toFixed(2)} ATR` },
    { id: 'pullback', label: '回撤幅度达到要求', passed: entry.pullbackAtr >= (rulesConfig?.pullback?.minAtr ?? optional.pullback?.minAtr ?? 0.8), detail: `回撤 ${entry.pullbackAtr.toFixed(2)} ATR` },
    { id: 'support_resistance', label: '存在有效支撑/阻力', passed: entry.structureDistanceAtr !== undefined && entry.structureDistanceAtr <= (rulesConfig?.supportResistance?.maxAtr ?? optional.supportResistance?.maxAtr ?? 1), detail: entry.structureDistanceAtr === undefined ? '未找到有效摆动位' : `距${score.direction === 'long' ? '支撑' : '阻力'} ${entry.structureDistanceAtr.toFixed(2)} ATR` },
    { id: 'trend_score', label: '趋势评分达标', passed: score.trendScore >= (rulesConfig?.trendScore?.min ?? optional.trendScore?.min ?? filters.minTrendScore ?? 60), detail: `评分 ${score.trendScore}` },
    { id: 'risk_reward', label: '盈亏比达标', passed: score.riskRewardTight >= (rulesConfig?.riskReward?.min ?? optional.riskReward?.min ?? filters.minRiskReward ?? 1.5), detail: `盈亏比 ${score.riskRewardTight.toFixed(2)}` },
    { id: 'trailing_stop', label: '移动止损可接受', passed: score.trailingStopPercent <= (rulesConfig?.trailingStop?.maxPercent ?? optional.trailingStop?.maxPercent ?? filters.maxTrailingStop ?? 5), detail: `移动止损 ${score.trailingStopPercent.toFixed(2)}%` },
  ]

  const legacyEnabled = (check: typeof allChecks[number]) => {
    if (check.hard) return true
    const config = optional[{ ma_distance: 'maDistance', pullback: 'pullback', support_resistance: 'supportResistance', trend_score: 'trendScore', risk_reward: 'riskReward', trailing_stop: 'trailingStop' }[check.id] as keyof typeof optional] as { enabled?: boolean } | undefined
    return config?.enabled !== false
  }
  const newEnabled = (check: typeof allChecks[number]) => {
    if (!rulesConfig) return legacyEnabled(check)
    const key = { ma_direction: 'maDirection', trend: 'trend', htf_ltf: 'htfLtf', ma_distance: 'maDistance', pullback: 'pullback', support_resistance: 'supportResistance', trend_score: 'trendScore', risk_reward: 'riskReward', trailing_stop: 'trailingStop' }[check.id] as keyof NonNullable<typeof rulesConfig>
    const config = rulesConfig[key] as { enabled?: boolean } | undefined
    return config?.enabled !== false
  }

  const checks = allChecks.map(check => ({ ...check, enabled: newEnabled(check) }))
  const enabledChecks = checks.filter(check => check.enabled)
  const passedChecks = enabledChecks.filter(check => check.passed)

  const minHits = rulesConfig
    ? Math.min(filters.minRuleHits ?? enabledChecks.length, enabledChecks.length)
    : Math.min(filters.minOptionalHits ?? enabledChecks.filter(c => !c.hard).length, enabledChecks.filter(c => !c.hard).length)
  const matched = rulesConfig
    ? passedChecks.length >= minHits
    : (checks.filter(c => c.hard).every(c => c.passed) && enabledChecks.filter(c => !c.hard && c.passed).length >= minHits)

  const failedChecks = enabledChecks.filter(check => !check.passed).map(check => `${check.label}: ${check.detail}`)

  if (!matched) {
    console.log(`[Scanner][RULES] REJECT ${label} ${tf} enabled=${passedChecks.length}/${enabledChecks.length} required=${minHits} failed=[${failedChecks.join(' | ')}]`)
  }

  const hardChecks = checks.filter(check => check.hard)
  const enabledOptional = enabledChecks.filter(check => !check.hard)
  const debug: ScanDebugEntry = {
    pair: label,
    timeframe: tf,
    insufficientData: false,
    trendScore: score.trendScore,
    direction: score.direction,
    riskRewardTight: score.riskRewardTight,
    trailingStopPercent: score.trailingStopPercent,
    multiTimeframe: score.multiTimeframe,
    ruleChecks: checks,
    hardRulesPassed: hardChecks.filter(check => check.passed).length,
    hardRulesTotal: hardChecks.length,
    optionalRulesPassed: enabledOptional.filter(check => check.passed).length,
    optionalRulesTotal: enabledOptional.length,
    minOptionalHits: rulesConfig ? undefined : minHits,
    matched,
    rejectReason: !matched ? `规则命中不足 (${passedChecks.length}/${minHits}): ${failedChecks.join('; ')}` : undefined,
  }

  score.ruleChecks = checks
  score.hardRulesPassed = hardChecks.filter(check => check.passed).length
  score.optionalRulesPassed = enabledOptional.filter(check => check.passed).length
  score.optionalRulesTotal = enabledOptional.length

  if (matched) {
    console.log(`[Scanner] ✓ MATCH: ${label} ${tf}`)
  }

  return { score, debug }
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
        const evaluation = await evaluateSinglePair(pair, tf, task, multiTimeframe)
        if (evaluation?.score && evaluation.debug.matched) {
          results.push(evaluation.score)
        }
      } catch (err) {
        console.error(`[Scanner] Error scanning ${displayPair(pair)} ${tf}:`, err)
      }
    }
  }

  console.log(`[Scanner] Found ${results.length} premium pairs`)
  return results
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers: Promise<void>[] = []
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift()!
        try { await fn(item) } catch (err) { console.error('[Scanner][DEBUG] Worker error:', err) }
      }
    })())
  }
  await Promise.all(workers)
}

export async function debugScanPremiumPairs(task: NotifyTask): Promise<ScanDebugEntry[]> {
  const pairs = task.pairs.includes('*') ? await getPopularPairs() : task.pairs
  const results: ScanDebugEntry[] = []

  console.log(`[Scanner][DEBUG] Scanning ${pairs.length} pairs with timeframes: ${task.timeframes.join(', ')}`)

  const multiTimeframe = resolveMultiTimeframeConfig(task)
  const scanTimeframes = multiTimeframe.enabled ? [multiTimeframe.lowerTimeframe] : task.timeframes
  const jobs: Array<{ pair: string; tf: string }> = []
  for (const pair of pairs) {
    for (const tf of scanTimeframes) {
      jobs.push({ pair, tf })
    }
  }

  await runWithConcurrency(jobs, 6, async ({ pair, tf }) => {
    try {
      const evaluation = await evaluateSinglePair(pair, tf, task, multiTimeframe)
      if (evaluation) {
        results.push(evaluation.debug)
      }
    } catch (err) {
      console.error(`[Scanner][DEBUG] Error scanning ${displayPair(pair)} ${tf}:`, err)
    }
  })

  console.log(`[Scanner][DEBUG] Evaluated ${results.length} candidates`)
  return results
}
