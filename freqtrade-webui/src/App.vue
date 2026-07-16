<template>
  <div class="app">
    <!-- 加载遮罩 -->
    <div v-if="loading" class="loading-overlay active">
      <div class="spinner"></div>
      <div class="loading-text">{{ loadingText }}</div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-message active" @click="error = ''">
      {{ error }}
    </div>

    <div class="container">
      <!-- 主布局：左侧 Tab + 右侧内容 -->
      <div class="main-layout sidebar-layout">
        <!-- 左侧：Tab 导航 -->
        <aside class="sidebar-tabs-only">
          <button
            v-for="tab in tabs"
            :key="tab.name"
            class="sidebar-tab-btn"
            :class="{ active: activeTab === tab.name }"
            @click="activeTab = tab.name"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            <span class="tab-label">{{ tab.label }}</span>
          </button>
        </aside>

        <!-- 右侧：参数面板 + 展示区域 -->
        <main class="content-area-with-params">
          <!-- 顶部：参数面板 -->
          <ParamsPanel
            ref="paramsPanelRef"
            @runBacktest="handleRunBacktest"
            @optimize="handleOptimize"
            @scan="handleScan"
            @trendScan="handleTrendScan"
            @validate="handleValidate"
          />

          <!-- 下方：展示区域 -->
          <div class="display-area">
            <BacktestTab
              v-show="activeTab === 'backtest'"
              :result="backtestResult"
              :candle-data="currentCandleData"
            />
            <OptimizeTab
              v-show="activeTab === 'optimize'"
              :results="optimizeResults"
              :enable-short="currentConfig?.enableShort || false"
              @applyParams="handleApplyParams"
            />
            <ScanTab
            v-show="activeTab === 'scan'"
            :results="scanResults"
            @applyParams="handleScanApplyParams"
          />
            <TrendScanTab
              v-show="activeTab === 'trendscan'"
              :results="trendScanResults"
              @viewKline="handleViewKline"
            />
            <PositionsTab v-show="activeTab === 'positions'" />
            <NotifySettingsTab v-show="activeTab === 'notify'" />
            <ValidateTab
              v-show="activeTab === 'validate'"
              ref="validateTabRef"
              :result="validationResult"
            />
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { BacktestResult, CandleData, ScanResult, ValidationResult, Trade } from './types'
import { useDataFetch } from './composables/useDataFetch'
import { useBacktest } from './composables/useBacktest'
import ParamsPanel, { type BacktestConfig } from './components/ParamsPanel.vue'
import BacktestTab from './tabs/BacktestTab.vue'
import OptimizeTab from './tabs/OptimizeTab.vue'
import ScanTab from './tabs/ScanTab.vue'
import ValidateTab from './tabs/ValidateTab.vue'
import TrendScanTab from './tabs/TrendScanTab.vue'
import PositionsTab from './tabs/PositionsTab.vue'
import NotifySettingsTab from './tabs/NotifySettingsTab.vue'
import { scoreSymbol } from './composables/useTrendScore'
import type { TrendScanEntry } from './types'

const tabs = [
  { name: 'backtest', label: '回测结果', icon: '📈' },
  { name: 'optimize', label: '参数优化', icon: '🔍' },
  { name: 'scan', label: '多品种扫描', icon: '📊' },
  { name: 'trendscan', label: '趋势扫描', icon: '📈' },
  { name: 'positions', label: '持仓', icon: '💼' },
  { name: 'notify', label: '通知设置', icon: '🔔' },
  { name: 'validate', label: '滑动窗口验证', icon: '✅' }
]

const activeTab = ref('backtest')
const paramsPanelRef = ref<InstanceType<typeof ParamsPanel>>()
const validateTabRef = ref<InstanceType<typeof ValidateTab>>()

// 结果数据
const backtestResult = ref<BacktestResult | null>(null)
const optimizeResults = ref<BacktestResult[]>([])
const scanResults = ref<ScanResult[]>([])
const trendScanResults = ref<TrendScanEntry[]>([])
const validationResult = ref<ValidationResult | null>(null)
const currentCandleData = ref<CandleData | null>(null)
const currentConfig = ref<BacktestConfig | null>(null)
const lastDataConfig = ref<{ pair: string; timeframe: string; limit: string } | null>(null)

const { loading, loadingText, error, isRealData, loadData, clearCache, showLoading, hideLoading, showError } = useDataFetch()
const { runBacktestWithParams, calculateSignalScore, getCurrentSignal } = useBacktest()

