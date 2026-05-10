<template>
  <div class="optimize-view">
    <ParamsPanel />

    <template v-if="store.optimizationResults.length > 0">
      <el-card class="optimize-card">
        <template #header>
          <div class="optimize-header">
            <div>
              <div class="optimize-title">
                <el-icon><Aim /></el-icon>
                <span>参数优化结果</span>
              </div>
              <div class="optimize-summary">{{ summaryText }}</div>
            </div>
          </div>
        </template>

        <div ref="heatmapRef" class="heatmap-container"></div>

        <el-table
          :data="topResults"
          style="width: 100%"
          class="optimize-table"
        >
          <el-table-column prop="rank" label="排名" width="60">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column prop="maFast" label="快线周期" width="100">
            <template #default="{ row }">MA{{ row.maFast }}</template>
          </el-table-column>
          <el-table-column prop="maSlow" label="慢线周期" width="100">
            <template #default="{ row }">MA{{ row.maSlow }}</template>
          </el-table-column>
          <el-table-column prop="totalReturn" label="总收益率" width="120">
            <template #default="{ row }">
              <span :class="row.totalReturn >= 0 ? 'profit-positive' : 'profit-negative'">
                {{ row.totalReturn >= 0 ? '+' : '' }}{{ (row.totalReturn * 100).toFixed(2) }}%
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="trades" label="交易次数" width="100" />
          <el-table-column prop="winRate" label="胜率" width="100">
            <template #default="{ row }">{{ (row.winRate * 100).toFixed(2) }}%</template>
          </el-table-column>
          <el-table-column prop="maxDrawdown" label="最大回撤" width="100">
            <template #default="{ row }">-{{ (row.maxDrawdown * 100).toFixed(2) }}%</template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="applyParams(row)">应用</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 最优参数交易记录 -->
      <el-card class="trades-card">
        <template #header>
          <div class="trades-header">
            <el-icon><Document /></el-icon>
            <span>最优参数交易记录 (MA{{ bestResult?.maFast }}/MA{{ bestResult?.maSlow }})</span>
          </div>
        </template>
        <TradesTable
          :trades="bestResult?.tradesList || []"
          empty-text="参数优化后将显示最优参数的交易记录"
        />
      </el-card>
    </template>

    <el-empty
      v-else
      description="点击「参数优化」按钮开始优化当前交易对参数"
      class="empty-state"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useBacktestStore } from '@/stores/backtest'
import ParamsPanel from '@/components/ParamsPanel.vue'
import TradesTable from '@/components/TradesTable.vue'
import * as echarts from 'echarts'
import type { OptimizationResult } from '@/types'

const store = useBacktestStore()
const heatmapRef = ref<HTMLDivElement>()
let heatmapChart: echarts.ECharts | null = null

const summaryText = computed(() => {
  if (store.optimizationResults.length === 0) return '点击「参数优化」按钮开始优化'
  const shortText = store.backtestParams.enableShort ? ' (双向)' : ' (仅做多)'
  const best = store.optimizationResults[0]
  return `共测试 ${store.optimizationResults.length} 组参数${shortText}，最优: MA${best.maFast}/MA${best.maSlow} 收益 ${(best.totalReturn * 100).toFixed(2)}%`
})

const topResults = computed(() => store.optimizationResults.slice(0, 10))
const bestResult = computed(() => store.optimizationResults[0] || null)

function initHeatmap() {
  if (!heatmapRef.value) return
  heatmapChart = echarts.init(heatmapRef.value)
  updateHeatmap()
}

function updateHeatmap() {
  if (!heatmapChart || store.optimizationResults.length === 0) return

  const fastRange = Array.from({ length: 17 }, (_, i) => i + 4)
  const slowRange = [20, 30, 40, 50, 60, 80, 100]

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
      const result = store.optimizationResults.find(r => r.maFast === fast && r.maSlow === slow)
      data.push([j, i, result ? (result.totalReturn * 100).toFixed(2) : 0])
    }
  }

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      position: 'top',
      backgroundColor: '#1a2236',
      borderColor: '#2d3748',
      textStyle: { color: '#e2e8f0' },
      formatter: function (params: any) {
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
        formatter: function (params: any) {
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
  }

  heatmapChart.setOption(option, true)
}

function applyParams(row: OptimizationResult) {
  store.backtestParams.maFast = row.maFast
  store.backtestParams.maSlow = row.maSlow
  store.runBacktestAction()
}

watch(() => store.optimizationResults, updateHeatmap, { deep: true })

onMounted(() => {
  initHeatmap()
  window.addEventListener('resize', () => heatmapChart?.resize())
})

onUnmounted(() => {
  heatmapChart?.dispose()
})
</script>

<style scoped lang="scss">
.optimize-view {
  width: 100%;
}

.optimize-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  margin-bottom: 20px;

  :deep(.el-card__header) {
    border-bottom: 1px solid var(--border-color);
    padding: 16px 20px;
  }
}

.optimize-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.optimize-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.optimize-summary {
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-family: 'Space Mono', monospace;
  margin-top: 4px;
}

.heatmap-container {
  width: 100%;
  height: 500px;
  margin-bottom: 20px;
}

.optimize-table {
  :deep(.el-table__header-wrapper) {
    th {
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-family: 'Space Mono', monospace;
      font-size: 0.75rem;
    }
  }

  :deep(.el-table__row) {
    background: transparent;

    &:hover {
      background: rgba(59, 130, 246, 0.05);
    }

    td {
      color: var(--text-primary);
      font-family: 'Space Mono', monospace;
      font-size: 0.85rem;
      border-bottom: 1px solid var(--border-color);
    }
  }
}

.trades-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);

  :deep(.el-card__header) {
    border-bottom: 1px solid var(--border-color);
    padding: 16px 20px;
  }
}

.trades-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.profit-positive {
  color: var(--accent-green);
}

.profit-negative {
  color: var(--accent-red);
}

.empty-state {
  margin-top: 60px;
  color: var(--text-secondary);
}
</style>
