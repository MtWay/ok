<template>
  <div class="tab-content">
    <div v-if="positions.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">💼 持仓管理</div>
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
              <th>交易对</th>
              <th>周期</th>
              <th>方向</th>
              <th>建仓价</th>
              <th>建仓时间</th>
              <th>建仓分</th>
              <th>当前分</th>
              <th>分数变化</th>
              <th>建议</th>
              <th>命中原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pos in filteredPositions" :key="pos.id">
              <td>{{ pos.pair }}</td>
              <td>{{ pos.timeframe }}</td>
              <td :class="pos.direction">{{ pos.direction === 'long' ? '做多' : '做空' }}</td>
              <td>{{ pos.entryPrice.toFixed(4) }}</td>
              <td>{{ formatTime(pos.entryTime) }}</td>
              <td>{{ pos.entryTrendScore }}</td>
              <td>{{ pos.lastReview ? pos.lastReview.currentTrendScore : '未复检' }}</td>
              <td v-if="pos.lastReview" :class="getScoreDeltaClass(pos.lastReview.scoreDelta)">
                {{ pos.lastReview.scoreDelta > 0 ? '+' : '' }}{{ pos.lastReview.scoreDelta }}
              </td>
              <td v-else>—</td>
              <td v-if="pos.lastReview" :class="getSuggestionClass(pos.lastReview.suggestion)">
                {{ getSuggestionLabel(pos.lastReview.suggestion) }}
              </td>
              <td v-else>—</td>
              <td>{{ pos.lastReview ? pos.lastReview.reasons.join('；') : '—' }}</td>
              <td>
                <button v-if="pos.status === 'open'" class="btn btn-small btn-review" @click="handleReview(pos)">
                  重新复检
                </button>
                <button v-if="pos.status === 'open'" class="btn btn-small btn-close" @click="handleClose(pos.id)">
                  平仓
                </button>
                <span v-if="pos.status === 'closed'" class="closed-badge">已平仓</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-else class="empty-state">
      <p>暂无持仓记录，在趋势扫描页面标记后会显示在这里</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePositions } from '../composables/usePositions'
import { useDataFetch } from '../composables/useDataFetch'
import { scoreSymbol } from '../composables/useTrendScore'
import type { Position } from '../composables/usePositions'

const { positions, loadPositions, closePosition, evaluatePosition, reviewPosition } = usePositions()
const { loadData } = useDataFetch()

const currentFilter = ref('open')
const filters = [
  { label: '全部', value: 'all' },
  { label: '持仓中', value: 'open' },
  { label: '已平仓', value: 'closed' }
]

const filteredPositions = computed(() => {
  if (currentFilter.value === 'all') return positions.value
  return positions.value.filter(p => p.status === currentFilter.value)
})

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function getScoreDeltaClass(delta: number): string {
  if (delta > 0) return 'positive'
  if (delta < 0) return 'negative'
  return ''
}

function getSuggestionClass(suggestion: string): string {
  switch (suggestion) {
    case 'hold': return 'suggestion-hold'
    case 'reduce': return 'suggestion-reduce'
    case 'close': return 'suggestion-close'
    default: return ''
  }
}

function getSuggestionLabel(suggestion: string): string {
  switch (suggestion) {
    case 'hold': return '持有'
    case 'reduce': return '减仓'
    case 'close': return '平仓'
    default: return '未知'
  }
}

function handleClose(positionId: string): void {
  if (confirm('确定要平仓吗？')) {
    closePosition(positionId)
  }
}

async function handleReview(position: Position): Promise<void> {
  try {
    const candle = await loadData(position.pair, position.timeframe, 500, true)
    if (candle.data.length < 100) {
      alert('数据不足，无法复检')
      return
    }
    const fresh = scoreSymbol(position.pair, position.timeframe, candle.data, true)
    if (fresh.insufficientData) {
      alert('数据不足，无法复检')
      return
    }
    const review = evaluatePosition(position, fresh)
    reviewPosition(position.id, review)
  } catch (e) {
    console.error('复检失败:', e)
    alert('复检失败，请重试')
  }
}

async function reviewAllOpenPositions(): Promise<void> {
  const openPositions = positions.value.filter(p => p.status === 'open')
  for (const position of openPositions) {
    try {
      const candle = await loadData(position.pair, position.timeframe, 500, true)
      if (candle.data.length < 100) continue
      const fresh = scoreSymbol(position.pair, position.timeframe, candle.data, true)
      if (fresh.insufficientData) continue
      const review = evaluatePosition(position, fresh)
      reviewPosition(position.id, review)
    } catch (e) {
      console.error(`复检 ${position.pair} ${position.timeframe} 失败:`, e)
    }
  }
}

onMounted(() => {
  loadPositions()
  reviewAllOpenPositions()
})
</script>

<style scoped>
.tab-content { display: flex; flex-direction: column; gap: 24px; }
.chart-card { background: var(--bg-card); border-radius: 16px; padding: 24px; border: 1px solid var(--border-color); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
.chart-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); }
.filter-buttons { display: flex; gap: 8px; }
.btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 0.8rem; cursor: pointer; background: var(--bg-secondary); color: var(--text-primary); transition: all 0.3s; }
.btn:hover, .btn.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }
.table-container { overflow: auto; max-height: 500px; }
.trades-table { width: 100%; border-collapse: collapse; }
.trades-table th, .trades-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color); font-family: 'Space Mono', monospace; font-size: 0.8rem; }
.trades-table th { color: var(--text-secondary); font-weight: 400; text-transform: uppercase; letter-spacing: 1px; font-size: 0.7rem; position: sticky; top: 0; background: var(--bg-card); }
.trades-table tr:hover { background: rgba(59, 130, 246, 0.05); }
.long { color: var(--accent-green); }
.short { color: var(--accent-red); }
.positive { color: var(--accent-green); font-weight: bold; }
.negative { color: var(--accent-red); font-weight: bold; }
.suggestion-hold { color: var(--accent-green); font-weight: bold; }
.suggestion-reduce { color: var(--accent-gold); font-weight: bold; }
.suggestion-close { color: var(--accent-red); font-weight: bold; }
.btn-review { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; margin-right: 6px; }
.btn-review:hover { background: #2563eb; border-color: #2563eb; }
.btn-close { background: var(--accent-red); border-color: var(--accent-red); color: #fff; }
.btn-close:hover { background: #dc2626; border-color: #dc2626; }
.closed-badge { color: var(--text-secondary); font-style: italic; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
</style>