// 检查是否需要重新获取数据
function needRefreshData(pair: string, timeframe: string, limit: string): boolean {
  if (!lastDataConfig.value) return true
  return lastDataConfig.value.pair !== pair ||
         lastDataConfig.value.timeframe !== timeframe ||
         lastDataConfig.value.limit !== limit
}

// 运行回测
async function handleRunBacktest(config: BacktestConfig) {
  currentConfig.value = config

  if (config.selectedPairs.length === 0) {
    showError('请至少选择一个交易对')
    return
  }

  const pair = config.selectedPairs[0]

  try {
    // 只有数据配置变化时才重新获取数据
    if (needRefreshData(pair, config.timeframe, config.limit)) {
      clearCache()
      lastDataConfig.value = { pair, timeframe: config.timeframe, limit: config.limit }
    }
    const data = await loadData(pair, config.timeframe, config.limit)
    currentCandleData.value = data

    const result = runBacktestWithParams(
      data.dates,
      data.data,
      config.maFast,
      config.maSlow,
      config.adxThreshold,
      config.stopLoss / 100,
      config.takeProfit / 100,
      config.initialCapital,
      config.stakeAmount,
      config.enableShort
    )

    backtestResult.value = result
    activeTab.value = 'backtest'
  } catch (err) {
    showError(`回测失败: ${(err as Error).message}`)
  }
}

// 参数优化
async function handleOptimize(config: BacktestConfig) {
  currentConfig.value = config

  if (config.selectedPairs.length === 0) {
    showError('请至少选择一个交易对')
    return
  }

  const pair = config.selectedPairs[0]

  try {
    // 只有数据配置变化时才重新获取数据
    if (needRefreshData(pair, config.timeframe, config.limit)) {
      clearCache()
      lastDataConfig.value = { pair, timeframe: config.timeframe, limit: config.limit }
    }
    const data = await loadData(pair, config.timeframe, config.limit)
    currentCandleData.value = data

    showLoading('正在进行参数优化，请稍候...')

    const results: BacktestResult[] = []
    const fastRange = Array.from({ length: 17 }, (_, i) => i + 4)
    const slowRange = [20, 30, 40, 50, 60, 80, 100]
    let completed = 0
    const total = fastRange.length * slowRange.length

    for (const fast of fastRange) {
      for (const slow of slowRange) {
        if (fast >= slow) continue
        const result = runBacktestWithParams(
          data.dates,
          data.data,
          fast,
          slow,
          config.adxThreshold,
          config.stopLoss / 100,
          config.takeProfit / 100,
          config.initialCapital,
          config.stakeAmount,
          config.enableShort
        )
        results.push(result)
        completed++
        if (completed % 5 === 0) {
          loadingText.value = `正在优化参数... ${completed}/${total}`
        }
      }
    }

    results.sort((a, b) => b.totalReturn - a.totalReturn)
    optimizeResults.value = results
    activeTab.value = 'optimize'
    hideLoading()
  } catch (err) {
    hideLoading()
    showError(`优化失败: ${(err as Error).message}`)
  }
}

// 多品种扫描
async function handleScan(config: BacktestConfig) {
  currentConfig.value = config

  if (config.selectedPairs.length === 0) {
    showError('请至少选择一个交易对')
    return
  }

  const timeframes = config.multiTimeframe ? ['1H', '4H', '1D'] : [config.timeframe]
  const results: ScanResult[] = []

  // 多品种扫描总是清除缓存，因为涉及多个不同配置
  clearCache()
  lastDataConfig.value = null

  showLoading(`正在扫描 ${config.selectedPairs.length} 个交易对 x ${timeframes.length} 个周期...`)

  let completed = 0
  const total = config.selectedPairs.length * timeframes.length

  for (const pair of config.selectedPairs) {
    for (const timeframe of timeframes) {
      try {
        const data = await loadData(pair, timeframe, config.limit)

        // 参数优化
        const fastRange = Array.from({ length: 17 }, (_, i) => i + 4)
        const slowRange = [30, 40, 50, 60, 80]
        let bestResult: (BacktestResult & { maFast?: number; maSlow?: number }) | null = null

        for (const fast of fastRange) {
          for (const slow of slowRange) {
            if (fast >= slow) continue
            const result = runBacktestWithParams(
              data.dates,
              data.data,
              fast,
              slow,
              config.adxThreshold,
              config.stopLoss / 100,
              config.takeProfit / 100,
              config.initialCapital,
              config.stakeAmount,
              config.enableShort
            )
            if (!bestResult || result.totalReturn > bestResult.totalReturn) {
              bestResult = result
            }
          }
        }

        if (bestResult) {
          const signal = getCurrentSignal(data.data, bestResult.maFast, bestResult.maSlow)
          const score = calculateSignalScore({
            trendSignal: signal.trendSignal,
            signalAge: signal.signalAge,
            adx: signal.currentAdx,
            winRate: bestResult.winRate,
            maxDrawdown: bestResult.maxDrawdown,
            totalReturn: bestResult.totalReturn,
            trades: bestResult.trades
          })

          results.push({
            pair,
            timeframe,
            maFast: bestResult.maFast,
            maSlow: bestResult.maSlow,
            totalReturn: bestResult.totalReturn,
            trades: bestResult.trades,
            winRate: bestResult.winRate,
            maxDrawdown: bestResult.maxDrawdown,
            trendSignal: signal.trendSignal,
            signalAge: signal.signalAge,
            currentAdx: signal.currentAdx,
            score
          })
        }

        completed++
        loadingText.value = `扫描进度: ${completed}/${total}`
      } catch (err) {
        console.error(`扫描 ${pair} ${timeframe} 失败:`, err)
      }
    }
  }

  scanResults.value = results
  activeTab.value = 'scan'
  hideLoading()
}

