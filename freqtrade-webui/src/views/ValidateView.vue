<template>
  <div class="validate-view">
    <ParamsPanel />

    <el-card class="validate-card">
      <template #header>
        <div class="validate-header">
          <div>
            <div class="validate-title">
              <el-icon><CircleCheck /></el-icon>
              <span>移动区间验证</span>
            </div>
            <div class="validate-summary">{{ summaryText }}</div>
          </div>
          <div class="header-actions">
            <el-button
              type="primary"
              size="small"
              @click="runValidation"
              :loading="isValidating"
              :disabled="store.selectedPairs.length === 0"
            >
              <el-icon><VideoPlay /></el-icon>
              开始验证
            </el-button>
            <el-button
              v-if="validationResults.length > 0"
              size="small"
              @click="exportResults"
            >
              <el-icon><Download /></el-icon>
              导出结果
            </el-button>
          </div>
        </div>
      </template>

      <!-- 参数设置 -->
      <div class="params-section">
        <el-row :gutter="20">
          <el-col :span="6">
            <div class="param-item">
              <label>窗口大小</label>
              <el-input-number v-model="windowSize" :min="100" :max="500" :step="50" size="small" />
              <span class="param-unit">条K线</span>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="param-item">
              <label>步进大小</label>
              <el-input-number v-model="stepSize" :min="1" :max="50" :step="5" size="small" />
              <span class="param-unit">条K线</span>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="param-item">
              <label>验证条数</label>
              <el-input-number v-model="verifyBars" :min="5" :max="50" :step="5" size="small" />
              <span class="param-unit">条K线</span>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="param-item">
              <label>最小交易次数</label>
              <el-input-number v-model="minTrades" :min="3" :max="20" :step="1" size="small" />
              <span class="param-unit">次</span>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- 统计概览 -->
      <div v-if="summaryStats.total > 0" class="stats-overview">
        <div class="stat-item">
          <div class="stat-value">{{ summaryStats.total }}</div>
          <div class="stat-label">验证窗口数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" :class="getAccuracyClass(summaryStats.overallAccuracy)">
            {{ (summaryStats.overallAccuracy * 100).toFixed(1) }}%
          </div>
          <div class="stat-label">整体准确率</div>
        </div>
        <div class="stat-item">
          <div class="stat-value excellent">{{ summaryStats.excellentCount }}</div>
          <div class="stat-label">≥80分推荐</div>
        </div>
        <div class="stat-item">
          <div class="stat-value good">{{ summaryStats.goodCount }}</div>
          <div class="stat-label">60-79分推荐</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" :class="summaryStats.avgProfit >= 0 ? 'profit-positive' : 'profit-negative'">
            {{ (summaryStats.avgProfit * 100).toFixed(2) }}%
          </div>
          <div class="stat-label">平均收益</div>
        </div>
      </div>

      <!-- 按等级统计 -->
      <div v-if="levelStats.length > 0" class="level-stats">
        <div class="level-stats-title">按评分等级统计</div>
        <el-row :gutter="16">
          <el-col :span="6" v-for="stat in levelStats" :key="stat.level">
            <div class="level-card" :class="stat.level">
              <div class="level-name">{{ stat.name }}</div>
              <div class="level-metrics">
                <div class="metric">
                  <span class="metric-label">准确率</span>
                  <span class="metric-value" :class="getAccuracyClass(stat.accuracy)">
                    {{ (stat.accuracy * 100).toFixed(1) }}%
                  </span>
                </div>
                <div class="metric">
                  <span class="metric-label">次数</span>
                  <span class="metric-value">{{ stat.count }}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">平均收益</span>
                  <span class="metric-value" :class="stat.avgProfit >= 0 ? 'profit-positive' : 'profit-negative'">
                    {{ (stat.avgProfit * 100).toFixed(2) }}%
                  </span>
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- 验证结果表格 -->
      <el-table
        :data="validationResults"
        style="width: 100%"
        :empty-text="emptyText"
        class="validate-table"
        v-loading="isValidating"
        height="500"
      >
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="windowIndex" label="窗口" width="80">
          <template #default="{ row }">
            <span class="window-tag">#{{ row.windowIndex + 1 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="dateRange" label="时间范围" min-width="180">
          <template #default="{ row }">
            <div class="date-range">
              <div>{{ row.startDate }}</div>
              <div class="date-arrow">↓</div>
              <div>{{ row.endDate }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="score" label="综合评分" width="100">
          <template #default="{ row }">
            <span :class="getScoreClass(row.score.score)">{{ row.score.score }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="recommendation" label="推荐操作" min-width="120">
          <template #default="{ row }">
            <span :class="getActionClass(row.score.level)">{{ row.score.action }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="actualDirection" label="实际走势" width="100">
          <template #default="{ row }">
            <span :class="getDirectionClass(row.actualDirection)">
              {{ getDirectionText(row.actualDirection) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="isCorrect" label="判断" width="80">
          <template #default="{ row }">
            <el-tag :type="row.isCorrect ? 'success' : 'danger'" size="small">
              {{ row.isCorrect ? '✓' : '✗' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="priceChange" label="价格变化" width="120">
          <template #default="{ row }">
            <span :class="row.priceChange >= 0 ? 'profit-positive' : 'profit-negative'">
              {{ row.priceChange >= 0 ? '+' : '' }}{{ (row.priceChange * 100).toFixed(2) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="maxProfit" label="最大盈利" width="100">
          <template #default="{ row }">
            <span class="profit-positive">+{{ (row.maxProfit * 100).toFixed(2) }}%</span>
          </template>
        </el-table-column>
        <el-table-column prop="maxLoss" label="最大亏损" width="100">
          <template #default="{ row }">
            <span class="profit-negative">{{ (row.maxLoss * 100).toFixed(2) }}%</span>
          </template>
        </el-table-column>
        <el-table-column prop="trades" label="交易次数" width="90" />
        <el-table-column prop="winRate" label="胜率" width="90">
          <template #default="{ row }">
            <span :class="row.winRate >= 0.5 ? 'profit-positive' : 'profit-negative'">
              {{ (row.winRate * 100).toFixed(1) }}%
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBacktestStore } from '@/stores/backtest'
import { ElMessage } from 'element-plus'
import { CircleCheck, VideoPlay, Download } from '@element-plus/icons-vue'
import ParamsPanel from '@/components/ParamsPanel.vue'
import { calculateSignalScore, runBacktestWithParams, calculateMA, calculateADX } from '@/utils/backtest'
import type { SignalScore } from '@/types'

const store = useBacktestStore()

// 参数设置
const windowSize = ref(300)
const stepSize = ref(5)
const verifyBars = ref(20)
const minTrades = ref(5)
const isValidating = ref(false)

// 验证结果
const validationResults = ref<ValidationResult[]>([])

const emptyText = computed(() => {
  if (store.selectedPairs.length === 0) return '请先选择交易对'
  return '点击「开始验证」按钮进行移动区间验证'
})

const summaryText = computed(() => {
  if (validationResults.value.length === 0) {
    return `设置窗口大小 ${windowSize.value}，步进 ${stepSize.value}，验证接下来 ${verifyBars.value} 条K线`
  }
  return `共验证 ${validationResults.value.length} 个窗口，整体准确率 ${(summaryStats.value.overallAccuracy * 100).toFixed(1)}%`
})

// 统计概览
const summaryStats = computed(() => {
  if (validationResults.value.length === 0) {
    return { total: 0, overallAccuracy: 0, excellentCount: 0, goodCount: 0, avgProfit: 0 }
  }

  const total = validationResults.value.length
  const correct = validationResults.value.filter(r => r.isCorrect).length
  const excellentCount = validationResults.value.filter(r => r.score.level === 'excellent').length
  const goodCount = validationResults.value.filter(r => r.score.level === 'good').length
  const avgProfit = validationResults.value.reduce((sum, r) => sum + r.priceChange, 0) / total

  return {
    total,
    overallAccuracy: correct / total,
    excellentCount,
    goodCount,
    avgProfit
  }
})

// 按等级统计
const levelStats = computed(() => {
  const levels = ['excellent', 'good', 'hold', 'neutral'] as const
  const levelNames = { excellent: '≥80分 (最佳)', good: '60-79分 (推荐)', hold: '40-59分 (持有)', neutral: '<40分 (观望)' }

  return levels.map(level => {
    const items = validationResults.value.filter(r => r.score.level === level)
    const count = items.length
    const correct = items.filter(r => r.isCorrect).length
    const avgProfit = count > 0 ? items.reduce((sum, r) => sum + r.priceChange, 0) / count : 0

    return {
      level,
      name: levelNames[level],
      count,
      accuracy: count > 0 ? correct / count : 0,
      avgProfit
    }
  })
})

interface ValidationResult {
  windowIndex: number
  startDate: string
  endDate: string
  score: SignalScore
  actualDirection: 'up' | 'down' | 'neutral'
  isCorrect: boolean
  priceChange: number
  maxProfit: number
  maxLoss: number
  trades: number
  winRate: number
}

async function runValidation() {
  if (store.selectedPairs.length === 0) {
    ElMessage.warning('请先选择至少一个交易对')
    return
  }

  isValidating.value = true
  validationResults.value = []

  try {
    const pair = store.selectedPairs[0]
    const data = await store.loadData(pair)

    const results: ValidationResult[] = []
    const totalBars = data.data.length

    // 从最新数据开始，往前滑动窗口
    let windowIndex = 0
    for (let endIdx = totalBars - verifyBars.value; endIdx >= windowSize.value; endIdx -= stepSize.value) {
      const startIdx = endIdx - windowSize.value

      // 提取窗口数据
      const windowDates = data.dates.slice(startIdx, endIdx)
      const windowData = data.data.slice(startIdx, endIdx)

      // 在当前窗口计算推荐
      const result = runBacktestWithParams(
        windowDates,
        windowData,
        store.backtestParams.maFast,
        store.backtestParams.maSlow,
        store.backtestParams.adxThreshold,
        store.backtestParams.stopLoss,
        store.backtestParams.takeProfit,
        store.backtestParams.initialCapital,
        store.backtestParams.stakeAmount,
        store.backtestParams.enableShort
      )

      // 过滤交易次数太少的
      if (result.trades < minTrades.value) {
        continue
      }

      // 计算趋势信号
      const { trendSignal, signalAge, currentAdx } = calculateTrendInfo(
        windowData,
        store.backtestParams.maFast,
        store.backtestParams.maSlow
      )

      // 计算评分
      const score = calculateSignalScore({
        trendSignal,
        signalAge,
        adx: currentAdx,
        winRate: result.winRate,
        maxDrawdown: result.maxDrawdown,
        totalReturn: result.totalReturn,
        trades: result.trades
      })

      // 获取验证数据（窗口后的数据）
      const verifyData = data.data.slice(endIdx, endIdx + verifyBars.value)
      const validationMetrics = calculateValidationMetrics(verifyData, score)

      results.push({
        windowIndex,
        startDate: windowDates[0],
        endDate: windowDates[windowDates.length - 1],
        score,
        actualDirection: validationMetrics.direction,
        isCorrect: validationMetrics.isCorrect,
        priceChange: validationMetrics.priceChange,
        maxProfit: validationMetrics.maxProfit,
        maxLoss: validationMetrics.maxLoss,
        trades: result.trades,
        winRate: result.winRate
      })

      windowIndex++
    }

    validationResults.value = results
    ElMessage.success(`验证完成，共 ${results.length} 个窗口`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '验证失败')
  } finally {
    isValidating.value = false
  }
}

function calculateTrendInfo(data: number[][], fast: number, slow: number) {
  const maFastValues = calculateMA(data, fast)
  const maSlowValues = calculateMA(data, slow)
  const adxValues = calculateADX(data, 14)
  const lastIdx = data.length - 1

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

  return { trendSignal, signalAge, currentAdx }
}

function calculateValidationMetrics(verifyData: number[][], score: SignalScore) {
  if (verifyData.length === 0) {
    return { direction: 'neutral' as const, isCorrect: false, priceChange: 0, maxProfit: 0, maxLoss: 0 }
  }

  const firstPrice = verifyData[0][1]
  const lastPrice = verifyData[verifyData.length - 1][1]
  const priceChange = (lastPrice - firstPrice) / firstPrice

  // 计算最大盈利和最大亏损
  let maxProfit = 0
  let maxLoss = 0
  let peakPrice = firstPrice

  for (const candle of verifyData) {
    const price = candle[1]
    if (price > peakPrice) peakPrice = price

    const profitFromEntry = (price - firstPrice) / firstPrice
    const lossFromPeak = (price - peakPrice) / peakPrice

    if (profitFromEntry > maxProfit) maxProfit = profitFromEntry
    if (lossFromPeak < maxLoss) maxLoss = lossFromPeak
  }

  // 判断实际走势方向
  let actualDirection: 'up' | 'down' | 'neutral'
  if (priceChange > 0.005) {
    actualDirection = 'up'
  } else if (priceChange < -0.005) {
    actualDirection = 'down'
  } else {
    actualDirection = 'neutral'
  }

  // 判断推荐是否正确
  let isCorrect = false
  if (score.action.includes('做多')) {
    isCorrect = priceChange > 0
  } else if (score.action.includes('做空')) {
    isCorrect = priceChange < 0
  } else if (score.action.includes('观望')) {
    isCorrect = Math.abs(priceChange) < 0.02
  }

  return { direction: actualDirection, isCorrect, priceChange, maxProfit, maxLoss }
}

function getScoreClass(score: number) {
  if (score >= 80) return 'score-excellent'
  if (score >= 60) return 'score-good'
  if (score >= 40) return 'score-hold'
  return 'score-neutral'
}

function getActionClass(level: string) {
  return {
    excellent: 'action-excellent',
    good: 'action-good',
    hold: 'action-hold',
    neutral: 'action-neutral'
  }[level] || 'action-neutral'
}

function getDirectionClass(direction: string) {
  return {
    up: 'direction-up',
    down: 'direction-down',
    neutral: 'direction-neutral'
  }[direction] || 'direction-neutral'
}

function getDirectionText(direction: string) {
  return { up: '上涨', down: '下跌', neutral: '横盘' }[direction] || '未知'
}

function getAccuracyClass(accuracy: number) {
  if (accuracy >= 0.7) return 'accuracy-high'
  if (accuracy >= 0.5) return 'accuracy-medium'
  return 'accuracy-low'
}

function exportResults() {
  if (validationResults.value.length === 0) return

  const headers = [
    '序号', '窗口', '开始时间', '结束时间', '综合评分', '评分等级', '推荐操作',
    '实际走势', '判断', '价格变化(%)', '最大盈利(%)', '最大亏损(%)', '交易次数', '胜率(%)'
  ]

  let csv = '\uFEFF' + headers.join(',') + '\n'

  validationResults.value.forEach((r, i) => {
    const row = [
      i + 1,
      r.windowIndex + 1,
      r.startDate,
      r.endDate,
      r.score.score,
      r.score.level,
      r.score.action,
      getDirectionText(r.actualDirection),
      r.isCorrect ? '正确' : '错误',
      (r.priceChange * 100).toFixed(2),
      (r.maxProfit * 100).toFixed(2),
      (r.maxLoss * 100).toFixed(2),
      r.trades,
      (r.winRate * 100).toFixed(1)
    ]
    csv += row.join(',') + '\n'
  })

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
  link.href = URL.createObjectURL(blob)
  link.download = `移动区间验证_${store.selectedPairs[0]}_${timestamp}.csv`
  link.click()
  URL.revokeObjectURL(link.href)

  ElMessage.success('导出成功')
}
</script>

<style scoped lang="scss">
.validate-view {
  width: 100%;
}

.validate-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  .validate-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-primary);

    .el-icon {
      color: var(--accent-green);
    }
  }

  .validate-summary {
    font-size: 0.78rem;
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }
}

.params-section {
  padding: 16px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  margin-bottom: 20px;

  .param-item {
    display: flex;
    flex-direction: column;
    gap: 8px;

    label {
      font-size: 0.75rem;
      color: var(--text-secondary);
      font-weight: 500;
    }

    .el-input-number {
      width: 100%;
    }

    .param-unit {
      font-size: 0.7rem;
      color: var(--text-tertiary);
    }
  }
}

.stats-overview {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
  padding: 16px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);

  .stat-item {
    flex: 1;
    text-align: center;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);

      &.excellent { color: var(--accent-green); }
      &.good { color: var(--accent-blue); }
      &.profit-positive { color: var(--accent-green); }
      &.profit-negative { color: var(--accent-red); }
      &.accuracy-high { color: var(--accent-green); }
      &.accuracy-medium { color: var(--accent-gold); }
      &.accuracy-low { color: var(--accent-red); }
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--text-tertiary);
      margin-top: 4px;
    }
  }
}

.level-stats {
  margin-bottom: 20px;

  .level-stats-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 12px;
  }

  .level-card {
    padding: 16px;
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);

    &.excellent { border-left: 3px solid var(--accent-green); }
    &.good { border-left: 3px solid var(--accent-blue); }
    &.hold { border-left: 3px solid var(--accent-gold); }
    &.neutral { border-left: 3px solid var(--text-muted); }

    .level-name {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 12px;
    }

    .level-metrics {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .metric {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .metric-label {
          font-size: 0.75rem;
          color: var(--text-tertiary);
        }

        .metric-value {
          font-size: 0.85rem;
          font-weight: 600;

          &.profit-positive { color: var(--accent-green); }
          &.profit-negative { color: var(--accent-red); }
          &.accuracy-high { color: var(--accent-green); }
          &.accuracy-medium { color: var(--accent-gold); }
          &.accuracy-low { color: var(--accent-red); }
        }
      }
    }
  }
}

