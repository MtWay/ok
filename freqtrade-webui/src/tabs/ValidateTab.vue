<template>
  <div class="tab-content">
    <!-- 验证参数配置 - 与原始 HTML 一致 -->
    <div class="chart-card">
      <div class="chart-header">
        <div class="chart-title">🧪 滑动窗口验证设置</div>
        <div class="subtitle">模拟真实交易场景，验证策略可行性</div>
      </div>
      <div class="params-row">
        <div class="form-group">
          <label>数据总量</label>
          <select v-model="dataLimit" class="form-select">
            <option value="300">300条 (1次请求)</option>
            <option value="600">600条 (2次请求)</option>
            <option value="900">900条 (3次请求)</option>
          </select>
          <div class="hint">OKX API每次最多300条</div>
        </div>
        <div class="form-group">
          <label>优化窗口</label>
          <input v-model.number="windowSize" type="number" min="100" max="500" step="50">
          <div class="hint">用于参数优化的历史数据量</div>
        </div>
        <div class="form-group">
          <label>滑动步长</label>
          <input v-model.number="stepSize" type="number" min="1" max="20" step="1">
          <div class="hint">每次向后滑动多少根K线</div>
        </div>
        <div class="form-group">
          <label>预测窗口</label>
          <input v-model.number="predictSize" type="number" min="1" max="20" step="1">
          <div class="hint">预测未来多少根K线</div>
        </div>
        <div class="form-group">
          <label>初始资金 (USDT)</label>
          <input v-model.number="initialCapital" type="number" min="100" step="100">
        </div>
        <div class="form-group">
          <label>单次仓位 (USDT)</label>
          <input v-model.number="stakeAmount" type="number" min="10" step="10">
        </div>
        <div class="form-group">
          <label>综合分数阈值</label>
          <input v-model.number="scoreThreshold" type="range" min="0" max="100" step="5">
          <div class="range-value">{{ scoreThreshold }}</div>
          <div class="hint">低于此分数不操作</div>
        </div>
      </div>
    </div>

    <!-- 统计指标 -->
    <div v-if="result" class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">初始资金</div>
        <div class="stat-value neutral">{{ result.initialCapital.toFixed(2) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">最终资金</div>
        <div class="stat-value neutral">{{ result.finalCapital.toFixed(2) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总收益率</div>
        <div class="stat-value" :class="result.totalReturn >= 0 ? 'positive' : 'negative'">
          {{ result.totalReturn >= 0 ? '+' : '' }}{{ (result.totalReturn * 100).toFixed(2) }}%
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总交易次数</div>
        <div class="stat-value neutral">{{ result.trades.length }}</div>
        <div class="stat-hint">{{ winCount }}胜 / {{ lossCount }}负</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">胜率</div>
        <div class="stat-value" :class="winRate >= 0.5 ? 'positive' : 'negative'">
          {{ (winRate * 100).toFixed(1) }}%
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">盈亏比</div>
        <div class="stat-value neutral">{{ profitFactor.toFixed(2) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">最大回撤</div>
        <div class="stat-value" :class="maxDrawdown <= 0.2 ? 'positive' : 'negative'">
          {{ (maxDrawdown * 100).toFixed(2) }}%
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">夏普比率</div>
        <div class="stat-value neutral">{{ sharpeRatio.toFixed(2) }}</div>
      </div>
    </div>

    <!-- 资金曲线图 -->
    <ChartPanel
      v-if="result"
      ref="equityChartRef"
      title="📈 资金曲线"
      :option="equityChartOption"
    />

    <!-- K线图+买卖点 -->
    <ChartPanel
      v-if="result"
      ref="klineChartRef"
      title="📊 K线图与买卖点"
      :option="klineChartOption"
    />

    <!-- 轮次详情表 - 与原始 HTML 表头顺序一致 -->
    <div v-if="result" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📋 轮次详情</div>
      </div>
      <div class="table-container">
        <table class="trades-table">
          <thead>
            <tr>
              <th class="sortable" @click="handleRoundSort('round')">
                轮次 <span class="sort-icon">{{ getRoundSortIcon('round') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('timeRange')">
                时间范围 <span class="sort-icon">{{ getRoundSortIcon('timeRange') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('maFast')">
                最优参数 <span class="sort-icon">{{ getRoundSortIcon('maFast') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('signal')">
                信号 <span class="sort-icon">{{ getRoundSortIcon('signal') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('score')">
                综合评分 <span class="sort-icon">{{ getRoundSortIcon('score') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('operation')">
                操作 <span class="sort-icon">{{ getRoundSortIcon('operation') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('entryPrice')">
                开仓价 <span class="sort-icon">{{ getRoundSortIcon('entryPrice') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('exitPrice')">
                平仓价 <span class="sort-icon">{{ getRoundSortIcon('exitPrice') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('pnl')">
                盈亏 <span class="sort-icon">{{ getRoundSortIcon('pnl') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('capital')">
                资金 <span class="sort-icon">{{ getRoundSortIcon('capital') }}</span>
              </th>
              <th class="sortable" @click="handleRoundSort('closeReason')">
                平仓原因 <span class="sort-icon">{{ getRoundSortIcon('closeReason') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="round in sortedRoundDetails" :key="round.round">
              <td>{{ round.round }}</td>
              <td>{{ formatTimeRange(round.optimizeStart, round.predictEnd) }}</td>
              <td>MA{{ round.params.maFast }}/MA{{ round.params.maSlow }}</td>
              <td :class="getSignalClass(round.signal.trendSignal)">
                {{ getSignalText(round.signal.trendSignal) }}
              </td>
              <td :title="round.score?.action">
                <span :class="getScoreBadgeClass(round.score?.score, round.scoreValid)">
                  {{ round.score?.score || 0 }}分
                </span>
              </td>
              <td>{{ getOperationText(round) }}</td>
              <td>{{ round.trade ? round.trade.entryPrice.toFixed(2) : '-' }}</td>
              <td>{{ round.trade ? round.trade.exitPrice.toFixed(2) : '-' }}</td>
              <td :class="getPnlClass(round.trade?.pnl)">
                {{ round.trade ? (round.trade.pnl * 100).toFixed(2) + '%' : '-' }}
              </td>
              <td>{{ round.capital.toFixed(2) }}</td>
              <td>{{ round.trade ? round.trade.closeReason : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 交易记录表 - 与原始 HTML 表头顺序一致 -->
    <div v-if="result && result.trades.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📋 详细交易记录</div>
      </div>
      <div class="table-container">
        <table class="trades-table">
          <thead>
            <tr>
              <th class="sortable" @click="handleTradeSort('index')">
                序号 <span class="sort-icon">{{ getTradeSortIcon('index') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('direction')">
                方向 <span class="sort-icon">{{ getTradeSortIcon('direction') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('entryTime')">
                开仓时间 <span class="sort-icon">{{ getTradeSortIcon('entryTime') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('exitTime')">
                平仓时间 <span class="sort-icon">{{ getTradeSortIcon('exitTime') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('entryPrice')">
                开仓价 <span class="sort-icon">{{ getTradeSortIcon('entryPrice') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('exitPrice')">
                平仓价 <span class="sort-icon">{{ getTradeSortIcon('exitPrice') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('pnl')">
                收益率 <span class="sort-icon">{{ getTradeSortIcon('pnl') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('pnlAmount')">
                盈亏额 <span class="sort-icon">{{ getTradeSortIcon('pnlAmount') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('closeReason')">
                平仓原因 <span class="sort-icon">{{ getTradeSortIcon('closeReason') }}</span>
              </th>
              <th class="sortable" @click="handleTradeSort('holdingPeriod')">
                持仓时长 <span class="sort-icon">{{ getTradeSortIcon('holdingPeriod') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(trade, index) in sortedClosedTrades" :key="index" :class="{ 'open-row': !trade.exitTime }">
              <td>{{ trade.originalIndex + 1 }}</td>
              <td>
                <span :class="trade.direction === 'long' ? 'positive' : 'negative'" class="direction-tag">
                  {{ trade.direction === 'long' ? '做多' : '做空' }}
                </span>
              </td>
              <td>{{ trade.entryTime }}</td>
              <td>{{ trade.exitTime || '持仓中' }}</td>
              <td>{{ trade.entryPrice.toFixed(2) }}</td>
              <td>{{ trade.exitPrice ? trade.exitPrice.toFixed(2) : '-' }}</td>
              <td :class="getTradePnlClass(trade)">
                {{ getTradePnlText(trade) }}
              </td>
              <td :class="getTradePnlClass(trade)">
                {{ getTradePnlAmountText(trade) }}
              </td>
              <td>{{ trade.closeReason || '-' }}</td>
              <td>{{ trade.holdingPeriod > 0 ? trade.holdingPeriod + 'K' : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!result" class="empty-state">
      <p>点击「滑动窗口验证」查看结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ValidationResult, ValidationRoundDetail, Trade } from '@/types'
import ChartPanel from '@/components/ChartPanel.vue'

const props = defineProps<{
  result: ValidationResult | null
}>()

const emit = defineEmits<{
  getConfig: []
}>()

// 验证参数 - 与原始 HTML 默认值一致
const windowSize = ref(300)
const stepSize = ref(5)
const predictSize = ref(5)
const dataLimit = ref(600)
const scoreThreshold = ref(40)
const initialCapital = ref(10000)
const stakeAmount = ref(10000)

const equityChartRef = ref()
const klineChartRef = ref()

// 轮次表格排序状态
interface SortState {
  key: string
  order: 'asc' | 'desc'
}
const roundSortState = ref<SortState>({ key: 'round', order: 'asc' })
const tradeSortState = ref<SortState>({ key: 'index', order: 'asc' })

// 处理轮次表头点击排序
function handleRoundSort(key: string) {
  if (roundSortState.value.key === key) {
    roundSortState.value.order = roundSortState.value.order === 'asc' ? 'desc' : 'asc'
  } else {
    roundSortState.value.key = key
    roundSortState.value.order = 'asc'
  }
}

// 获取轮次排序图标
function getRoundSortIcon(key: string): string {
  if (roundSortState.value.key !== key) return '⇅'
  return roundSortState.value.order === 'asc' ? '↑' : '↓'
}

// 处理交易表头点击排序
function handleTradeSort(key: string) {
  if (tradeSortState.value.key === key) {
    tradeSortState.value.order = tradeSortState.value.order === 'asc' ? 'desc' : 'asc'
  } else {
    tradeSortState.value.key = key
    tradeSortState.value.order = 'asc'
  }
}

// 获取交易排序图标
function getTradeSortIcon(key: string): string {
  if (tradeSortState.value.key !== key) return '⇅'
  return tradeSortState.value.order === 'asc' ? '↑' : '↓'
}

// 过滤出已平仓的交易（用于显示）
const closedTrades = computed(() => {
  if (!props.result) return []
  return props.result.trades.filter(t => t.exitTime && t.exitTime !== '')
})

// 带原始索引的交易列表
const tradesWithIndex = computed(() => {
  return closedTrades.value.map((trade, index) => ({
    ...trade,
    originalIndex: index,
    pnlAmount: trade.pnlAmount || 0
  }))
})

// 排序后的交易列表
const sortedClosedTrades = computed(() => {
  const list = [...tradesWithIndex.value]
  const { key, order } = tradeSortState.value

  list.sort((a, b) => {
    let aVal: number | string
    let bVal: number | string

    switch (key) {
      case 'index':
        aVal = a.originalIndex
        bVal = b.originalIndex
        break
      case 'direction':
        aVal = a.direction === 'long' ? 1 : 0
        bVal = b.direction === 'long' ? 1 : 0
        break
      case 'entryTime':
        aVal = a.entryTime
        bVal = b.entryTime
        break
      case 'exitTime':
        aVal = a.exitTime || ''
        bVal = b.exitTime || ''
        break
      case 'entryPrice':
        aVal = a.entryPrice
        bVal = b.entryPrice
        break
      case 'exitPrice':
        aVal = a.exitPrice || 0
        bVal = b.exitPrice || 0
        break
      case 'pnl':
        aVal = a.pnl
        bVal = b.pnl
        break
      case 'pnlAmount':
        aVal = a.pnlAmount || 0
        bVal = b.pnlAmount || 0
        break
      case 'closeReason':
        aVal = a.closeReason || ''
        bVal = b.closeReason || ''
        break
      case 'holdingPeriod':
        aVal = a.holdingPeriod || 0
        bVal = b.holdingPeriod || 0
        break
      default:
        return 0
    }

    if (aVal < bVal) return order === 'asc' ? -1 : 1
    if (aVal > bVal) return order === 'asc' ? 1 : -1
    return 0
  })

  return list
})

// 排序后的轮次详情
const sortedRoundDetails = computed(() => {
  if (!props.result) return []
  const list = [...props.result.roundDetails]
  const { key, order } = roundSortState.value

  list.sort((a, b) => {
    let aVal: number | string
    let bVal: number | string

    switch (key) {
      case 'round':
        aVal = a.round
        bVal = b.round
        break
      case 'timeRange':
        aVal = a.optimizeStart
        bVal = b.optimizeStart
        break
      case 'maFast':
        aVal = a.params.maFast
        bVal = b.params.maFast
        break
      case 'signal':
        aVal = a.signal.trendSignal === 'long' ? 2 : a.signal.trendSignal === 'short' ? 1 : 0
        bVal = b.signal.trendSignal === 'long' ? 2 : b.signal.trendSignal === 'short' ? 1 : 0
        break
      case 'score':
        aVal = a.score?.score || 0
        bVal = b.score?.score || 0
        break
      case 'operation':
        aVal = getOperationText(a)
        bVal = getOperationText(b)
        break
      case 'entryPrice':
        aVal = a.trade?.entryPrice || 0
        bVal = b.trade?.entryPrice || 0
        break
      case 'exitPrice':
        aVal = a.trade?.exitPrice || 0
        bVal = b.trade?.exitPrice || 0
        break
      case 'pnl':
        aVal = a.trade?.pnl || 0
        bVal = b.trade?.pnl || 0
        break
      case 'capital':
        aVal = a.capital
        bVal = b.capital
        break
      case 'closeReason':
        aVal = a.trade?.closeReason || ''
        bVal = b.trade?.closeReason || ''
        break
      default:
        return 0
    }

    if (aVal < bVal) return order === 'asc' ? -1 : 1
    if (aVal > bVal) return order === 'asc' ? 1 : -1
    return 0
  })

  return list
})

// 统计数据
const winCount = computed(() => closedTrades.value.filter(t => t.pnl > 0).length)
const lossCount = computed(() => closedTrades.value.filter(t => t.pnl < 0).length)
const winRate = computed(() => closedTrades.value.length > 0 ? winCount.value / closedTrades.value.length : 0)

const profitFactor = computed(() => {
  if (closedTrades.value.length === 0) return 0
  const wins = closedTrades.value.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0)
  const losses = Math.abs(closedTrades.value.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0))
  return losses === 0 ? wins : wins / losses
})

const maxDrawdown = computed(() => {
  if (!props.result || props.result.equityCurve.length === 0) return 0
  let maxDd = 0
  let peak = props.result.equityCurve[0]?.capital || 0
  for (const point of props.result.equityCurve) {
    if (point.capital > peak) peak = point.capital
    const dd = (peak - point.capital) / peak
    if (dd > maxDd) maxDd = dd
  }
  return maxDd
})

const sharpeRatio = computed(() => {
  if (!props.result || props.result.equityCurve.length < 2) return 0
  const returns: number[] = []
  for (let i = 1; i < props.result.equityCurve.length; i++) {
    returns.push((props.result.equityCurve[i].capital - props.result.equityCurve[i - 1].capital) / props.result.equityCurve[i - 1].capital)
  }
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length
  const std = Math.sqrt(returns.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / returns.length)
  return std === 0 ? 0 : avg / std * Math.sqrt(365)
})

// 资金曲线图配置
const equityChartOption = computed(() => {
  if (!props.result) return {}

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a2236',
      borderColor: '#2d3748',
      textStyle: { color: '#e2e8f0' },
      formatter: function(params: any) {
        const data = props.result!.equityCurve[params[0].dataIndex]
        return `时间: ${data.time}<br/>资金: ${data.capital.toFixed(2)}<br/>持仓: ${data.position === 1 ? '多' : data.position === -1 ? '空' : '无'}`
      }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: props.result.equityCurve.map(p => p.time),
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#2d3748' } }
    },
    series: [{
      name: '资金',
      type: 'line',
      data: props.result.equityCurve.map(p => p.capital),
      smooth: true,
      lineStyle: { color: '#f59e0b', width: 2 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(245, 158, 11, 0.3)' },
            { offset: 1, color: 'rgba(245, 158, 11, 0)' }
          ]
        }
      }
    }]
  }
})

// K线图配置
const klineChartOption = computed(() => {
  if (!props.result) return {}

  const times = props.result.fullDates || props.result.positionHistory.map(p => p.time)
  const klineData = props.result.fullData
    ? props.result.fullData.map((d: string[]) => [parseFloat(d[0]), parseFloat(d[1]), parseFloat(d[2]), parseFloat(d[3])])
    : props.result.positionHistory.map(p => [p.open, p.close, p.low, p.high])

  // 数据采样（仅用于K线显示，不影响买卖点标记）
  const step = Math.max(1, Math.floor(times.length / 300))
  const sampleIndices: number[] = []
  for (let i = 0; i < times.length; i += step) {
    sampleIndices.push(i)
  }

  const markPoints: any[] = []

  // 显示所有已平仓交易的买卖点
  closedTrades.value.forEach(t => {
    const entryLabel = t.direction === 'long' ? '买' : '空'
    const entryColor = t.direction === 'long' ? '#10b981' : '#ef4444'
    markPoints.push({
      coord: [t.entryTime, t.entryPrice],
      value: entryLabel,
      itemStyle: { color: entryColor }
    })

    const exitLabel = t.direction === 'long' ? '卖' : '平'
    const exitColor = t.pnl >= 0 ? '#10b981' : '#ef4444'
    markPoints.push({
      coord: [t.exitTime, t.exitPrice],
      value: exitLabel,
      itemStyle: { color: exitColor }
    })
  })

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a2236',
      borderColor: '#2d3748',
      textStyle: { color: '#e2e8f0' }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: sampleIndices.map(i => times[i]),
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#2d3748' } },
      scale: true
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, height: 20, bottom: 10 }
    ],
    series: [{
      type: 'candlestick',
      data: sampleIndices.map(i => klineData[i]),
      itemStyle: {
        color: '#10b981',
        color0: '#ef4444',
        borderColor: '#10b981',
        borderColor0: '#ef4444'
      },
      markPoint: {
        data: markPoints,
        symbolSize: 40,
        label: { color: '#fff', fontSize: 12 }
      }
    }]
  }
})

// 格式化时间范围 - 与原始 HTML 一致
function formatTimeRange(optimizeStart: string, predictEnd: string): string {
  const formatTime = (timeStr: string) => {
    const parts = timeStr.split(' ')
    const date = parts[0]
    const time = parts[1] || ''
    return time ? `${date.slice(5)} ${time.slice(0, 5)}` : date.slice(5)
  }
  return `${formatTime(optimizeStart)} ~ ${formatTime(predictEnd)}`
}

// 获取信号文本
function getSignalText(trendSignal: string): string {
  if (trendSignal === 'long') return '金叉'
  if (trendSignal === 'short') return '死叉'
  return '观望'
}

// 获取信号样式类
function getSignalClass(trendSignal: string): string {
  if (trendSignal === 'long') return 'positive'
  if (trendSignal === 'short') return 'negative'
  return 'neutral'
}

// 获取评分徽章样式
function getScoreBadgeClass(score: number, scoreValid: boolean): string {
  if (!scoreValid) return 'score-invalid'
  if (score >= 80) return 'positive'
  if (score >= 60) return 'positive'
  if (score >= 40) return 'neutral'
  return 'negative'
}

// 获取操作文本
function getOperationText(round: ValidationRoundDetail): string {
  if (!round.scoreValid) return '分数不足'
  if (!round.trade) return '观望'
  return round.trade.direction === 'long' ? '做多→平仓' : '做空→平仓'
}

// 获取盈亏样式
function getPnlClass(pnl: number | undefined): string {
  if (pnl === undefined) return ''
  return pnl >= 0 ? 'positive' : 'negative'
}

// 监听激活状态，刷新图表大小
watch(() => props.result, () => {
  setTimeout(() => {
    equityChartRef.value?.resize()
    klineChartRef.value?.resize()
  }, 100)
})

// 暴露获取配置方法
function getParams() {
  return {
    windowSize: windowSize.value,
    stepSize: stepSize.value,
    predictSize: predictSize.value,
    dataLimit: parseInt(dataLimit.value as unknown as string),
    scoreThreshold: scoreThreshold.value,
    initialCapital: initialCapital.value,
    stakeAmount: stakeAmount.value
  }
}

// 获取交易盈亏样式类
function getTradePnlClass(trade: Trade): string {
  if (!trade.exitTime) return 'neutral'
  return trade.pnl >= 0 ? 'positive' : 'negative'
}

// 获取交易盈亏文本
function getTradePnlText(trade: Trade): string {
  if (!trade.exitTime) return '-'
  const sign = trade.pnl >= 0 ? '+' : ''
  return `${sign}${(trade.pnl * 100).toFixed(2)}%`
}

// 获取交易盈亏额文本
function getTradePnlAmountText(trade: Trade): string {
  if (!trade.exitTime) return '-'
  const sign = trade.pnl >= 0 ? '+' : ''
  return `${sign}${trade.pnlAmount?.toFixed(2)}`
}

defineExpose({
  getParams
})
</script>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.chart-card {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid var(--border-color);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 10px;
}

.chart-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.subtitle {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.params-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.form-group input,
.form-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.9rem;
}

.form-group input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.hint {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.range-value {
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-primary);
  margin-top: 4px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
}

.stat-card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--border-color);
  text-align: center;
}

.stat-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 1.3rem;
  font-weight: 700;
  font-family: 'Space Mono', monospace;
}

.stat-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 4px;
}

.positive {
  color: var(--accent-green);
}

.negative {
  color: var(--accent-red);
}

.neutral {
  color: var(--text-secondary);
}

.table-container {
  overflow-x: auto;
  max-height: 500px;
  overflow-y: auto;
}

.trades-table {
  width: 100%;
  border-collapse: collapse;
}

.trades-table th,
.trades-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
  font-family: 'Space Mono', monospace;
  font-size: 0.8rem;
}

.trades-table th {
  color: var(--text-secondary);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 0.7rem;
  position: sticky;
  top: 0;
  background: var(--bg-card);
}

.trades-table th.sortable {
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;
}

.trades-table th.sortable:hover {
  color: var(--accent-blue);
}

.trades-table th .sort-icon {
  margin-left: 4px;
  font-size: 0.6rem;
  opacity: 0.7;
}

.trades-table tr:hover {
  background: rgba(59, 130, 246, 0.05);
}

.direction-tag {
  font-weight: 700;
}

.score-invalid {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}
</style>