// 趋势质量扫描：不做参数网格搜索，直接对每个品种打分
async function handleTrendScan(config: BacktestConfig) {
  currentConfig.value = config

  if (config.selectedPairs.length === 0) {
    showError('请至少选择一个交易对')
    return
  }

  const timeframes = config.multiTimeframe ? ['1H', '4H', '1D'] : [config.timeframe]
  const results: TrendScanEntry[] = []

  clearCache()
  lastDataConfig.value = null

  showLoading(`正在扫描 ${config.selectedPairs.length} 个交易对 x ${timeframes.length} 个周期...`)

  let completed = 0
  const total = config.selectedPairs.length * timeframes.length

  for (const pair of config.selectedPairs) {
    for (const timeframe of timeframes) {
      try {
        const data = await loadData(pair, timeframe, config.limit)
        results.push(scoreSymbol(pair, timeframe, data.data, isRealData.value))
        completed++
        loadingText.value = `扫描进度: ${completed}/${total}`
      } catch (err) {
        console.error(`趋势扫描 ${pair} ${timeframe} 失败:`, err)
      }
    }
  }

  trendScanResults.value = results
  activeTab.value = 'trendscan'
  hideLoading()
}

// 滑动窗口验证
async function handleValidate(config: BacktestConfig) {
  currentConfig.value = config

  if (config.selectedPairs.length === 0) {
    showError('请至少选择一个交易对')
    return
  }

  const pair = config.selectedPairs[0]
  const validateParams = validateTabRef.value?.getParams()

  if (!validateParams) {
    showError('无法获取验证参数')
    return
  }

  try {
    showLoading(`正在获取 ${pair} 的${validateParams.dataLimit}条数据...`)

    // 滑动窗口验证使用自己的 dataLimit，需要检查是否需要刷新
    const dataLimitStr = String(validateParams.dataLimit)
    if (needRefreshData(pair, config.timeframe, dataLimitStr)) {
      clearCache()
      lastDataConfig.value = { pair, timeframe: config.timeframe, limit: dataLimitStr }
    }
    // 获取数据
    const allData = await loadData(pair, config.timeframe, validateParams.dataLimit)

    if (allData.data.length < validateParams.windowSize + validateParams.predictSize) {
      hideLoading()
      showError(`数据不足: 获取了${allData.data.length}条数据，但需要至少${validateParams.windowSize + validateParams.predictSize}条`)
      return
    }

    showLoading('正在进行滑动窗口验证...')

    const { dates, data } = allData
    const trades: Trade[] = []
    const equityCurve: Array<{ index: number; time: string; capital: number; position: number; unrealizedPnl?: number }> = [{
      index: 0,
      time: dates[0],
      capital: config.initialCapital,
      position: 0
    }]
    const roundDetails: ValidationResult['roundDetails'] = []

    const totalRounds = Math.floor((data.length - validateParams.windowSize - validateParams.predictSize) / validateParams.stepSize) + 1
    let currentRound = 0
    let capital = config.initialCapital
    let position = 0
    let entryPrice = 0
    let entryIndex = 0
    let entryTime = ''
    let openTrade: Trade | null = null

    for (let start = validateParams.windowSize; start <= data.length - validateParams.predictSize; start += validateParams.stepSize) {
      currentRound++
      const optimizeStart = start - validateParams.windowSize
      const optimizeEnd = start
      const predictEnd = Math.min(start + validateParams.predictSize, data.length)

      if (currentRound % 5 === 0 || currentRound === 1) {
        loadingText.value = `验证进度: ${currentRound}/${totalRounds} 轮`
      }

      // 优化窗口数据
      const optimizeDates = dates.slice(optimizeStart, optimizeEnd)
      const optimizeData = data.slice(optimizeStart, optimizeEnd)

      // 参数优化
      const fastRange = Array.from({ length: 17 }, (_, i) => i + 4)
      const slowRange = [20, 30, 40, 50, 60, 80, 100]
      let bestResult: (BacktestResult & { maFast?: number; maSlow?: number }) | null = null
      let bestSignal: { trendSignal: 'long' | 'short' | 'neutral'; signalAge: number; currentAdx: number } = { trendSignal: 'neutral', signalAge: 0, currentAdx: 0 }
      let bestScore = { score: 0, action: '观望', level: 'neutral' }

      for (const fast of fastRange) {
        for (const slow of slowRange) {
          if (fast >= slow) continue
          const result = runBacktestWithParams(
            optimizeDates,
            optimizeData,
            fast,
            slow,
            config.adxThreshold,
            config.stopLoss / 100,
            config.takeProfit / 100,
            config.initialCapital,
            config.stakeAmount,
            config.enableShort
          )

          const signal = getCurrentSignal(optimizeData, fast, slow)
          const score = calculateSignalScore({
            trendSignal: signal.trendSignal,
            signalAge: signal.signalAge,
            adx: signal.currentAdx,
            winRate: result.winRate,
            maxDrawdown: result.maxDrawdown,
            totalReturn: result.totalReturn,
            trades: result.trades
          })

          if (!bestResult || result.totalReturn > bestResult.totalReturn) {
            bestResult = { ...result, maFast: fast, maSlow: slow }
            bestSignal = signal
            bestScore = score
          }
        }
      }

      // 预测窗口数据
      const predictData = data.slice(optimizeEnd, predictEnd)
      const predictDates = dates.slice(optimizeEnd, predictEnd)

      const signalDirection = bestSignal.trendSignal === 'long' ? 1 : bestSignal.trendSignal === 'short' ? -1 : 0
      const scoreValid = bestScore.score >= validateParams.scoreThreshold

      let roundTrade: Trade | null = null

      for (let i = 0; i < predictData.length; i++) {
        const currentIdx = optimizeEnd + i
        const close = parseFloat(predictData[i][1])
        const currentTime = predictDates[i]

        let unrealizedPnl = 0
        if (position === 1) {
          unrealizedPnl = (close - entryPrice) / entryPrice
        } else if (position === -1) {
          unrealizedPnl = (entryPrice - close) / entryPrice
        }

        let shouldClose = false
        let closeReason = ''

        if (position !== 0) {
          if (unrealizedPnl <= -config.stopLoss / 100) {
            shouldClose = true
            closeReason = '止损'
          } else if (unrealizedPnl >= config.takeProfit / 100) {
            shouldClose = true
            closeReason = '止盈'
          } else if (position !== signalDirection && signalDirection !== 0 && scoreValid && i === 0) {
            shouldClose = true
            closeReason = '信号反向'
          }
        }

        // 执行平仓
        if (shouldClose && position !== 0) {
          const pnl = position === 1
            ? (close - entryPrice) / entryPrice
            : (entryPrice - close) / entryPrice

          const tradePnl = config.stakeAmount * pnl
          capital += tradePnl

          // 更新开仓记录为完整交易记录
          if (openTrade) {
            openTrade.exitIndex = currentIdx
            openTrade.exitTime = currentTime
            openTrade.exitPrice = close
            openTrade.pnl = pnl
            openTrade.pnlAmount = tradePnl
            openTrade.closeReason = closeReason
            openTrade.holdingPeriod = currentIdx - openTrade.entryIndex
            openTrade.round = currentRound
            roundTrade = openTrade
            openTrade = null
          }

          position = 0
          entryPrice = 0
        }

        // 开仓或反向调仓
        if (position === 0) {
          if (signalDirection === 1) {
            position = 1
            entryPrice = close
            entryIndex = currentIdx
            entryTime = currentTime

            // 记录开仓
            openTrade = {
              entryIndex,
              exitIndex: 0,
              entryTime,
              exitTime: '',
              entryPrice,
              exitPrice: 0,
              direction: 'long',
              pnl: 0,
              pnlAmount: 0,
              closeReason: '',
              holdingPeriod: 0,
              round: currentRound
            }
            trades.push(openTrade)
          } else if (signalDirection === -1 && config.enableShort) {
            position = -1
            entryPrice = close
            entryIndex = currentIdx
            entryTime = currentTime

            // 记录开仓
            openTrade = {
              entryIndex,
              exitIndex: 0,
              entryTime,
              exitTime: '',
              entryPrice,
              exitPrice: 0,
              direction: 'short',
              pnl: 0,
              pnlAmount: 0,
              closeReason: '',
              holdingPeriod: 0,
              round: currentRound
            }
            trades.push(openTrade)
          }
        }

        const currentEquity = capital + (position !== 0 ? config.stakeAmount * unrealizedPnl : 0)
        equityCurve.push({
          index: currentIdx,
          time: currentTime,
          capital: currentEquity,
          position,
          unrealizedPnl: position !== 0 ? unrealizedPnl : 0
        })
      }

      roundDetails.push({
        round: currentRound,
        optimizeStart: dates[optimizeStart],
        optimizeEnd: dates[optimizeEnd - 1],
        predictStart: dates[optimizeEnd],
        predictEnd: dates[predictEnd - 1],
        params: {
          ...bestResult!,
          maFast: bestResult!.maFast,
          maSlow: bestResult!.maSlow,
          trendSignal: bestSignal.trendSignal,
          signalAge: bestSignal.signalAge,
          currentAdx: bestSignal.currentAdx.toFixed(1),
          score: bestScore
        },
        signal: {
          trendSignal: bestSignal.trendSignal,
          signalAge: bestSignal.signalAge,
          currentAdx: bestSignal.currentAdx.toFixed(1)
        },
        score: bestScore,
        scoreValid,
        trade: roundTrade,
        capital
      })
    }

    // 验证结束，平仓
    if (position !== 0 && equityCurve.length > 0) {
      const lastClose = parseFloat(data[data.length - 1][1])
      const lastTime = dates[dates.length - 1]
      const lastIdx = data.length - 1

      const pnl = position === 1
        ? (lastClose - entryPrice) / entryPrice
        : (entryPrice - lastClose) / entryPrice

      const tradePnl = config.stakeAmount * pnl
      capital += tradePnl

      // 更新未平仓的记录
      if (openTrade) {
        openTrade.exitIndex = lastIdx
        openTrade.exitTime = lastTime
        openTrade.exitPrice = lastClose
        openTrade.pnl = pnl
        openTrade.pnlAmount = tradePnl
        openTrade.closeReason = '验证结束'
        openTrade.holdingPeriod = lastIdx - openTrade.entryIndex
        openTrade.round = currentRound
      }

      if (equityCurve.length > 0) {
        equityCurve[equityCurve.length - 1].capital = capital
      }
    }

    validationResult.value = {
      pair,
      timeframe: config.timeframe,
      initialCapital: config.initialCapital,
      finalCapital: capital,
      totalReturn: (capital - config.initialCapital) / config.initialCapital,
      trades,
      equityCurve,
      positionHistory: [],
      roundDetails,
      fullDates: dates,
      fullData: data,
      config: {
        windowSize: validateParams.windowSize,
        stepSize: validateParams.stepSize,
        predictSize: validateParams.predictSize,
        stakeAmount: config.stakeAmount
      }
    }

    activeTab.value = 'validate'
    hideLoading()
  } catch (err) {
    hideLoading()
    const errorMsg = err instanceof Error ? err.message : String(err)
    const errorStack = err instanceof Error ? err.stack : ''
    console.error('滑动窗口验证错误:', errorMsg, '\n堆栈:', errorStack)
    showError(`验证失败: ${errorMsg}`)
    throw err
  }
}

