import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  barDurationMs,
  fetchHistoricalCandles,
  toOkxSwapInstrument,
  type HistoricalCandles,
} from './scanner.js'
import { atomicWriteJson } from './storage.js'

/**
 * K 线持久缓存层（回测用）。
 *
 * 单次回测内部 backtest.ts 已有内存 Map 缓存（pair × tf 只拉一次），
 * 这里解决的是"跨多次回测重复请求"的问题：按 品种 × 周期 落盘到
 * data/candles/<instId>_<tf>.json，下次回测先读本地，只向 OKX 补
 * 缺口（前缀/后缀），再合并落盘。反复调整筛选规则重跑同一时间段时
 * 就是纯本地计算。
 */

const __filename = fileURLToPath(import.meta.url)
const CACHE_DIR = path.join(path.dirname(__filename), '../data/candles')

// 单文件 K 线上限，超出时丢弃最旧的（30 天 5m 约 8640 根，余量充足）
const MAX_CACHED_CANDLES = 30_000

interface CacheFile {
  timestamps: number[]
  candles: string[][]
}

function cacheFilePath(pair: string, timeframe: string): string {
  // 统一用 OKX 合约名做 key，避免 'BTC-USDT' 与 'BTC-USDT-SWAP' 分成两份缓存
  const instId = toOkxSwapInstrument(pair)
  const safe = `${instId}_${timeframe}`.replace(/[\\/]/g, '_')
  return path.join(CACHE_DIR, `${safe}.json`)
}

async function loadCache(file: string): Promise<CacheFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as CacheFile
    if (Array.isArray(parsed.timestamps) && Array.isArray(parsed.candles) && parsed.timestamps.length === parsed.candles.length) {
      return parsed
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') console.warn(`[CandleCache] 缓存文件损坏，重建: ${path.basename(file)}`)
  }
  return { timestamps: [], candles: [] }
}

function mergeCandles(base: CacheFile, extra: HistoricalCandles): CacheFile {
  const byTs = new Map<number, string[]>()
  for (let i = 0; i < base.timestamps.length; i++) byTs.set(base.timestamps[i], base.candles[i])
  for (let i = 0; i < extra.timestamps.length; i++) byTs.set(extra.timestamps[i], extra.candles[i])
  const sorted = [...byTs.entries()].sort((a, b) => a[0] - b[0])
  const trimmed = sorted.length > MAX_CACHED_CANDLES ? sorted.slice(sorted.length - MAX_CACHED_CANDLES) : sorted
  return { timestamps: trimmed.map(([ts]) => ts), candles: trimmed.map(([, candle]) => candle) }
}

/**
 * 找出 [rangeStart, rangeEnd] 内缓存缺失的连续区段。
 * OKX K 线按 barMs 整点对齐（从 epoch 起算），逐个预期开盘时刻检查。
 */
function findMissingSpans(timestamps: number[], rangeStart: number, rangeEnd: number, barMs: number): Array<[number, number]> {
  const have = new Set(timestamps)
  const spans: Array<[number, number]> = []
  const first = Math.ceil(rangeStart / barMs) * barMs
  const last = Math.floor(rangeEnd / barMs) * barMs
  let spanStart: number | null = null
  for (let t = first; t <= last; t += barMs) {
    if (!have.has(t)) {
      if (spanStart === null) spanStart = t
    } else if (spanStart !== null) {
      spans.push([spanStart, t - barMs])
      spanStart = null
    }
  }
  if (spanStart !== null) spans.push([spanStart, last])
  return spans
}

/**
 * 获取覆盖 [startMs - warmupBars 根, endMs] 的历史 K 线，优先读本地缓存，
 * 缺口（缓存起点之前的前缀 / 缓存终点之后的后缀）从 OKX 补齐后合并落盘。
 * 缓存中间的孔洞（上次取数部分失败留下）做一轮回填自愈；OKX 本身
 * 缺失的数据（如上市前）回填会返回空，每轮最多为这些孔洞多发一次请求。
 */
export async function getCachedHistoricalCandles(
  pair: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  warmupBars = 300
): Promise<HistoricalCandles> {
  const barMs = barDurationMs(timeframe)
  if (!barMs) throw new Error(`Unsupported timeframe: ${timeframe}`)
  const earliestOpen = startMs - warmupBars * barMs

  const file = cacheFilePath(pair, timeframe)
  const cached = await loadCache(file)

  if (cached.timestamps.length === 0) {
    // 无缓存：整段拉取
    const fresh = await fetchHistoricalCandles(pair, timeframe, startMs, endMs, warmupBars)
    const merged = mergeCandles(cached, fresh)
    if (merged.timestamps.length > 0) {
      await atomicWriteJson(file, merged)
      console.log(`[CandleCache] ${pair} ${timeframe}: 新建缓存 ${merged.timestamps.length} 根`)
    }
    return fresh
  }

  const cachedMin = cached.timestamps[0]
  const cachedMax = cached.timestamps[cached.timestamps.length - 1]

  // 补前缀：缓存起点晚于所需起点，且缺口至少有一根完整 K 线
  // （不足一根时区间为空，避免发一个必然返回空的请求）
  if (cachedMin - barMs >= earliestOpen) {
    // fetchHistoricalCandles(start, end, warmup) 覆盖 [start - warmup 根, end]
    const prefix = await fetchHistoricalCandles(pair, timeframe, earliestOpen, cachedMin - barMs, 0)
    if (prefix.timestamps.length > 0) {
      console.log(`[CandleCache] ${pair} ${timeframe}: 补前缀 ${prefix.timestamps.length} 根`)
    }
    Object.assign(cached, mergeCandles(cached, prefix))
  }

  // 补后缀：缓存终点早于所需终点，且缺口至少有一根完整 K 线
  if (cachedMax + barMs <= endMs) {
    const suffix = await fetchHistoricalCandles(pair, timeframe, cachedMax + barMs, endMs, 0)
    if (suffix.timestamps.length > 0) {
      console.log(`[CandleCache] ${pair} ${timeframe}: 补后缀 ${suffix.timestamps.length} 根`)
    }
    Object.assign(cached, mergeCandles(cached, suffix))
  }

  // 孔洞自愈：前缀/后缀补完后，请求区间内仍有缺失区段（多为上次取数
  // 中途失败留下），逐段回填一轮
  const gaps = findMissingSpans(cached.timestamps, earliestOpen, endMs, barMs)
  if (gaps.length > 0) {
    let healed = 0
    for (const [gapStart, gapEnd] of gaps) {
      const fill = await fetchHistoricalCandles(pair, timeframe, gapStart, gapEnd, 0)
      if (fill.timestamps.length > 0) {
        Object.assign(cached, mergeCandles(cached, fill))
        healed += fill.timestamps.length
      }
    }
    console.log(`[CandleCache] ${pair} ${timeframe}: 回填 ${gaps.length} 个孔洞，共 ${healed} 根`)
  }

  await atomicWriteJson(file, cached)

  // 只返回所需区间（缓存可能更宽）
  const result: HistoricalCandles = { timestamps: [], candles: [] }
  for (let i = 0; i < cached.timestamps.length; i++) {
    const ts = cached.timestamps[i]
    if (ts < earliestOpen || ts > endMs) continue
    result.timestamps.push(ts)
    result.candles.push(cached.candles[i])
  }
  return result
}
