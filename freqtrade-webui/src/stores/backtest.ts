import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CandleData, BacktestParams, BacktestResult, OptimizationResult, ScanResult, PairConfig } from '@/types'
import { fetchOKXData, parseOKXCandles } from '@/api/okx'
import { runBacktest, runBacktestWithParams, generateMockData, calculateSignalScore, calculateMA, calculateADX } from '@/utils/backtest'

const CUSTOM_PAIRS_KEY = 'freqtrade_custom_pairs'

const spotPairs: PairConfig[] = [
  { symbol: 'BTC', name: 'BTC/USDT', type: 'SPOT' },
  { symbol: 'ETH', name: 'ETH/USDT', type: 'SPOT' },
  { symbol: 'SOL', name: 'SOL/USDT', type: 'SPOT' },
  { symbol: 'XRP', name: 'XRP/USDT', type: 'SPOT' },
  { symbol: 'DOGE', name: 'DOGE/USDT', type: 'SPOT' },
  { symbol: 'ADA', name: 'ADA/USDT', type: 'SPOT' },
  { symbol: 'AVAX', name: 'AVAX/USDT', type: 'SPOT' },
  { symbol: 'LINK', name: 'LINK/USDT', type: 'SPOT' },
  { symbol: 'DOT', name: 'DOT/USDT', type: 'SPOT' },
  { symbol: 'MATIC', name: 'MATIC/USDT', type: 'SPOT' },
  { symbol: 'UNI', name: 'UNI/USDT', type: 'SPOT' },
  { symbol: 'LTC', name: 'LTC/USDT', type: 'SPOT' },
  { symbol: 'BCH', name: 'BCH/USDT', type: 'SPOT' },
  { symbol: 'ETC', name: 'ETC/USDT', type: 'SPOT' },
  { symbol: 'FIL', name: 'FIL/USDT', type: 'SPOT' },
  { symbol: 'NEAR', name: 'NEAR/USDT', type: 'SPOT' },
  { symbol: 'APT', name: 'APT/USDT', type: 'SPOT', isNew: true },
  { symbol: 'SUI', name: 'SUI/USDT', type: 'SPOT', isNew: true },
  { symbol: 'ARB', name: 'ARB/USDT', type: 'SPOT' },
  { symbol: 'OP', name: 'OP/USDT', type: 'SPOT' },
  { symbol: 'PEPE', name: 'PEPE/USDT', type: 'SPOT', isNew: true },
  { symbol: 'WLD', name: 'WLD/USDT', type: 'SPOT', isNew: true },
  { symbol: 'TIA', name: 'TIA/USDT', type: 'SPOT', isNew: true },
  { symbol: 'SEI', name: 'SEI/USDT', type: 'SPOT', isNew: true },
  { symbol: 'STRK', name: 'STRK/USDT', type: 'SPOT', isNew: true },
  { symbol: 'MEGA', name: 'MEGA/USDT', type: 'SPOT', isNew: true },
]

const swapPairs: PairConfig[] = spotPairs.map(p => ({
  ...p,
  type: 'SWAP' as const,
  name: p.name.replace('/USDT', '/USDT 永续')
}))

const defaultPairs: PairConfig[] = [...spotPairs, ...swapPairs]