// 应用优化参数
async function handleApplyParams(maFast: number, maSlow: number) {
  if (!paramsPanelRef.value || !currentConfig.value) return

  // 更新配置参数
  const newConfig = {
    ...currentConfig.value,
    maFast,
    maSlow
  }

  // 切换回回测结果 tab
  activeTab.value = 'backtest'

  // 触发回测
  await handleRunBacktest(newConfig)
}

// 应用扫描结果参数
async function handleScanApplyParams(pair: string, timeframe: string, maFast: number, maSlow: number) {
  if (!currentConfig.value) return

  // 更新配置参数
  const newConfig = {
    ...currentConfig.value,
    selectedPairs: [pair],
    timeframe,
    maFast,
    maSlow
  }

  // 切换回回测结果 tab
  activeTab.value = 'backtest'

  // 触发回测
  await handleRunBacktest(newConfig)
}

// 查看K线图
async function handleViewKline(pair: string, timeframe: string) {
  if (!currentConfig.value) return

  // 使用当前配置参数，只更新交易对和周期
  const newConfig = {
    ...currentConfig.value,
    selectedPairs: [pair],
    timeframe
  }

  // 切换回回测结果 tab
  activeTab.value = 'backtest'

  // 触发回测
  await handleRunBacktest(newConfig)
}
</script>

