<template>
  <div class="chart-card">
    <div class="chart-header">
      <div class="chart-icon">
        <el-icon :size="16"><TrendCharts /></el-icon>
      </div>
      <div class="chart-title">
        <h3>资金曲线</h3>
        <span class="chart-subtitle">Equity Curve</span>
      </div>
    </div>
    <div ref="chartRef" class="chart-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { TrendCharts } from '@element-plus/icons-vue'

const props = defineProps<{
  dates: string[]
  equity: number[]
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

  const step = Math.max(1, Math.floor(props.dates.length / 200))
  const sampledDates = props.dates.filter((_, i) => i % step === 0)
  const sampledEquity = props.equity.filter((_, i) => i % step === 0)

  const startVal = sampledEquity[0] || 0
  const endVal = sampledEquity[sampledEquity.length - 1] || 0
  const isProfit = endVal >= startVal

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    grid: {
      left: '2%',
      right: '3%',
      bottom: '3%',
      top: '8%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: sampledDates,
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
        fontSize: 10,
        formatter: (v: number) => v.toFixed(0)
      },
      splitLine: {
        lineStyle: {
          color: 'var(--border-subtle)',
          type: [4, 4]
        }
      }
    },
    series: [{
      name: '资金',
      type: 'line',
      data: sampledEquity,
      smooth: 0.3,
      symbol: 'none',
      lineStyle: {
        color: isProfit ? '#22c55e' : '#ef4444',
        width: 2.5,
        shadowColor: isProfit ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        shadowBlur: 10,
        shadowOffsetY: 4
      },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: isProfit ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)' },
            { offset: 0.6, color: isProfit ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)' },
            { offset: 1, color: 'rgba(0, 0, 0, 0)' }
          ]
        }
      }
    }],
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
      },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params
        return `<div style="font-weight:700;margin-bottom:4px">${p.axisValue}</div>
                <div style="color:${isProfit ? '#22c55e' : '#ef4444'}">资金: ${Number(p.value).toFixed(2)} USDT</div>`
      }
    }
  }

  chart.setOption(option, true)
}

watch(() => [props.dates, props.equity], updateChart, { deep: true })

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
    background: var(--gradient-gold);
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
  height: 380px;
  padding: 12px;
}
</style>
