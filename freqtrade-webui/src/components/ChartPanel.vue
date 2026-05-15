<template>
  <div class="chart-card">
    <div class="chart-header">
      <div class="chart-title">{{ title }}</div>
      <div v-if="legend" class="chart-legend" v-html="legend"></div>
    </div>
    <div ref="chartRef" class="chart-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

type EChartsOption = echarts.EChartsOption

const props = defineProps<{
  title: string
  option: EChartsOption
  legend?: string
}>()

const chartRef = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

onMounted(() => {
  nextTick(() => {
    if (chartRef.value) {
      chart = echarts.init(chartRef.value)
      chart.setOption(props.option)
    }
  })
})

onUnmounted(() => {
  if (chart) {
    chart.dispose()
    chart = null
  }
})

watch(() => props.option, (newOption) => {
  if (chart) {
    chart.setOption(newOption, true)
  }
}, { deep: true })

// 暴露 resize 方法
function resize() {
  chart?.resize()
}

defineExpose({
  resize
})
</script>

<style scoped>
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

.chart-legend {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.chart-container {
  width: 100%;
  height: 400px;
}
</style>
