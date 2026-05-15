import { ref, computed } from 'vue'
import type { CandleData, DataCache } from '@/types'

const OKX_API_BASE = 'https://www.okx.com/api/v5/market'

// 全局数据缓存，避免重复调用接口
const globalCache = new Map<string, DataCache>()

export function useDataFetch() {
  const loading = ref(false)
  const loadingText = ref('')
  const error = ref('')
  const isRealData = ref(false)

  const hasError = computed(() => error.value !== '')

  // 生成缓存键
  function getCacheKey(pair: string, timeframe: string, limit: string | number): string {
    return `${pair}:${timeframe}:${limit}`
  }

  // 显示加载状态
  function showLoading(text: string) {
    loading.value = true
    loadingText.value = text
  }

  // 隐藏加载状态
  function hideLoading() {
    loading.value = false
  }

  // 显示错误
  function showError(msg: string) {
    error.value = msg
    setTimeout(() => {
      error.value = ''
    }, 5000)
  }

  // 从 OKX 获取数据（单次，最多300条）
  async function fetchOKXData(instId: string, bar: string, limit: string | number): Promise<string[][]> {
    const url = `${OKX_API_BASE}/candles?instId=${instId}&bar=${bar}&limit=${limit}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    if (json.code !== '0') throw new Error(json.msg)
    return json.data
  }

  // 分批获取数据（OKX限制每次最多300条）
  async function fetchCandlesByLimit(instId: string, bar: string, totalLimit: number): Promise<string[][]> {
    const batchSize = 300
    const batches = Math.ceil(totalLimit / batchSize)
    let allCandles: string[][] = []
    let afterTime: number | null = null

    for (let i = 0; i < batches; i++) {
      let candles: string[][]
      if (i === 0) {
        // 第一次请求：获取最新的300条
        candles = await fetchOKXData(instId, bar, batchSize)
      } else {
        // 后续请求：用 after 参数取更旧的数据
        const url = `${OKX_API_BASE}/candles?instId=${instId}&bar=${bar}&limit=${batchSize}&after=${afterTime}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const json = await response.json()
        if (json.code !== '0') throw new Error(json.msg)
        candles = json.data
      }

      if (!candles || candles.length === 0) break

      // 合并数据
      allCandles = [...allCandles, ...candles]

      // 记录本批最旧K线的时间戳，作为下一批的 after
      afterTime = parseInt(candles[candles.length - 1][0])

      // 如果已经获取足够数据，跳出循环
      if (allCandles.length >= totalLimit) break
    }

    // 按时间戳排序（新→旧）后去重
    allCandles.sort((a, b) => parseInt(b[0]) - parseInt(a[0]))
    const unique: string[][] = []
    for (const c of allCandles) {
      if (unique.length === 0 || unique[unique.length - 1][0] !== c[0]) {
        unique.push(c)
      }
    }

    // 截取到指定数量
    return unique.slice(0, totalLimit)
  }

  // 解析 OKX K线数据
  function parseOKXCandles(candles: string[][]): CandleData {
    // 反转数据，使时间从早到晚
    const reversed = [...candles].reverse()
    const dates: string[] = []
    const data: string[][] = []

    for (const candle of reversed) {
      const ts = parseInt(candle[0])
      const date = new Date(ts)
      dates.push(date.toISOString().slice(0, 19).replace('T', ' '))

      const open = parseFloat(candle[1])
      const high = parseFloat(candle[2])
      const low = parseFloat(candle[3])
      const close = parseFloat(candle[4])
      const volume = parseFloat(candle[5])

      data.push([
        open.toFixed(8),
        close.toFixed(8),
        low.toFixed(8),
        high.toFixed(8),
        volume.toFixed(4)
      ])
    }

    return { dates, data }
  }

  // 生成模拟数据 - 与原始 HTML 完全一致
  function generateMockData(pair: string): CandleData {
    const basePrices: Record<string, number> = {
      'BTC-USDT': 42000, 'ETH-USDT': 2200, 'SOL-USDT': 100,
      'XRP-USDT': 0.6, 'DOGE-USDT': 0.08, 'ADA-USDT': 0.5,
      'AVAX-USDT': 35, 'LINK-USDT': 14, 'DOT-USDT': 7,
      'MATIC-USDT': 0.8, 'UNI-USDT': 6, 'LTC-USDT': 70,
      'BCH-USDT': 230, 'ETC-USDT': 19, 'FIL-USDT': 5,
      'NEAR-USDT': 3, 'APT-USDT': 8, 'SUI-USDT': 1.2,
      'ARB-USDT': 1.5, 'OP-USDT': 3, 'PEPE-USDT': 0.000001,
      'WLD-USDT': 2.5, 'TIA-USDT': 5, 'SEI-USDT': 0.4,
      'STRK-USDT': 1.8,
      'BTC-USDT-SWAP': 42000, 'ETH-USDT-SWAP': 2200, 'SOL-USDT-SWAP': 100,
      'XRP-USDT-SWAP': 0.6, 'DOGE-USDT-SWAP': 0.08, 'ADA-USDT-SWAP': 0.5,
      'AVAX-USDT-SWAP': 35, 'LINK-USDT-SWAP': 14, 'DOT-USDT-SWAP': 7,
      'MATIC-USDT-SWAP': 0.8, 'UNI-USDT-SWAP': 6, 'LTC-USDT-SWAP': 70,
      'BCH-USDT-SWAP': 230, 'ETC-USDT-SWAP': 19, 'FIL-USDT-SWAP': 5,
      'NEAR-USDT-SWAP': 3, 'APT-USDT-SWAP': 8, 'SUI-USDT-SWAP': 1.2,
      'ARB-USDT-SWAP': 1.5, 'OP-USDT-SWAP': 3, 'PEPE-USDT-SWAP': 0.000001,
      'WLD-USDT-SWAP': 2.5, 'TIA-USDT-SWAP': 5, 'SEI-USDT-SWAP': 0.4,
      'STRK-USDT-SWAP': 1.8,
      'MEGA-USDT': 0.05, 'MEGA-USDT-SWAP': 0.05
    }

    const base = basePrices[pair] || 100
    const n = 300
    const dates: string[] = []
    const data: string[][] = []
    let price = base
    const startDate = new Date(Date.now() - n * 3600000)

    for (let i = 0; i < n; i++) {
      const date = new Date(startDate.getTime() + i * 3600000)
      dates.push(date.toISOString().slice(0, 19).replace('T', ' '))
      const change = (Math.random() - 0.48) * 0.02
      const trend = Math.sin(i / 50) * 0.001
      price *= (1 + change + trend)
      const open = price * (1 + (Math.random() - 0.5) * 0.002)
      const high = Math.max(open, price) * (1 + Math.random() * 0.01)
      const low = Math.min(open, price) * (1 - Math.random() * 0.01)
      data.push([open.toFixed(8), price.toFixed(8), low.toFixed(8), high.toFixed(8), (Math.random() * 10000).toFixed(4)])
    }

    return { dates, data }
  }

  // 加载数据（优先使用缓存）
  async function loadData(
    pair: string,
    timeframe: string,
    limit: string | number,
    forceRefresh = false
  ): Promise<CandleData> {
    const cacheKey = getCacheKey(pair, timeframe, limit)

    // 检查缓存
    if (!forceRefresh && globalCache.has(cacheKey)) {
      console.log(`使用缓存数据: ${cacheKey}`)
      return globalCache.get(cacheKey)!.data
    }

    showLoading(`正在从 OKX 获取 ${pair} ${timeframe} 数据...`)

    try {
      // 如果请求数量超过300，使用分批获取
      const limitNum = typeof limit === 'string' ? parseInt(limit) : limit
      const candles = limitNum > 300
        ? await fetchCandlesByLimit(pair, timeframe, limitNum)
        : await fetchOKXData(pair, timeframe, limit)
      const parsed = parseOKXCandles(candles)

      // 存入缓存
      globalCache.set(cacheKey, {
        pair,
        timeframe,
        limit: String(limit),
        data: parsed,
        timestamp: Date.now()
      })

      isRealData.value = true
      hideLoading()
      return parsed
    } catch (err) {
      console.warn('OKX API 失败，使用模拟数据:', (err as Error).message)
      isRealData.value = false
      showError('OKX API 连接失败，已切换到模拟数据')

      const mockData = generateMockData(pair)
      globalCache.set(cacheKey, {
        pair,
        timeframe,
        limit: String(limit),
        data: mockData,
        timestamp: Date.now()
      })

      hideLoading()
      return mockData
    }
  }

  // 批量获取数据
  async function loadMultipleData(
    pairs: string[],
    timeframes: string[],
    limit: string | number
  ): Promise<Map<string, CandleData>> {
    const results = new Map<string, CandleData>()
    const total = pairs.length * timeframes.length
    let completed = 0

    for (const pair of pairs) {
      for (const timeframe of timeframes) {
        try {
          const data = await loadData(pair, timeframe, limit)
          results.set(getCacheKey(pair, timeframe, limit), data)
          completed++
          showLoading(`正在获取数据... ${completed}/${total}`)
        } catch (err) {
          console.error(`获取 ${pair} ${timeframe} 数据失败:`, err)
        }
      }
    }

    hideLoading()
    return results
  }

  // 获取缓存数据（不触发请求）
  function getCachedData(pair: string, timeframe: string, limit: string | number): CandleData | null {
    const cacheKey = getCacheKey(pair, timeframe, limit)
    return globalCache.get(cacheKey)?.data || null
  }

  // 清除缓存
  function clearCache() {
    globalCache.clear()
  }

  return {
    loading,
    loadingText,
    error,
    isRealData,
    hasError,
    loadData,
    loadMultipleData,
    getCachedData,
    clearCache,
    showLoading,
    hideLoading,
    showError
  }
}
