<template>
  <div class="tab-content">
    <div v-if="results.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📈 趋势质量扫描结果</div>
        <div class="summary-text">
          共扫描 {{ results.length }} 个品种，趋势稳定: {{ strongCount }}，趋势尚可: {{ moderateCount }}
        </div>
      </div>
    </div>

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
              <th class="sortable" @click="handleSort('pair')">交易对 <span class="sort-icon">{{ getSortIcon('pair') }}</span></th>
              <th class="sortable" @click="handleSort('timeframe')">周期 <span class="sort-icon">{{ getSortIcon('timeframe') }}</span></th>
              <th class="sortable" @click="handleSort('direction')">方向 <span class="sort-icon">{{ getSortIcon('direction') }}</span></th>
              <th class="sortable" @click="handleSort('adx')">ADX <span class="sort-icon">{{ getSortIcon('adx') }}</span></th>
              <th class="sortable" @click="handleSort('trendScore')">趋势评分 <span class="sort-icon">{{ getSortIcon('trendScore') }}</span></th>
              <th class="sortable" @click="handleSort('action')">建议操作 <span class="sort-icon">{{ getSortIcon('action') }}</span></th>
              <th>止损（贴近/抗插针）</th>
              <th>止盈</th>
              <th class="sortable" @click="handleSort('riskRewardTight')">盈亏比 <span class="sort-icon">{{ getSortIcon('riskRewardTight') }}</span></th>
              <th class="sortable" @click="handleSort('trailingStopPercent')">建议移动止损% <span class="sort-icon">{{ getSortIcon('trailingStopPercent') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sortedFilteredResults" :key="`${r.pair}-${r.timeframe}`" :class="!r.insufficientData ? r.level : ''">
              <td>{{ r.pair }}</td>
              <td>{{ r.timeframe }}</td>
              <template v-if="r.insufficientData">
                <td colspan="8" class="insufficient-cell">数据不足，无法评分</td>
              </template>
              <template v-else>
                <td :class="r.direction">{{ r.direction === 'long' ? '做多' : r.direction === 'short' ? '做空' : '中性' }}</td>
                <td>{{ r.adx.toFixed(1) }}</td>
                <td :class="getScoreClass(r.trendScore)">
                  {{ r.trendScore }}
                  <span v-if="r.volatilityState === 'elevated'" class="warn-badge" title="近期波动率处于历史高位，已计入扣分">⚠波动偏高</span>
                </td>
                <td :class="r.level">
                  {{ r.action }}
                  <span v-if="!r.isRealData" class="warn-badge" title="模拟数据，仅供界面预览">⚠模拟数据</span>
                </td>
                <td v-if="r.direction === 'neutral'">
                  <span title="趋势方向不明，止盈止损仅供参考，建议观望">—</span>
                </td>
                <td v-else>
                  {{ r.stopLossTight.toFixed(4) }} / {{ r.stopLossWide.toFixed(4) }}
                  <span v-if="!r.isSwingBased" class="warn-badge" title="未找到明显摆动点，按波动率估算">⚠按波动率估算</span>
                  <br />
                  <span
                    class="confirm-hint"
                    title="收盘价突破此价才算真正确认破位；不可作为挂单止损价——真实止损单按价格触及（含影线）成交"
                  >收盘确认: {{ r.closeConfirmPrice.toFixed(4) }}</span>
                </td>
                <td v-if="r.direction === 'neutral'">
                  <span title="趋势方向不明，止盈止损仅供参考，建议观望">—</span>
                </td>
                <td v-else>{{ r.takeProfit.toFixed(4) }}</td>
                <td v-if="r.direction === 'neutral'">
                  <span title="趋势方向不明，止盈止损仅供参考，建议观望">—</span>
                </td>
                <td v-else :class="{ 'low-attraction': r.riskRewardTight < 1.2 }">
                  {{ r.riskRewardTight.toFixed(2) }} / {{ r.riskRewardWide.toFixed(2) }}
                  <span v-if="r.riskRewardTight < 1.2" class="warn-badge" title="盈亏比偏低">低吸引力</span>
                </td>
                <td v-if="r.direction === 'neutral'">
                  <span title="趋势方向不明，止盈止损仅供参考，建议观望">—</span>
                </td>
                <td v-else>
                  {{ r.trailingStopPercent.toFixed(2) }}%
                  <span class="confirm-hint" title="基于2倍ATR占当前价的百分比估算，随波动率自动跟踪，供移动止损参考，非固定价位">跟踪波动</span>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="results.length === 0" class="empty-state">
      <p>点击「趋势扫描」查看结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TrendScanEntry, TrendScanResult } from '../types'

const props = defineProps<{
  results: TrendScanEntry[]
}>()

function isScored(r: TrendScanEntry): r is TrendScanResult {
  return !r.insufficientData
}

const currentFilter = ref('all')
interface SortState { key: string; order: 'asc' | 'desc' }
const sortState = ref<SortState>({ key: 'trendScore', order: 'desc' })

const filters = [
  { label: '全部', value: 'all' },
  { label: '强烈建议', value: 'strong' },
  { label: '建议', value: 'moderate' },
  { label: '轻仓', value: 'weak' },
  { label: '做多', value: 'long' },
  { label: '做空', value: 'short' }
]

const strongCount = computed(() => props.results.filter(r => isScored(r) && r.level === 'strong').length)
const moderateCount = computed(() => props.results.filter(r => isScored(r) && r.level === 'moderate').length)

function handleSort(key: string) {
  if (sortState.value.key === key) {
    sortState.value.order = sortState.value.order === 'asc' ? 'desc' : 'asc'
  } else {
    sortState.value.key = key
    sortState.value.order = 'desc'
  }
}

function getSortIcon(key: string): string {
  if (sortState.value.key !== key) return '⇅'
  return sortState.value.order === 'asc' ? '↑' : '↓'
}

const filteredResults = computed(() => {
  const list = props.results
  switch (currentFilter.value) {
    case 'strong': return list.filter(r => isScored(r) && r.level === 'strong')
    case 'moderate': return list.filter(r => isScored(r) && r.level === 'moderate')
    case 'weak': return list.filter(r => isScored(r) && r.level === 'weak')
    case 'long': return list.filter(r => isScored(r) && r.direction === 'long')
    case 'short': return list.filter(r => isScored(r) && r.direction === 'short')
    default: return list
  }
})

const sortedFilteredResults = computed(() => {
  const list = [...filteredResults.value]
  const { key, order } = sortState.value

  list.sort((a, b) => {
    // 数据不足的行始终排在最后，不参与排序比较
    const aScored = isScored(a)
    const bScored = isScored(b)
    if (!aScored && !bScored) return 0
    if (!aScored) return 1
    if (!bScored) return -1

    let aVal: number | string
    let bVal: number | string
    switch (key) {
      case 'pair': aVal = a.pair; bVal = b.pair; break
      case 'timeframe': aVal = a.timeframe; bVal = b.timeframe; break
      case 'direction':
        aVal = a.direction === 'long' ? 2 : a.direction === 'short' ? 1 : 0
        bVal = b.direction === 'long' ? 2 : b.direction === 'short' ? 1 : 0
        break
      case 'adx': aVal = a.adx; bVal = b.adx; break
      case 'trendScore': aVal = a.trendScore; bVal = b.trendScore; break
      case 'action': aVal = a.action; bVal = b.action; break
      case 'riskRewardTight': aVal = a.riskRewardTight; bVal = b.riskRewardTight; break
      case 'trailingStopPercent': aVal = a.trailingStopPercent; bVal = b.trailingStopPercent; break
      default: return 0
    }

    if (aVal < bVal) return order === 'asc' ? -1 : 1
    if (aVal > bVal) return order === 'asc' ? 1 : -1
    return 0
  })

  return list
})

function getScoreClass(score: number): string {
  if (score >= 70) return 'strong'
  if (score >= 50) return 'moderate'
  if (score >= 30) return 'weak'
  return 'neutral'
}
</script>

<style scoped>
.tab-content { display: flex; flex-direction: column; gap: 24px; }
.chart-card { background: var(--bg-card); border-radius: 16px; padding: 24px; border: 1px solid var(--border-color); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
.chart-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); }
.summary-text { color: var(--text-secondary); font-size: 0.9rem; }
.filter-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 0.8rem; cursor: pointer; background: var(--bg-secondary); color: var(--text-primary); transition: all 0.3s; }
.btn:hover, .btn.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }
.table-container { overflow-x: auto; max-height: 500px; overflow-y: auto; }
.trades-table { width: 100%; border-collapse: collapse; }
.trades-table th, .trades-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color); font-family: 'Space Mono', monospace; font-size: 0.8rem; }
.trades-table th { color: var(--text-secondary); font-weight: 400; text-transform: uppercase; letter-spacing: 1px; font-size: 0.7rem; position: sticky; top: 0; background: var(--bg-card); }
.trades-table th.sortable { cursor: pointer; user-select: none; transition: color 0.2s; }
.trades-table th.sortable:hover { color: var(--accent-blue); }
.trades-table th .sort-icon { margin-left: 4px; font-size: 0.6rem; opacity: 0.7; }
.trades-table tr:hover { background: rgba(59, 130, 246, 0.05); }
.trades-table tr.strong { background: rgba(16, 185, 129, 0.1); }
.trades-table tr.moderate { background: rgba(59, 130, 246, 0.1); }
.trades-table tr.weak { background: rgba(245, 158, 11, 0.1); }
.long { color: var(--accent-green); }
.short { color: var(--accent-red); }
.neutral { color: var(--text-secondary); }
.strong { color: var(--accent-green); font-weight: bold; }
.moderate { color: var(--accent-blue); }
.weak { color: var(--accent-gold); }
.insufficient-cell { color: var(--text-secondary); font-style: italic; }
.warn-badge { display: inline-block; margin-left: 6px; padding: 1px 5px; background: rgba(245, 158, 11, 0.2); color: var(--accent-gold); border-radius: 4px; font-size: 0.65rem; }
.low-attraction { opacity: 0.7; }
.confirm-hint { display: inline-block; margin-top: 2px; color: var(--text-secondary); font-size: 0.7rem; opacity: 0.8; cursor: help; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
</style>
