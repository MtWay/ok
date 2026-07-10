<template>
  <div class="tab-content">
    <!-- 优化结果汇总 -->
    <div v-if="results.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">🔍 参数优化结果</div>
        <div class="summary-text">{{ summaryText }}</div>
      </div>
    </div>

    <!-- 热力图 -->
    <ChartPanel
      v-if="results.length > 0"
      ref="heatmapChartRef"
      title="📊 收益率热力图"
      :option="heatmapOption"
    />

    <!-- 优化结果表 -->
    <div v-if="results.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📋 Top 10 参数组合</div>
      </div>
      <div class="table-container">
        <table class="trades-table">
          <thead>
            <tr>
              <th class="sortable" @click="handleSort('rank')">
                排名 <span class="sort-icon">{{ getSortIcon('rank') }}</span>
              </th>
              <th class="sortable" @click="handleSort('maFast')">
                快线 <span class="sort-icon">{{ getSortIcon('maFast') }}</span>
              </th>
              <th class="sortable" @click="handleSort('maSlow')">
                慢线 <span class="sort-icon">{{ getSortIcon('maSlow') }}</span>
              </th>
              <th class="sortable" @click="handleSort('totalReturn')">
                收益率 <span class="sort-icon">{{ getSortIcon('totalReturn') }}</span>
              </th>
              <th class="sortable" @click="handleSort('trades')">
                交易次数 <span class="sort-icon">{{ getSortIcon('trades') }}</span>
              </th>
              <th class="sortable" @click="handleSort('winRate')">
                胜率 <span class="sort-icon">{{ getSortIcon('winRate') }}</span>
              </th>
              <th class="sortable" @click="handleSort('maxDrawdown')">
                最大回撤 <span class="sort-icon">{{ getSortIcon('maxDrawdown') }}</span>
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in sortedTopResults" :key="i">
              <td>{{ i + 1 }}</td>
              <td>MA{{ r.maFast }}</td>
              <td>MA{{ r.maSlow }}</td>
              <td :class="r.totalReturn >= 0 ? 'profit-positive' : 'profit-negative'">
                {{ r.totalReturn >= 0 ? '+' : '' }}{{ (r.totalReturn * 100).toFixed(2) }}%
              </td>
              <td>{{ r.trades }}</td>
              <td>{{ (r.winRate * 100).toFixed(2) }}%</td>
              <td>-{{ (r.maxDrawdown * 100).toFixed(2) }}%</td>
              <td>
                <button class="btn btn-small" @click="applyParams(r.maFast, r.maSlow)">
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
      <p>点击「参数优化」查看结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import type { BacktestResult } from '../types'
import ChartPanel from '../components/ChartPanel.vue'

const props = defineProps<{
  results: BacktestResult[]
  enableShort: boolean
}>()

const emit = defineEmits<{
  applyParams: [maFast: number, maSlow: number]
}>()

const heatmapChartRef = ref()

// 排序状态
interface SortState {
  key: string
  order: 'asc' | 'desc'
}
const sortState = ref<SortState>({ key: 'rank', order: 'asc' })

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

// 排序后的 Top 10 结果
const sortedTopResults = computed(() => {
  const list = props.results.slice(0, 10).map((r, i) => ({ ...r, originalRank: i }))
  const { key, order } = sortState.value

  if (key === 'rank') {
    return order === 'asc' ? list : list.reverse()
  }

  list.sort((a, b) => {
    let aVal: number
    let bVal: number

    switch (key) {
      case 'maFast':
        aVal = a.maFast
        bVal = b.maFast
        break
      case 'maSlow':
        aVal = a.maSlow
        bVal = b.maSlow
        break
      case 'totalReturn':
        aVal = a.totalReturn
        bVal = b.totalReturn
        break
      case 'trades':
        aVal = a.trades
        bVal = b.trades
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

const summaryText = computed(() => {
  if (props.results.length === 0) return ''
  const best = props.results[0]
  const shortText = props.enableShort ? ' (双向)' : ' (仅做多)'
  return `共测试 ${props.results.length} 组参数${shortText}，最优: MA${best.maFast}/MA${best.maSlow} 收益 ${(best.totalReturn * 100).toFixed(2)}%`
})

// 热力图配置
const heatmapOption = computed(() => {
  if (props.results.length === 0) return {} as EChartsOption

  // 提取所有唯一的 fast 和 slow 值
  const fastSet = new Set(props.results.map(r => r.maFast))
  const slowSet = new Set(props.results.map(r => r.maSlow))
  const fastRange = Array.from(fastSet).sort((a, b) => a - b)
  const slowRange = Array.from(slowSet).sort((a, b) => a - b)

  const xData = slowRange.map(s => 'MA' + s)
  const yData = fastRange.map(f => 'MA' + f)
  const data: (number | string)[][] = []

  for (let i = 0; i < fastRange.length; i++) {
    for (let j = 0; j < slowRange.length; j++) {
      const fast = fastRange[i]
      const slow = slowRange[j]
      if (fast >= slow) {
        data.push([j, i, '-'])
        continue
      }
      const result = props.results.find(r => r.maFast === fast && r.maSlow === slow)
      data.push([j, i, result ? (result.totalReturn * 100).toFixed(2) : 0])
    }
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      position: 'top',
      backgroundColor: '#1a2236',
      borderColor: '#2d3748',
      textStyle: { color: '#e2e8f0' },
      formatter: function(params: any) {
        if (params.data[2] === '-') return '无效参数'
        return `${xData[params.data[0]]} / ${yData[params.data[1]]}<br/>收益率: ${params.data[2]}%`
      }
    },
    grid: { left: '10%', right: '10%', bottom: '15%', top: '10%' },
    xAxis: {
      type: 'category',
      data: xData,
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8', rotate: 45 }
    },
    yAxis: {
      type: 'category',
      data: yData,
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' }
    },
    visualMap: {
      min: -50,
      max: 100,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '0%',
      textStyle: { color: '#94a3b8' },
      inRange: {
        color: ['#ef4444', '#1a2236', '#10b981']
      }
    },
    series: [{
      name: '收益率',
      type: 'heatmap',
      data: data,
      label: {
        show: true,
        color: '#e2e8f0',
        fontSize: 10,
        formatter: function(params: any) {
          return params.data[2] === '-' ? '' : params.data[2] + '%'
        }
      },
      emphasis: {
        itemStyle: {
          borderColor: '#f59e0b',
          borderWidth: 2
        }
      }
    }]
  } as EChartsOption
})

function applyParams(maFast: number, maSlow: number) {
  emit('applyParams', maFast, maSlow)
}

// 监听激活状态，刷新图表大小
watch(() => props.results, () => {
  setTimeout(() => {
    heatmapChartRef.value?.resize()
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

.table-container {
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}

.trades-table {
  width: 100%;
  border-collapse: collapse;
}

.trades-table th,
.trades-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
  font-family: 'Space Mono', monospace;
  font-size: 0.85rem;
}

.trades-table th {
  color: var(--text-secondary);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 0.75rem;
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
  font-size: 0.7rem;
  opacity: 0.7;
}

.trades-table tr:hover {
  background: rgba(59, 130, 246, 0.05);
}

.profit-positive {
  color: var(--accent-green);
}

.profit-negative {
  color: var(--accent-red);
}

.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--accent-blue);
  color: #fff;
  transition: all 0.3s;
}

.btn:hover {
  opacity: 0.8;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}
</style>
