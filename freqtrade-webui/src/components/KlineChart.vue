<template>
  <div class="chart-card">
    <div class="chart-header">
      <div class="chart-icon">
        <el-icon :size="16"><Histogram /></el-icon>
      </div>
      <div class="chart-title">
        <h3>K线与交易信号</h3>
        <span class="chart-subtitle">Candlestick & Signals</span>
      </div>
    </div>
    <div ref="chartRef" class="chart-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import type { Signal } from '@/types'
import { Histogram } from '@element-plus/icons-vue'

const props = defineProps<{
  dates: string[]
  data: number[][]
  maFast: (number | string)[]
  maSlow: (number | string)[]
  signals: Signal[]
}>()

const chartRef = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

function initChart() {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
  updateChart()
}

function updateChart() {
  if (!chart || !props.dates.length) return

  const klineData = props.data.map(d => [d[0], d[1], d[2], d[3]])
  const step = Math.max(1, Math.floor(props.dates.length / 500))
  const sampleIndices: number[] = []
  for (let i = 0; i < props.dates.length; i += step) sampleIndices.push(i)

  const markPoints = props.signals
    .filter(s => sampleIndices.includes(s.index))
    .map(s => {
      const labels: Record<string, string> = { buy: '买', sell: '卖', short: '空', cover: '平' }
      const colors: Record<string, string> = { buy: '#22c55e', sell: '#ef4444', short: '#ef4444', cover: '#22c55e' }
      return {
        name: s.type,
        coord: [props.dates[s.index], s.price],
        value: labels[s.type] || s.type,
        itemStyle: { color: colors[s.type] || '#94a3b8' }
      }
    })

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    grid: {
      left: '2%',
      right: '3%',
      bottom: '3%',
      top: '12%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: sampleIndices.map(i => props.dates[i]),
      axisLine: { lineStyle: { color: 'var(--border-light)' } },
      axisLabel: {
        color: 'var(--text-tertiary)',
        fontFamily: 'JetBrains Mono',
        fontSize: 10
      },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: {
        color: 'var(--text-tertiary)',
        fontFamily: 'JetBrains Mono',
        fontSize: 10
      },
      splitLine: {
        lineStyle: {
          color: 'var(--border-subtle)',
          type: [4, 4]
        }
      },
      scale: true
    },
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: sampleIndices.map(i => klineData[i]),
        itemStyle: {
          color: '#22c55e',
          color0: '#ef4444',
          borderColor: '#22c55e',
          borderColor0: '#ef4444',
          borderWidth: 1
        },
        markPoint: {
          data: markPoints,
          symbolSize: 36,
          label: {
            color: '#fff',
            fontSize: 10,
            fontWeight: 'bold',
            fontFamily: 'JetBrains Mono'
          }
        }
      },
      {
        name: 'MA Fast',
        type: 'line',
        data: sampleIndices.map(i => props.maFast[i]),
        smooth: true,
        lineStyle: { color: '#3b82f6', width: 1.5 },
        symbol: 'none'
      },
      {
        name: 'MA Slow',
        type: 'line',
        data: sampleIndices.map(i => props.maSlow[i]),
        smooth: true,
        lineStyle: { color: '#f59e0b', width: 1.5 },
        symbol: 'none'
      }
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'var(--bg-card)',
      borderColor: 'var(--border-medium)',
      borderWidth: 1,
      padding: [12, 16],
      textStyle: {
        color: 'var(--text-primary)',
        fontFamily: 'JetBrains Mono',
        fontSize: 12
      }
    },
    legend: {
      data: ['K线', 'MA Fast', 'MA Slow'],
      textStyle: {
        color: 'var(--text-secondary)',
        fontFamily: 'JetBrains Mono',
        fontSize: 11
      },
      top: 8,
      right: 16
    }
  }

  chart.setOption(option, true)
}

watch(() => [props.dates, props.data, props.maFast, props.maSlow, props.signals], updateChart, { deep: true })

onMounted(() => {
  initChart()
  window.addEventListener('resize', () => chart?.resize())
})

onUnmounted(() => {
  chart?.dispose()
})
</script>

<style scoped lang="scss">
.chart-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 20px;
  transition: all var(--transition-base);

  &:hover {
    border-color: var(--border-medium);
  }
}

.chart-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-light);

  .chart-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--gradient-blue);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .chart-title {
    h3 {
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      line-height: 1.2;
    }

    .chart-subtitle {
      font-size: 0.68rem;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
  }
}

.chart-container {
  width: 100%;
  height: 420px;
  padding: 12px;
}
</style>