.validate-table {
  .window-tag {
    display: inline-block;
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .date-range {
    font-size: 0.75rem;
    color: var(--text-secondary);

    .date-arrow {
      color: var(--text-muted);
      font-size: 0.7rem;
    }
  }

  .score-excellent { color: var(--accent-green); font-weight: 700; }
  .score-good { color: var(--accent-blue); font-weight: 600; }
  .score-hold { color: var(--accent-gold); font-weight: 600; }
  .score-neutral { color: var(--text-muted); }

  .action-excellent {
    color: var(--accent-green);
    font-weight: 600;
    padding: 2px 8px;
    background: var(--accent-green-dim);
    border-radius: var(--radius-sm);
  }

  .action-good {
    color: var(--accent-blue);
    font-weight: 600;
    padding: 2px 8px;
    background: var(--accent-blue-dim);
    border-radius: var(--radius-sm);
  }

  .action-hold {
    color: var(--accent-gold);
    font-weight: 500;
    padding: 2px 8px;
    background: var(--accent-gold-dim);
    border-radius: var(--radius-sm);
  }

  .action-neutral {
    color: var(--text-tertiary);
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }

  .direction-up {
    color: var(--accent-green);
    font-weight: 600;
  }

  .direction-down {
    color: var(--accent-red);
    font-weight: 600;
  }

  .direction-neutral {
    color: var(--text-tertiary);
  }

  .profit-positive { color: var(--accent-green); }
  .profit-negative { color: var(--accent-red); }
}
</style>
