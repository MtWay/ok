<template>
  <div class="tab-content">
    <!-- 扫描结果汇总 -->
    <div v-if="results.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📊 多品种扫描结果</div>
        <div class="summary-text">
          共扫描 {{ results.length }} 个组合，强烈建议: {{ strongSignals.length }}，建议操作: {{ moderateSignals.length }}
        </div>
      </div>
    </div>

    <!-- 信号分布图 -->
    <ChartPanel
      v-if="results.length > 0"
      ref="signalChartRef"
      title="📈 信号强度分布"
      :option="signalChartOption"
    />

    <!-- 扫描结果表 -->
    <div v-if="results.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📋 扫描详情</div>
        <div class="filter-buttons">
          <button
            v-for="filter in filters"
            :key="filter.value"
            class="btn btn-small"
            :class="{ active: currentFilter === filter.value }"
            @click="currentFilter = filter.value"
          >
            {{ filter.label }}
          </button>
        </div>
      </div>
      <div class="table-container">
        <table class="trades-table">
          <thead>
            <tr>
              <th class="sortable" @click="handleSort('pair')">
                交易对 <span class="sort-icon">{{ getSortIcon('pair') }}</span>
              </th>
              <th class="sortable" @click="handleSort('timeframe')">
                周期 <span class="sort-icon">{{ getSortIcon('timeframe') }}</span>
              </th>
              <th class="sortable" @click="handleSort('trendSignal')">
                趋势 <span class="sort-icon">{{ getSortIcon('trendSignal') }}</span>
              </th>
              <th class="sortable" @click="handleSort('signalAge')">
                信号年龄 <span class="sort-icon">{{ getSortIcon('signalAge') }}</span>
              </th>
              <th class="sortable" @click="handleSort('currentAdx')">
                ADX <span class="sort-icon">{{ getSortIcon('currentAdx') }}</span>
              </th>
              <th class="sortable" @click="handleSort('score')">
                综合评分 <span class="sort-icon">{{ getSortIcon('score') }}</span>
              </th>
              <th class="sortable" @click="handleSort('action')">
                建议操作 <span class="sort-icon">{{ getSortIcon('action') }}</span>
              </th>
              <th class="sortable" @click="handleSort('totalReturn')">
                历史收益 <span class="sort-icon">{{ getSortIcon('totalReturn') }}</span>
              </th>
              <th class="sortable" @click="handleSort('winRate')">
                胜率 <span class="sort-icon">{{ getSortIcon('winRate') }}</span>
              </th>
              <th class="sortable" @click="handleSort('maxDrawdown')">
                回撤 <span class="sort-icon">{{ getSortIcon('maxDrawdown') }}</span>
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in sortedFilteredResults"
              :key="`${r.pair}-${r.timeframe}`"
              :class="getRowClass(r)"
            >
              <td>{{ r.pair }}</td>
              <td>{{ r.timeframe }}</td>
              <td :class="r.trendSignal">
                {{ r.trendSignal === 'long' ? '做多' : r.trendSignal === 'short' ? '做空' : '中性' }}
              </td>
              <td>{{ r.signalAge }} 天</td>
              <td>{{ r.currentAdx.toFixed(1) }}</td>
              <td :class="getScoreClass(r.score.score)">{{ r.score.score }}</td>
              <td :class="r.score.level">{{ r.score.action }}</td>
              <td :class="r.totalReturn >= 0 ? 'profit-positive' : 'profit-negative'">
                {{ r.totalReturn >= 0 ? '+' : '' }}{{ (r.totalReturn * 100).toFixed(2) }}%
              </td>
              <td>{{ (r.winRate * 100).toFixed(1) }}%</td>
              <td>-{{ (r.maxDrawdown * 100).toFixed(1) }}%</td>
              <td>
                <button class="btn btn-small btn-apply" @click="emitApplyParams(r)">
                  应用
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="results.length === 0" class="empty-state">
      <p>点击「多品种扫描」查看结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ScanResult } from '@/types'
import ChartPanel from '@/components/ChartPanel.vue'

const props = defineProps<{
  results: ScanResult[]
}>()

const emit = defineEmits<{
  applyParams: [pair: string, timeframe: string, maFast: number, maSlow: number]
}>()

function emitApplyParams(result: ScanResult) {
  emit('applyParams', result.pair, result.timeframe, result.maFast, result.maSlow)
}

const signalChartRef = ref()
const currentFilter = ref('all')

// 排序状态
interface SortState {
  key: string
  order: 'asc' | 'desc'
}
const sortState = ref<SortState>({ key: 'score', order: 'desc' })

const filters = [
  { label: '全部', value: 'all' },
  { label: '强烈建议', value: 'strong' },
  { label: '建议', value: 'moderate' },
  { label: '轻仓', value: 'weak' },
  { label: '做多', value: 'long' },
  { label: '做空', value: 'short' }
]

const strongSignals = computed(() => props.results.filter(r => r.score.level === 'strong'))
const moderateSignals = computed(() => props.results.filter(r => r.score.level === 'moderate'))

