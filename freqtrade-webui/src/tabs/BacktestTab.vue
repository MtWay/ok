<template>
  <div class="tab-content">
    <!-- 统计指标 -->
    <StatsPanel v-if="result" :stats="stats" />

    <!-- 资金曲线图 -->
    <ChartPanel
      v-if="result"
      ref="equityChartRef"
      title="📈 资金曲线"
      :option="equityChartOption"
    />

    <!-- K线图 -->
    <ChartPanel
      v-if="result"
      ref="klineChartRef"
      title="🕯 K线与买卖点"
      :option="klineChartOption"
      legend="<span style='color: #10b981;'>●</span> 买入点 <span style='color: #ef4444; margin-left: 10px;'>●</span> 卖出点"
    />

    <!-- 交易记录表 -->
    <div v-if="result && result.tradesList.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📋 交易记录</div>
      </div>
      <div class="table-container">
        <table class="trades-table">
          <thead>
            <tr>
              <th class="sortable" @click="handleSort('index')">
                序号 <span class="sort-icon">{{ getSortIcon('index') }}</span>
              </th>
              <th class="sortable" @click="handleSort('direction')">
                方向 <span class="sort-icon">{{ getSortIcon('direction') }}</span>
              </th>
              <th class="sortable" @click="handleSort('entryTime')">
                开仓时间 <span class="sort-icon">{{ getSortIcon('entryTime') }}</span>
              </th>
              <th class="sortable" @click="handleSort('exitTime')">
                平仓时间 <span class="sort-icon">{{ getSortIcon('exitTime') }}</span>
              </th>
              <th class="sortable" @click="handleSort('entryPrice')">
                开仓价 <span class="sort-icon">{{ getSortIcon('entryPrice') }}</span>
              </th>
              <th class="sortable" @click="handleSort('exitPrice')">
                平仓价 <span class="sort-icon">{{ getSortIcon('exitPrice') }}</span>
              </th>
              <th class="sortable" @click="handleSort('pnl')">
                收益率 <span class="sort-icon">{{ getSortIcon('pnl') }}</span>
              </th>
              <th class="sortable" @click="handleSort('pnlAmount')">
                盈亏额 <span class="sort-icon">{{ getSortIcon('pnlAmount') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(trade, index) in sortedTradesList" :key="index">
              <td>{{ trade.originalIndex + 1 }}</td>
              <td :class="trade.direction === 'long' ? 'profit-positive' : 'profit-negative'">
                {{ trade.direction === 'long' ? '做多' : '做空' }}
              </td>
              <td>{{ trade.entryTime }}</td>
              <td>{{ trade.exitTime }}</td>
              <td>{{ trade.entryPrice.toFixed(4) }}</td>
              <td>{{ trade.exitPrice.toFixed(4) }}</td>
              <td :class="trade.pnl > 0 ? 'profit-positive' : 'profit-negative'">
                {{ trade.pnl > 0 ? '+' : '' }}{{ (trade.pnl * 100).toFixed(2) }}%
              </td>
              <td :class="trade.pnl > 0 ? 'profit-positive' : 'profit-negative'">
                {{ trade.pnl > 0 ? '+' : '' }}{{ (trade.pnl * 1000).toFixed(2) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!result" class="empty-state">
      <p>点击「运行回测」查看结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import type { BacktestResult, CandleData } from '../types'
import { useBacktest } from '../composables/useBacktest'
import StatsPanel from '../components/StatsPanel.vue'
import ChartPanel from '../components/ChartPanel.vue'

const props = defineProps<{
  result: BacktestResult | null
  candleData: CandleData | null
}>()

const equityChartRef = ref()
const klineChartRef = ref()

const { calculateMA } = useBacktest()

// 排序状态
interface SortState {
  key: string
  order: 'asc' | 'desc'
}
const sortState = ref<SortState>({ key: 'index', order: 'asc' })

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

// 带原始索引的交易列表
const tradesWithIndex = computed(() => {
  if (!props.result) return []
  return props.result.tradesList.map((trade, index) => ({
    ...trade,
    originalIndex: index,
    pnlAmount: trade.pnl * 1000
  }))
})

// 排序后的交易列表
const sortedTradesList = computed(() => {
  const list = [...tradesWithIndex.value]
  const { key, order } = sortState.value

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
        aVal = a.exitTime
        bVal = b.exitTime
        break
      case 'entryPrice':
        aVal = a.entryPrice
        bVal = b.entryPrice
        break
      case 'exitPrice':
        aVal = a.exitPrice
        bVal = b.exitPrice
        break
      case 'pnl':
        aVal = a.pnl
        bVal = b.pnl
        break
      case 'pnlAmount':
        aVal = a.pnlAmount
        bVal = b.pnlAmount
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

const stats = computed(() => {
  if (!props.result) {
    return { totalReturn: 0, trades: 0, winRate: 0, maxDrawdown: 0 }
  }
  return {
    totalReturn: props.result.totalReturn,
    trades: props.result.trades,
    winRate: props.result.winRate,
    maxDrawdown: props.result.maxDrawdown
  }
})

// 资金曲线图配置
const equityChartOption = computed(() => {
  if (!props.result || !props.candleData) return {} as EChartsOption

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
      data: props.candleData.dates,
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
      data: props.result.equityCurve,
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
  } as EChartsOption
})

// K线图配置
const klineChartOption = computed(() => {
  if (!props.result || !props.candleData) return {} as EChartsOption

  const maFast = calculateMA(props.candleData.data, props.result.maFast)
  const maSlow = calculateMA(props.candleData.data, props.result.maSlow)

  // 买卖标记点
  const buyPoints = props.result.tradesList.map(t => ({
    name: '买入',
    coord: [t.entryIndex, t.entryPrice],
    value: '买',
    itemStyle: { color: '#10b981' }
  }))

  const sellPoints = props.result.tradesList.map(t => ({
    name: '卖出',
    coord: [t.exitIndex, t.exitPrice],
    value: '卖',
    itemStyle: { color: '#ef4444' }
  }))

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: '#1a2236',
      borderColor: '#2d3748',
      textStyle: { color: '#e2e8f0' }
    },
    legend: {
      data: ['K线', `MA${props.result.maFast}`, `MA${props.result.maSlow}`],
      textStyle: { color: '#94a3b8' }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: props.candleData.dates,
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' }
    },
    yAxis: {
      scale: true,
      axisLine: { lineStyle: { color: '#2d3748' } },
      axisLabel: { color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#2d3748' } }
    },
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: props.candleData.data.map(d => [d[0], d[1], d[2], d[3]]),
        itemStyle: {
          color: '#10b981',
          color0: '#ef4444',
          borderColor: '#10b981',
          borderColor0: '#ef4444'
        },
        markPoint: {
          data: [...buyPoints, ...sellPoints],
          symbolSize: 40,
          label: { fontSize: 10 }
        }
      },
      {
        name: `MA${props.result.maFast}`,
        type: 'line',
        data: maFast,
        smooth: true,
        lineStyle: { color: '#f59e0b', width: 1 },
        symbol: 'none'
      },
      {
        name: `MA${props.result.maSlow}`,
        type: 'line',
        data: maSlow,
        smooth: true,
        lineStyle: { color: '#3b82f6', width: 1 },
        symbol: 'none'
      }
    ]
  } as EChartsOption
})

// 监听激活状态，刷新图表大小
watch(() => props.result, () => {
  setTimeout(() => {
    equityChartRef.value?.resize()
    klineChartRef.value?.resize()
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
}

.chart-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
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

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}
</style>
