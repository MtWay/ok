<template>
  <div class="backtest-view">
    <ParamsPanel />

    <template v-if="store.backtestResult">
      <StatsPanel :result="store.backtestResult" />

      <EquityChart
        :dates="chartDates"
        :equity="store.backtestResult.equityCurve"
      />

      <KlineChart
        :dates="chartDates"
        :data="chartData"
        :ma-fast="maFastValues"
        :ma-slow="maSlowValues"
        :signals="store.backtestResult.signals"
      />

      <TradesTable
        :trades="store.backtestResult.trades"
        empty-text="暂无交易记录"
      />
    </template>

    <el-empty
      v-else
      description="配置参数后点击「运行回测」查看结果"
      class="empty-state"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBacktestStore } from '@/stores/backtest'
import ParamsPanel from '@/components/ParamsPanel.vue'
import StatsPanel from '@/components/StatsPanel.vue'
import EquityChart from '@/components/EquityChart.vue'
import KlineChart from '@/components/KlineChart.vue'
import TradesTable from '@/components/TradesTable.vue'
import { calculateMA } from '@/utils/backtest'

const store = useBacktestStore()

const chartDates = computed(() => {
  const key = store.getCacheKey(store.activePair, store.timeframe, store.limit)
  const data = store.cachedData.get(key)
  return data?.dates.slice(store.backtestParams.maSlow) || []
})

const chartData = computed(() => {
  const key = store.getCacheKey(store.activePair, store.timeframe, store.limit)
  const data = store.cachedData.get(key)
  return data?.data || []
})

const maFastValues = computed(() => {
  if (!chartData.value.length) return []
  return calculateMA(chartData.value, store.backtestParams.maFast)
})

const maSlowValues = computed(() => {
  if (!chartData.value.length) return []
  return calculateMA(chartData.value, store.backtestParams.maSlow)
})
</script>

<style scoped lang="scss">
.backtest-view {
  width: 100%;
}

.empty-state {
  margin-top: 60px;
  color: var(--text-secondary);
}
</style>