<style>
/* CSS 变量 */
:root {
  --bg-primary: #0a0e17;
  --bg-secondary: #111827;
  --bg-card: #1a2236;
  --border-color: #2d3748;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --accent-green: #10b981;
  --accent-red: #ef4444;
  --accent-gold: #f59e0b;
  --accent-blue: #3b82f6;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Noto Serif SC', serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  overflow-x: hidden;
}

body::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-image:
    linear-gradient(rgba(59, 130, 246, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
  pointer-events: none;
  z-index: 0;
}

.app {
  position: relative;
  z-index: 1;
}

.container {
  margin: 0 auto;
  padding: 20px;
}

/* 头部样式 */
.header {
  text-align: center;
  padding: 40px 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 30px;
}

.header h1 {
  font-size: 2.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent-gold), var(--accent-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 2px;
}

.header p {
  color: var(--text-secondary);
  margin-top: 10px;
  font-size: 1rem;
}

.data-source-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 15px;
  padding: 8px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  font-size: 0.85rem;
  font-family: 'Space Mono', monospace;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-green);
  animation: pulse 2s infinite;
}

.dot.offline {
  background: var(--accent-red);
  animation: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* 主布局 */
.main-layout {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 侧边栏布局 */
.sidebar-layout {
  flex-direction: row;
  align-items: flex-start;
  gap: 20px;
}

/* 左侧：仅 Tab 导航 */
.sidebar-tabs-only {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-card);
  border-radius: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  position: sticky;
  top: 20px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}

.sidebar-tab-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 12px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-family: 'Noto Serif SC', serif;
  font-size: 0.9rem;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.3s;
  text-align: left;
}

