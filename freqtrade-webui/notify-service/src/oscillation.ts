import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { calculateATR, calculateADX } from './shared/indicators.js'
import { calculateKaufmanER } from './trendQuality.js'
import { getCachedHistoricalCandles } from './candleCache.js'
import { barDurationMs, getPopularPairs, runWithConcurrency } from './scanner.js'
import { getWhitelist } from './whitelist.js'
import { atomicWriteJson } from './storage.js'
import type {
  OscillationEntry,
  OscillationParams,
  OscillationScanFile,
  OscillationScore,
  OscillationWeights,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const OSCILLATION_DIR = path.join(path.dirname(__filename), '../data/oscillation')

export const DEFAULT_WEIGHTS: OscillationWeights = { er: 0.3, adx: 0.3, atr: 0.2, touch: 0.2 }

export const DEFAULT_OSCILLATION_PARAMS: OscillationParams = {
  lookbackBars: 120,
  donchianBars: 20,
  adxThreshold: 25,
  atrPctMin: 0.5,
  atrPctMax: 6,
  weights: { ...DEFAULT_WEIGHTS },
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 通道触碰交替次数：滚动前 N 根 Donchian（不含当根），当根 high 触及上轨
 * 或 low 触及下轨时记录一次"贴边"，相邻两次贴边方向不同计一次交替。
 */
export function countAlternations(candles: string[][], donchianBars: number): number {
  let alternations = 0
  let lastSide: 'upper' | 'lower' | null = null
  for (let i = donchianBars; i < candles.length; i++) {
    let upper = -Infinity
    let lower = Infinity
    for (let j = i - donchianBars; j < i; j++) {
      const h = Number(candles[j][3])
      const l = Number(candles[j][2])
      if (h > upper) upper = h
      if (l < lower) lower = l
    }
    const high = Number(candles[i][3])
    const low = Number(candles[i][2])
    const hitsUpper = high >= upper
    const hitsLower = low <= lower
    if (hitsUpper && !hitsLower) {
      if (lastSide === 'lower') alternations++
      lastSide = 'upper'
    } else if (hitsLower && !hitsUpper) {
      if (lastSide === 'upper') alternations++
      lastSide = 'lower'
    }
  }
  return alternations
}

/**
 * 综合振荡度评分：低 ER（无方向）+ 低 ADX（无趋势）+ 高 ATR%（波动大）+
 * 高通道触碰交替频率（来回打）。各分量映射到 0-100，加权合成。
 *
 * 注意：shared/indicators.ts 的 calculateADX 是简化版单窗口 DX（非 Wilder
 * 平滑），阈值 adxThreshold 按此调。
 */
export function computeOscillationScore(candles: string[][], params: OscillationParams): OscillationScore | null {
  const { lookbackBars, donchianBars, adxThreshold, atrPctMin, atrPctMax, weights } = params
  const minBars = Math.max(lookbackBars, donchianBars + 1, 20) + 1
  if (candles.length < minBars) return null
  const slice = candles.slice(-lookbackBars)

  const er = calculateKaufmanER(slice, Math.min(lookbackBars - 1, 20))
  const erScore = clamp((1 - er) * 100, 0, 100)

  const adxSeries = calculateADX(slice, Math.min(lookbackBars - 1, 14))
  const adx = adxSeries[adxSeries.length - 1] ?? 0
  const adxScore = clamp((1 - adx / adxThreshold) * 100, 0, 100)

  const atrSeries = calculateATR(slice, 14)
  const atr = atrSeries[atrSeries.length - 1] ?? 0
  const close = Number(slice[slice.length - 1][1])
  const atrPct = close > 0 ? (atr / close) * 100 : 0
  const atrScore = clamp(((atrPct - atrPctMin) / (atrPctMax - atrPctMin)) * 100, 0, 100)

  const touchFreq = countAlternations(slice, donchianBars)
  const expectedMax = Math.max(1, Math.floor(lookbackBars / 10))
  const touchScore = clamp((touchFreq / expectedMax) * 100, 0, 100)

  const total = weights.er * erScore + weights.adx * adxScore + weights.atr * atrScore + weights.touch * touchScore

  return {
    total, er, adx, atrPct, touchFreq,
    erScore, adxScore, atrScore, touchScore,
    bars: slice.length,
  }
}

export async function resolvePool(pool: 'popular' | 'whitelist'): Promise<string[]> {
  if (pool === 'popular') return getPopularPairs()
  const whitelist = await getWhitelist()
  const pairs = whitelist
    .map(p => /^([A-Z0-9._-]+)\/USDT:USDT$/.exec(p)?.[1])
    .filter((base): base is string => Boolean(base))
    .map(base => `${base}-USDT-SWAP`)
  return pairs.length > 0 ? pairs : getPopularPairs()
}

export interface OscillationScanOpts {
  timeframe: string
  lookbackBars: number
  pool: 'popular' | 'whitelist'
  limit: number
  params?: Partial<OscillationParams>
}

function emptyScore(): OscillationScore {
  return { total: 0, er: 0, adx: 0, atrPct: 0, touchFreq: 0, erScore: 0, adxScore: 0, atrScore: 0, touchScore: 0, bars: 0 }
}

export async function runOscillationScan(opts: OscillationScanOpts): Promise<OscillationScanFile> {
  const barMs = barDurationMs(opts.timeframe)
  if (!barMs) throw new Error(`Unsupported timeframe: ${opts.timeframe}`)
  const params: OscillationParams = {
    ...DEFAULT_OSCILLATION_PARAMS,
    ...opts.params,
    lookbackBars: opts.lookbackBars,
    weights: { ...DEFAULT_OSCILLATION_PARAMS.weights, ...opts.params?.weights },
  }
  const pairs = await resolvePool(opts.pool)
  const warmup = Math.max(params.lookbackBars, params.donchianBars + 1, 30) + 60
  const endMs = Date.now()
  const startMs = endMs - warmup * barMs
  const results: OscillationEntry[] = []
  await runWithConcurrency(pairs, 6, async pair => {
    try {
      const data = await getCachedHistoricalCandles(pair, opts.timeframe, startMs, endMs, 0)
      if (data.candles.length > 0) {
        const score = computeOscillationScore(data.candles, params)
        if (score) {
          results.push({ pair, ...score, insufficientData: false })
        } else {
          results.push({ pair, ...emptyScore(), insufficientData: true })
        }
      }
    } catch (err) {
      console.warn(`[Oscillation] ${pair} 取数失败:`, err instanceof Error ? err.message : err)
    }
  })
  results.sort((a, b) => b.total - a.total)
  const file: OscillationScanFile = {
    generatedAt: Date.now(),
    timeframe: opts.timeframe,
    lookbackBars: opts.lookbackBars,
    pool: opts.pool,
    results: results.slice(0, opts.limit),
  }
  await persistScan(file)
  return file
}

export async function loadOscillationLatest(timeframe?: string): Promise<OscillationScanFile | null> {
  const tf = timeframe ?? '4H'
  const file = path.join(OSCILLATION_DIR, `${tf}_latest.json`)
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as OscillationScanFile
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export async function persistScan(file: OscillationScanFile): Promise<void> {
  const latest = path.join(OSCILLATION_DIR, `${file.timeframe}_latest.json`)
  const archive = path.join(OSCILLATION_DIR, `${file.timeframe}_${file.generatedAt}.json`)
  await atomicWriteJson(latest, file)
  await atomicWriteJson(archive, file)
}
