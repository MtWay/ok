import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { scoreSymbol } from './shared/trendScore.js'
import { evaluateMultiTimeframe } from './multiTimeframe.js'
import { calculateEntryMetrics } from './entryMetrics.js'
import type { NotifyTask, ScanResult, ScanDebugEntry } from './types.js'
import { getWhitelist } from './whitelist.js'

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

export function barDurationMs(bar: string): number | undefined {
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
  const TICKERS_TIMEOUT_MS = 15_000
  const MAX_ATTEMPTS = 3

  // The tickers response is large and proxies sometimes drop the socket before
  // the TLS handshake ("Client network socket disconnected..."). A single
  // failed attempt used to silently degrade scans to the 10 fallback pairs,
  // so retry a few times before giving up.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TICKERS_TIMEOUT_MS)
    try {
      const res = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP', { agent, signal: controller.signal } as any)
      const json: any = await res.json()

      if (json.code !== '0' || !json.data) {
        throw new Error(`OKX tickers returned code ${json.code}`)
      }

      // 筛选 USDT 永续合约，按交易量排序取前 70。
      const usdtSwaps = selectPopularSwapPairs(json.data)

      console.log(`[Scanner] Selected ${usdtSwaps.length} USDT swaps by 24h turnover from OKX tickers`)
      return usdtSwaps.length > 0 ? usdtSwaps : FALLBACK_PAIRS
    } catch (err) {
      console.error(`[Scanner] Error fetching popular pairs (attempt ${attempt}/${MAX_ATTEMPTS}):`, err)
      if (attempt < MAX_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    } finally {
      clearTimeout(timeout)
    }
  }

  console.log('[Scanner] Failed to fetch SWAP tickers after retries, using fallback pairs')
  return FALLBACK_PAIRS
}

const FALLBACK_PAIRS = [
  'BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP', 'DOGE-USDT-SWAP',
  'ADA-USDT-SWAP', 'AVAX-USDT-SWAP', 'DOT-USDT-SWAP', 'MATIC-USDT-SWAP', 'LINK-USDT-SWAP'
]

// 缓存热门交易对，每小时刷新一次
let cachedPairs: string[] | null = null
let lastFetchTime = 0
const CACHE_DURATION = 60 * 60 * 1000 // 1 hour

/** Drop the cached scan candidates (e.g. after the Freqtrade whitelist changed). */
export function invalidatePairCache(): void {
  cachedPairs = null
  lastFetchTime = 0
}

export async function getPopularPairs(): Promise<string[]> {
  const now = Date.now()
  if (cachedPairs && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedPairs
  }

  cachedPairs = await fetchFreqtradeWhitelistPairs()
  lastFetchTime = now
  return cachedPairs
}

/**
 * Scan candidates mirror the Freqtrade whitelist so every signal the scanner
 * produces is tradable. Freqtrade pairs ("BTC/USDT:USDT") are converted to
 * OKX instruments ("BTC-USDT-SWAP"). Falls back to OKX top-70 by turnover
 * when the Freqtrade API is unreachable.
 */