export const useBacktestStore = defineStore('backtest', () => {
  // State
  const contractType = ref<'SPOT' | 'SWAP'>('SPOT')
  const timeframe = ref('1H')
  const limit = ref('300')
  const selectedPairs = ref<string[]>(['BTC-USDT'])
  const customPairs = ref<string[]>([])
  const cachedData = ref<Map<string, CandleData>>(new Map())
  const isLoading = ref(false)
  const loadingText = ref('')
  const errorMessage = ref('')
  const isRealData = ref(false)

  const backtestParams = ref<BacktestParams>({
    maFast: 10,
    maSlow: 30,
    adxThreshold: 5,
    stopLoss: 0.10,
    takeProfit: 1.0,
    enableShort: true,
    initialCapital: 1000,
    stakeAmount: 1000,
  })

  const backtestResult = ref<BacktestResult | null>(null)
  const optimizationResults = ref<OptimizationResult[]>([])
  const scanResults = ref<ScanResult[]>([])
  const multiTimeframe = ref(false)

  // Getters
  const availablePairs = computed(() => {
    const base = defaultPairs.filter(p => p.type === contractType.value)
    const custom = customPairs.value.map(symbol => ({
      symbol,
      name: `${symbol}/USDT${contractType.value === 'SWAP' ? ' 永续' : ''}`,
      type: contractType.value,
      isCustom: true as const,
      isNew: false as const
    }))
    return [...base, ...custom]
  })

  const activePair = computed(() => selectedPairs.value[0] || '')

  // Actions
  function loadCustomPairs() {
    try {
      const saved = localStorage.getItem(CUSTOM_PAIRS_KEY)
      customPairs.value = saved ? JSON.parse(saved) : []
    } catch {
      customPairs.value = []
    }
  }

  function saveCustomPairs() {
    try {
      localStorage.setItem(CUSTOM_PAIRS_KEY, JSON.stringify(customPairs.value))
    } catch {
      // ignore
    }
  }

  function addCustomPair(symbol: string) {
    const upper = symbol.trim().toUpperCase()
    if (!upper || !/^[A-Z0-9]+$/.test(upper)) return false
    if (customPairs.value.includes(upper)) return false
    customPairs.value.push(upper)
    saveCustomPairs()
    return true
  }

  function removeCustomPair(symbol: string) {
    customPairs.value = customPairs.value.filter(p => p !== symbol)
    saveCustomPairs()
  }

  function togglePair(pair: string) {
    const idx = selectedPairs.value.indexOf(pair)
    if (idx > -1) {
      selectedPairs.value.splice(idx, 1)
    } else {
      selectedPairs.value.push(pair)
    }
  }

  function selectAllPairs() {
    selectedPairs.value = availablePairs.value.map(p => {
      const suffix = p.type === 'SWAP' ? '-USDT-SWAP' : '-USDT'
      return `${p.symbol}${suffix}`
    })
  }

  function deselectAllPairs() {
    selectedPairs.value = []
  }

  function getCacheKey(pair: string, tf: string, lim: string) {
    return `${pair}:${tf}:${lim}`
  }

  async function loadData(pair: string, forceRefresh = false): Promise<CandleData> {
    const key = getCacheKey(pair, timeframe.value, limit.value)
    if (!forceRefresh && cachedData.value.has(key)) {
      return cachedData.value.get(key)!
    }

    try {
      const candles = await fetchOKXData(pair, timeframe.value, limit.value)
      const parsed = parseOKXCandles(candles)
      cachedData.value.set(key, parsed)
      isRealData.value = true
      return parsed
    } catch {
      const mock = generateMockData(pair)
      cachedData.value.set(key, mock)
      isRealData.value = false
      return mock
    }
  }

  async function runBacktestAction() {
    if (selectedPairs.value.length === 0) {
      errorMessage.value = '请至少选择一个交易对'
      return
    }

    isLoading.value = true
    loadingText.value = `正在获取 ${activePair.value} 数据...`

    try {
      const data = await loadData(activePair.value)
      backtestResult.value = runBacktest(data.dates, data.data, backtestParams.value)
      errorMessage.value = ''
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '回测执行失败'
    } finally {
      isLoading.value = false
    }
  }

  async function optimizeParameters() {
    if (selectedPairs.value.length === 0) {
      errorMessage.value = '请至少选择一个交易对'
      return
    }

    isLoading.value = true
    loadingText.value = '正在进行参数优化...'

    try {
      const data = await loadData(activePair.value)
      const results: OptimizationResult[] = []
      const fastRange = Array.from({ length: 17 }, (_, i) => i + 4)
      const slowRange = [20, 30, 40, 50, 60, 80, 100]

      for (const fast of fastRange) {
        for (const slow of slowRange) {
          if (fast >= slow) continue
          const result = runBacktestWithParams(
            data.dates, data.data, fast, slow,
            backtestParams.value.adxThreshold,
            backtestParams.value.stopLoss,
            backtestParams.value.takeProfit,
            backtestParams.value.initialCapital,
            backtestParams.value.stakeAmount,
            backtestParams.value.enableShort
          )
          results.push(result)
        }
      }

      results.sort((a, b) => b.totalReturn - a.totalReturn)
      optimizationResults.value = results
      errorMessage.value = ''
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '参数优化失败'
    } finally {
      isLoading.value = false
    }
  }

  async function scanMultiplePairs() {
    if (selectedPairs.value.length === 0) {
      errorMessage.value = '请先选择至少一个交易对'
      return
    }

    const timeframes = multiTimeframe.value ? ['1H', '4H', '1D'] : [timeframe.value]
    isLoading.value = true

    try {
      const results: ScanResult[] = []
      const fastRange = Array.from({ length: 17 }, (_, i) => i + 4)
      const slowRange = [30, 40, 50, 60, 80]
      const total = selectedPairs.value.length * timeframes.length
      let completed = 0

      for (const pair of selectedPairs.value) {
        for (const tf of timeframes) {
          loadingText.value = `扫描进度: ${completed}/${total} - ${pair} ${tf}`

          try {
            const key = getCacheKey(pair, tf, limit.value)
            let data: CandleData

            if (cachedData.value.has(key)) {
              data = cachedData.value.get(key)!
            } else {
              try {
                const candles = await fetchOKXData(pair, tf, limit.value)
                data = parseOKXCandles(candles)
                cachedData.value.set(key, data)
              } catch {
                data = generateMockData(pair)
                cachedData.value.set(key, data)
              }
            }

            let bestResult: ScanResult | null = null

            for (const fast of fastRange) {
              for (const slow of slowRange) {
                if (fast >= slow) continue
                const result = runBacktestWithParams(
                  data.dates, data.data, fast, slow,
                  backtestParams.value.adxThreshold,
                  backtestParams.value.stopLoss,
                  backtestParams.value.takeProfit,
                  backtestParams.value.initialCapital,
                  backtestParams.value.stakeAmount,
                  backtestParams.value.enableShort
                )

                const maFastValues = calculateMA(data.data, fast)
                const maSlowValues = calculateMA(data.data, slow)
                const adxValues = calculateADX(data.data, 14)
                const lastIdx = data.data.length - 1
                const currFast = parseFloat(maFastValues[lastIdx] as string)
                const currSlow = parseFloat(maSlowValues[lastIdx] as string)
                const currentAdx = adxValues[lastIdx]

                let trendSignal: 'long' | 'short' | 'neutral' = 'neutral'
                let signalAge = 0

                if (currFast > currSlow) {
                  trendSignal = 'long'
                  for (let i = lastIdx; i > 0; i--) {
                    const f = parseFloat(maFastValues[i] as string)
                    const s = parseFloat(maSlowValues[i] as string)
                    const pf = parseFloat(maFastValues[i - 1] as string)
                    const ps = parseFloat(maSlowValues[i - 1] as string)
                    if (isNaN(f) || isNaN(s) || isNaN(pf) || isNaN(ps)) continue
                    if (pf <= ps && f > s) {
                      signalAge = lastIdx - i
                      break
                    }
                  }
                } else if (currFast < currSlow) {
                  trendSignal = 'short'
                  for (let i = lastIdx; i > 0; i--) {
                    const f = parseFloat(maFastValues[i] as string)
                    const s = parseFloat(maSlowValues[i] as string)
                    const pf = parseFloat(maFastValues[i - 1] as string)
                    const ps = parseFloat(maSlowValues[i - 1] as string)
                    if (isNaN(f) || isNaN(s) || isNaN(pf) || isNaN(ps)) continue
                    if (pf >= ps && f < s) {
                      signalAge = lastIdx - i
                      break
                    }
                  }
                }

                const score = calculateSignalScore({
                  trendSignal,
                  signalAge,
                  adx: currentAdx,
                  winRate: result.winRate,
                  maxDrawdown: result.maxDrawdown,
                  totalReturn: result.totalReturn,
                  trades: result.trades
                })

                const scanResult: ScanResult = {
                  ...result,
                  pair,
                  timeframe: tf,
                  fast,
                  slow,
                  trendSignal,
                  currentAdx: currentAdx.toFixed(1),
                  signalAge,
                  score
                }

                if (!bestResult || result.totalReturn > bestResult.totalReturn) {
                  bestResult = scanResult
                }
              }
            }

            if (bestResult) results.push(bestResult)
          } catch {
            // skip failed pairs
          }
          completed++
        }
      }

      results.sort((a, b) => b.totalReturn - a.totalReturn)
      scanResults.value = results
      errorMessage.value = ''
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : '扫描失败'
    } finally {
      isLoading.value = false
    }
  }

  function clearError() {
    errorMessage.value = ''
  }

  return {
    contractType,
    timeframe,
    limit,
    selectedPairs,
    customPairs,
    backtestParams,
    backtestResult,
    optimizationResults,
    scanResults,
    multiTimeframe,
    isLoading,
    loadingText,
    errorMessage,
    isRealData,
    availablePairs,
    activePair,
    cachedData,
    loadCustomPairs,
    addCustomPair,
    removeCustomPair,
    togglePair,
    selectAllPairs,
    deselectAllPairs,
    loadData,
    runBacktestAction,
    optimizeParameters,
    scanMultiplePairs,
    clearError,
    getCacheKey,
  }
})