.sidebar-tab-btn:hover {
  color: var(--text-primary);
  background: rgba(59, 130, 246, 0.1);
}

.sidebar-tab-btn.active {
  color: var(--accent-gold);
  background: rgba(245, 158, 11, 0.15);
  font-weight: 700;
  border-left: 3px solid var(--accent-gold);
}

.tab-icon {
  font-size: 1.2rem;
  width: 24px;
  text-align: center;
}

.tab-label {
  flex: 1;
}

/* 右侧：参数面板 + 展示区域 */
.content-area-with-params {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: calc(100vh - 200px);
  min-width: 0;
  overflow: hidden;
}

/* 展示区域 */
.display-area {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 24px;
  border: 1px solid var(--border-color);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 加载遮罩 */
.loading-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(10, 14, 23, 0.9);
  z-index: 1000;
  justify-content: center;
  align-items: center;
  flex-direction: column;
}

.loading-overlay.active {
  display: flex;
}

.spinner {
  width: 50px;
  height: 50px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-gold);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  color: var(--text-secondary);
  font-family: 'Space Mono', monospace;
}

/* 错误提示 */
.error-message {
  display: none;
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 16px 24px;
  background: rgba(239, 68, 68, 0.9);
  border-radius: 8px;
  color: #fff;
  z-index: 1001;
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
  cursor: pointer;
}

.error-message.active {
  display: block;
}

/* 响应式 */
@media (max-width: 1200px) {
  .sidebar-layout {
    flex-direction: column;
  }

  .sidebar-tabs-only {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    position: static;
    max-height: none;
  }

  .sidebar-tab-btn {
    flex: 1;
    min-width: 140px;
    justify-content: center;
  }

  .sidebar-tab-btn.active {
    border-left: none;
    border-bottom: 3px solid var(--accent-gold);
  }
}

@media (max-width: 768px) {
  .header h1 {
    font-size: 1.8rem;
  }

  .sidebar-tabs-only {
    padding: 8px;
  }

  .sidebar-tab-btn {
    min-width: 100px;
    padding: 10px 8px;
    font-size: 0.85rem;
  }

  .tab-icon {
    font-size: 1rem;
  }
}
</style>