async function fetchFreqtradeWhitelistPairs(): Promise<string[]> {
  try {
    const whitelist = await getWhitelist()
    const pairs = whitelist
      .map(pair => /^([A-Z0-9._-]+)\/USDT:USDT$/.exec(pair)?.[1])
      .filter((base): base is string => Boolean(base))
      .map(base => `${base}-USDT-SWAP`)
    if (pairs.length > 0) {
      console.log(`[Scanner] Using ${pairs.length} pairs from Freqtrade whitelist`)
      return pairs
    }
    console.warn('[Scanner] Freqtrade whitelist is empty, falling back to OKX tickers')
  } catch (error) {
    console.error('[Scanner] Unable to fetch Freqtrade whitelist, falling back to OKX tickers:', error)
  }
  return fetchPopularPairs()
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

export interface HistoricalCandles {
  /** 每根 K 线的开盘时间戳（升序），与 candles 逐根对齐 */
  timestamps: number[]
  /** 归一化 [open, close, low, high, volume]，从旧到新 */
  candles: string[][]
}

/**
 * 分页拉取历史 K 线（回测用）。覆盖 [startMs - warmupBars 根, endMs] 区间，
 * 多取的 warmupBars 根作为指标预热。OKX candles 接口的 after 语义是
 * "返回比该 ts 更早的记录"（与现有 fetchOKXCandles 的翻页用法一致），
 * 因此取更旧数据时用 after=<本页最早一根的 ts> 向前翻页。
 */
export async function fetchHistoricalCandles(
  pair: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  warmupBars = 300
): Promise<HistoricalCandles> {
  const instId = toOkxSwapInstrument(pair)
  const bar = timeframe
  const barMs = barDurationMs(bar)
  if (!barMs) throw new Error(`Unsupported timeframe: ${timeframe}`)
  const earliestOpen = startMs - warmupBars * barMs
  const agent = getProxyAgent()
  const REQUEST_TIMEOUT_MS = 15_000
  // 页数上限：区间 + 预热 + 起点到"现在"之间可能需要翻过的页，留有余量
  const maxPages = Math.ceil((Date.now() - earliestOpen) / barMs / 300) + 2

  const raw = new Map<number, string[]>()
  let after = ''
  // /market/candles 只服务最近约 1440 根（5m 只有约 5 天），更旧的数据
  // 要切到 /market/history-candles（参数与分页语义相同）继续向前翻页
  let endpoint: 'candles' | 'history-candles' = 'candles'
  for (let page = 0; page < maxPages; page++) {
    let url = `https://www.okx.com/api/v5/market/${endpoint}?instId=${instId}&bar=${bar}&limit=300`
    if (after) url += `&after=${after}`

    // 代理/OKX 偶发超时，单页最多重试 3 次再放弃（与 fetchPopularPairs 一致）
    let batch: string[][] | undefined
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(url, { agent, signal: controller.signal } as any)
        const json: any = await res.json()
        if (json.code !== '0' || !Array.isArray(json.data)) {
          throw new Error(`OKX ${endpoint} returned code ${json.code}`)
        }
        batch = json.data
        break
      } catch (err) {
        console.error(`[Scanner] Failed to fetch history ${pair} ${timeframe} page ${page} (attempt ${attempt}/3):`, err instanceof Error && err.name === 'AbortError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : err)
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      } finally {
        clearTimeout(timeout)
      }
    }
    if (!batch || batch.length === 0) {
      // candles 接口翻到头（返回空）但还没覆盖到目标起点 → 切历史接口继续
      if (endpoint === 'candles' && after) {
        endpoint = 'history-candles'
        continue
      }
      break
    }

    for (const candle of batch) {
      const ts = Number(candle[0])
      if (Number.isFinite(ts)) raw.set(ts, candle)
    }
    // 本页最早一根已覆盖到预热起点，翻页结束
    const oldestTs = Number(batch[batch.length - 1][0])
    if (!Number.isFinite(oldestTs) || oldestTs <= earliestOpen) break
    // 不满一页说明 candles 接口的新数据窗口到头了，剩余部分走历史接口
    if (batch.length < 300 && endpoint === 'candles') endpoint = 'history-candles'
    after = String(oldestTs)
  }

  // 按时间升序排列，剔除未收盘的最后一根与区间外的数据
  const sorted = [...raw.entries()].sort((a, b) => a[0] - b[0])
  const rows = sorted.map(([, candle]) => candle)
  const closed = dropUnclosedCandles(rows, bar)
  const closedCount = closed.length
  const result: HistoricalCandles = { timestamps: [], candles: [] }
  for (let i = 0; i < closedCount; i++) {
    const ts = sorted[i][0]
    if (ts < earliestOpen || ts > endMs) continue
    result.timestamps.push(ts)
    result.candles.push(normalizeOkxCandles([sorted[i][1]])[0])
  }
  return result
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

export type PairEvaluation = { score?: ScanResult; debug: ScanDebugEntry }

/**
 * 纯函数版规则评估：接收已归一化的 K 线数组（[open, close, low, high,
 * volume]，从旧到新），执行 scoreSymbol + 9 条规则评估 + matched 判断。
 * 不包含任何网络请求，实时扫描与历史回测共用同一份逻辑。
 * quiet=true 时（回测批量调用）不打日志，避免刷屏。
 */
export function evaluatePairFromCandles(
  pair: string,
  tf: string,
  candles: string[][],
  lowerCandles: string[][],
  task: NotifyTask,
  multiTimeframe: ReturnType<typeof resolveMultiTimeframeConfig>,
  quiet = false
): PairEvaluation | undefined {
  const label = displayPair(pair)
  // With multi-timeframe filtering enabled, tf is one of the task's checked
  // 时间周期 and plays the *higher* timeframe role — the trend being
  // followed. Every rule except htf_ltf, the entry metrics, and the SLTP
  // levels all evaluate it; only htf_ltf reads the lower timeframe
  // (顺大势逆小势 — the pullback/reversal entry trigger). The configured
  // multiTimeframe.higherTimeframe is a legacy field and ignored.
  const lowerTimeframe = multiTimeframe.enabled ? multiTimeframe.lowerTimeframe : undefined

  if (lowerTimeframe !== undefined) {
    const higherMs = barDurationMs(tf)
    const lowerMs = barDurationMs(lowerTimeframe)
    if (higherMs === undefined || lowerMs === undefined || lowerMs >= higherMs) {
      return {
        debug: {
          pair: label,
          timeframe: tf,
          insufficientData: false,
          matched: false,
          rejectReason: `小周期 ${lowerTimeframe} 必须小于大周期 ${tf}`,
        },
      }
    }
  }

  if (candles.length === 0) {
    if (!quiet) console.log(`[Scanner] No data for ${label} ${tf}`)
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

  const lowerScore = lowerTimeframe !== undefined ? scoreSymbol(label, lowerTimeframe, lowerCandles) : undefined

  if (!quiet) console.log(`[Scanner] ${label} ${score.timeframe} - Score:${score.trendScore} R/R:${score.riskRewardTight.toFixed(2)} Stop:${score.trailingStopPercent.toFixed(2)}%`)

  const filters = task.filters || {} as NotifyTask['filters']
  const optional = filters.optionalRules || {}
  const entry = calculateEntryMetrics(candles, score.direction)
  const multiSignal = lowerTimeframe !== undefined && lowerScore && isScored(lowerScore)
    ? evaluateMultiTimeframe(score, lowerScore, lowerCandles, multiTimeframe.minHigherTrendScore)
    : undefined
  if (multiSignal && lowerScore && isScored(lowerScore)) {
    score.multiTimeframe = {
      higherTimeframe: score.timeframe, higherDirection: score.direction, higherTrendScore: score.trendScore,
      lowerTimeframe: lowerScore.timeframe, lowerPhase: multiSignal.phase,
    }
  }

  const rulesConfig = filters.rules
  const trendMinScore = rulesConfig?.trend?.minScore ?? 50
  const allChecks = [
    { id: 'ma_direction', label: '均线方向正确', hard: true, passed: score.direction !== 'neutral', detail: score.direction === 'long' ? '多头方向' : score.direction === 'short' ? '空头方向' : '均线方向不明确' },
    { id: 'trend', label: '顺势而为', hard: true, passed: score.direction !== 'neutral' && score.trendScore >= trendMinScore, detail: `趋势评分 ${score.trendScore} (>=${trendMinScore})` },
    { id: 'htf_ltf', label: '顺大势逆小势', hard: true, passed: multiTimeframe.enabled ? multiSignal?.passed === true : score.direction !== 'neutral', detail: multiTimeframe.enabled ? (multiSignal?.detail || `无法计算小周期 ${multiTimeframe.lowerTimeframe} 信号`) : `当前周期方向 ${score.direction}` },
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

  if (!matched && !quiet) {
    console.log(`[Scanner][RULES] REJECT ${label} ${score.timeframe} enabled=${passedChecks.length}/${enabledChecks.length} required=${minHits} failed=[${failedChecks.join(' | ')}]`)
  }

  const hardChecks = checks.filter(check => check.hard)
  const enabledOptional = enabledChecks.filter(check => !check.hard)
  const debug: ScanDebugEntry = {
    pair: label,
    timeframe: score.timeframe,
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

  if (matched && !quiet) {
    console.log(`[Scanner] ✓ MATCH: ${label} ${score.timeframe}`)
  }

  return { score, debug }
}

/** 实时扫描入口：拉取最新 K 线后交给纯函数评估，行为与拆分前一致。 */
async function evaluateSinglePair(
  pair: string,
  tf: string,
  task: NotifyTask,
  multiTimeframe: ReturnType<typeof resolveMultiTimeframeConfig>
): Promise<PairEvaluation | undefined> {
  const lowerTimeframe = multiTimeframe.enabled ? multiTimeframe.lowerTimeframe : undefined

  const [candles, lowerCandles] = await Promise.all([
    fetchOKXCandles(pair, tf, 300),
    lowerTimeframe !== undefined ? fetchOKXCandles(pair, lowerTimeframe, 300) : Promise.resolve([]),
  ])

  return evaluatePairFromCandles(pair, tf, candles, lowerCandles, task, multiTimeframe)
}

export async function scanPremiumPairs(task: NotifyTask): Promise<ScanResult[]> {
  const pairs = task.pairs.includes('*') ? await getPopularPairs() : task.pairs
  const results: ScanResult[] = []

  console.log(`[Scanner] Scanning ${pairs.length} pairs with timeframes: ${task.timeframes.join(', ')}`)

  // Keep tasks created before the multi-timeframe feature working as before.
  // Multi-timeframe filtering is opt-in; enabling it by default would add the
  // strict HTF/LTF hard check to every legacy task and can filter everything.
  // When enabled, each checked timeframe plays the higher-timeframe role and
  // every rule except htf_ltf (the lower-timeframe entry timing) evaluates
  // it — see evaluateSinglePair.
  const multiTimeframe = resolveMultiTimeframeConfig(task)
  const scanTimeframes = task.timeframes

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

export async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
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
  const scanTimeframes = task.timeframes
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