// 处理表头点击排序
function handleSort(key: string) {
  if (sortState.value.key === key) {
    sortState.value.order = sortState.value.order === 'asc' ? 'desc' : 'asc'
  } else {
    sortState.value.key = key
    sortState.value.order = 'asc'
  }
}

// 获取排序图标
function getSortIcon(key: string): string {
  if (sortState.value.key !== key) return '⇅'
  return sortState.value.order === 'asc' ? '↑' : '↓'
}

const filteredResults = computed(() => {
  let list = [...props.results]

  switch (currentFilter.value) {
    case 'strong':
      return list.filter(r => r.score.level === 'strong')
    case 'moderate':
      return list.filter(r => r.score.level === 'moderate')
    case 'weak':
      return list.filter(r => r.score.level === 'weak')
    case 'long':
      return list.filter(r => r.trendSignal === 'long')
    case 'short':
      return list.filter(r => r.trendSignal === 'short')
    default:
      return list
  }
})

// 排序后的过滤结果
const sortedFilteredResults = computed(() => {
  const list = [...filteredResults.value]
  const { key, order } = sortState.value

  list.sort((a, b) => {
    let aVal: number | string
    let bVal: number | string

    switch (key) {
      case 'pair':
        aVal = a.pair
        bVal = b.pair
        break
      case 'timeframe':
        aVal = a.timeframe
        bVal = b.timeframe
        break
      case 'trendSignal':
        aVal = a.trendSignal === 'long' ? 2 : a.trendSignal === 'short' ? 1 : 0
        bVal = b.trendSignal === 'long' ? 2 : b.trendSignal === 'short' ? 1 : 0
        break
      case 'signalAge':
        aVal = a.signalAge
        bVal = b.signalAge
        break
      case 'currentAdx':
        aVal = a.currentAdx
        bVal = b.currentAdx
        break
      case 'score':
        aVal = a.score.score
        bVal = b.score.score
        break
      case 'action':
        aVal = a.score.action
        bVal = b.score.action
        break
      case 'totalReturn':
        aVal = a.totalReturn
        bVal = b.totalReturn
        break
      case 'winRate':
        aVal = a.winRate
        bVal = b.winRate
        break
      case 'maxDrawdown':
        aVal = a.maxDrawdown
        bVal = b.maxDrawdown
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

// 信号分布图配置
const signalChartOption = computed(() => {
  if (props.results.length === 0) return {}

  // 按评分分组统计
  const ranges = [
    { min: 80, max: 100, label: '优秀(80-100)', count: 0 },
    { min: 60, max: 79, label: '良好(60-79)', count: 0 },
    { min: 40, max: 59, label: '一般(40-59)', count: 0 },
    { min: 20, max: 39, label: '较弱(20-39)', count: 0 },
    { min: 0, max: 19, label: '差(0-19)', count: 0 }
  ]

  props.results.forEach(r => {
    const score = r.score.score
    for (const range of ranges) {
      if (score >= range.min && score <= range.max) {
        range.count++
        break
      }
    }
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
      data: ranges.map(r => r.label),
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8', rotate: 30 }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#2d3748' } }
    },
    series: [{
      name: '数量',
      type: 'bar',
      data: ranges.map(r => ({
        value: r.count,
        itemStyle: {
          color: r.min >= 80 ? '#10b981' :
                 r.min >= 60 ? '#3b82f6' :
                 r.min >= 40 ? '#f59e0b' :
                 r.min >= 20 ? '#f97316' : '#ef4444'
        }
      })),
      barWidth: '50%',
      label: {
        show: true,
        position: 'top',
        color: '#e2e8f0'
      }
    }]
  }
})

function getRowClass(result: ScanResult): string {
  return result.score.level
}

function getScoreClass(score: number): string {
  if (score >= 70) return 'strong'
  if (score >= 50) return 'moderate'
  if (score >= 30) return 'weak'
  return 'neutral'
}

// 监听激活状态，刷新图表大小
watch(() => props.results, () => {
  setTimeout(() => {
    signalChartRef.value?.resize()
  }, 100)
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

.summary-text {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.filter-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: all 0.3s;
}

.btn:hover,
.btn.active {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
}

.btn-apply {
  background: var(--accent-gold);
  border-color: var(--accent-gold);
  color: #000;
  font-weight: 600;
}

.btn-apply:hover {
  background: #fbbf24;
  border-color: #fbbf24;
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

.trades-table tr.strong {
  background: rgba(16, 185, 129, 0.1);
}

.trades-table tr.moderate {
  background: rgba(59, 130, 246, 0.1);
}

.trades-table tr.weak {
  background: rgba(245, 158, 11, 0.1);
}

.long {
  color: var(--accent-green);
}

.short {
  color: var(--accent-red);
}

.neutral {
  color: var(--text-secondary);
}

.strong {
  color: var(--accent-green);
  font-weight: bold;
}

.moderate {
  color: var(--accent-blue);
}

.weak {
  color: var(--accent-gold);
}

.profit-positive {
  color: var(--accent-green);
}

.profit-negative {
  color: var(--accent-red);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}
</style>
