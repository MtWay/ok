<template>
  <div class="scan-view">
    <ParamsPanel />

    <el-card class="scan-card">
      <template #header>
        <div class="scan-header">
          <div>
            <div class="scan-title">
              <el-icon><Trophy /></el-icon>
              <span>多品种扫描结果 - 最佳开仓推荐</span>
            </div>
            <div class="scan-summary">{{ summaryText }}</div>
          </div>
          <div class="header-actions">
            <el-button
              v-if="store.scanResults.length > 0"
              type="primary"
              size="small"
              @click="applySelectedToBacktest"
              :disabled="selectedResults.length === 0"
            >
              <el-icon><DataLine /></el-icon>
              应用到回测 ({{ selectedResults.length }})
            </el-button>
            <el-button
              v-if="store.scanResults.length > 0"
              size="small"
              @click="exportCSV"
            >
              <el-icon><Download /></el-icon>
              导出CSV
            </el-button>
          </div>
        </div>
      </template>

      <!-- 操作等级说明 -->
      <div class="level-legend">
        <span class="level-excellent">≥80分: 做多/做空 (最佳)</span>
        <span class="level-good">60-79分: 做多/做空 (推荐)</span>
        <span class="level-hold">40-59分: 多仓/空仓持有</span>
        <span class="level-neutral"><40分: 观望</span>
      </div>

      <el-table
        ref="tableRef"
        :data="displayResults"
        style="width: 100%"
        :empty-text="emptyText"
        class="scan-table"
        @sort-change="handleSort"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="45" :selectable="checkSelectable" />
        <el-table-column prop="rank" label="排名" width="60">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column prop="pair" label="交易对" min-width="100">
          <template #default="{ row }">
            <strong>{{ row.pair.replace('-USDT', '').replace('-SWAP', '') }}</strong>
          </template>
        </el-table-column>
        <el-table-column prop="timeframe" label="周期" width="80" />
        <el-table-column prop="signal" label="推荐操作" min-width="140">
          <template #default="{ row }">
            <span :class="getActionClass(row.score.level)">
              {{ getActionText(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="score" label="综合评分" width="100" sortable="custom">
          <template #default="{ row }">
            <span :class="getScoreClass(row.score.score)">{{ row.score.score }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="signalAge" label="信号天数" width="100" sortable="custom">
          <template #default="{ row }">
            <span :class="getAgeClass(row.score.level)">{{ row.signalAge }}K</span>
          </template>
        </el-table-column>
        <el-table-column prop="fast" label="快线" width="80" sortable="custom">
          <template #default="{ row }">MA{{ row.fast }}</template>
        </el-table-column>
        <el-table-column prop="slow" label="慢线" width="80" sortable="custom">
          <template #default="{ row }">MA{{ row.slow }}</template>
        </el-table-column>
        <el-table-column prop="totalReturn" label="预期收益" width="120" sortable="custom">
          <template #default="{ row }">
            <span :class="row.totalReturn >= 0 ? 'profit-positive' : 'profit-negative'">
              {{ row.totalReturn >= 0 ? '+' : '' }}{{ (row.totalReturn * 100).toFixed(2) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="winRate" label="胜率" width="100" sortable="custom">
          <template #default="{ row }">
            <span :class="row.winRate >= 0.5 ? 'profit-positive' : 'profit-negative'">
              {{ (row.winRate * 100).toFixed(1) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="maxDrawdown" label="最大回撤" width="100" sortable="custom">
          <template #default="{ row }">
            <span :class="row.maxDrawdown <= 0.1 ? 'profit-positive' : (row.maxDrawdown <= 0.2 ? '' : 'profit-negative')">
              {{ (row.maxDrawdown * 100).toFixed(1) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="currentAdx" label="趋势强度" width="120">
          <template #default="{ row }">
            {{ getTrendStrength(row.currentAdx) }} ({{ row.currentAdx }})
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="viewResult(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBacktestStore } from '@/stores/backtest'
import { ElMessage } from 'element-plus'
import ParamsPanel from '@/components/ParamsPanel.vue'
import type { ScanResult } from '@/types'

const store = useBacktestStore()
const router = useRouter()
const tableRef = ref()
const selectedResults = ref<ScanResult[]>([])

const emptyText = '点击「多品种扫描」按钮开始扫描多个交易对'
const sortState = ref({ column: '', order: '' })

const summaryText = computed(() => {
  if (store.scanResults.length === 0) return '点击「多品种扫描」按钮开始分析'
  const shortText = store.backtestParams.enableShort ? '双向' : '仅做多'
  return `共扫描 ${store.scanResults.length} 个组合，显示收益率最高的机会 (支持${shortText})`
})

const displayResults = computed(() => {
  let results = [...store.scanResults]
  if (sortState.value.column && sortState.value.order) {
    const { column, order } = sortState.value
    results.sort((a, b) => {
      let valA: number | string, valB: number | string
      switch (column) {
        case 'score':
          valA = a.score.score
          valB = b.score.score
          break
        case 'signalAge':
          valA = a.signalAge
          valB = b.signalAge
          break
        case 'fast':
          valA = a.fast
          valB = b.fast
          break
        case 'slow':
          valA = a.slow
          valB = b.slow
          break
        case 'totalReturn':
          valA = a.totalReturn
          valB = b.totalReturn
          break
        case 'winRate':
          valA = a.winRate
          valB = b.winRate
          break
        case 'maxDrawdown':
          valA = a.maxDrawdown
          valB = b.maxDrawdown
          break
        default:
          return 0
      }
      if (valA < valB) return order === 'ascending' ? -1 : 1
      if (valA > valB) return order === 'ascending' ? 1 : -1
      return 0
    })
  }
  return results.slice(0, 15)
})

function checkSelectable(row: ScanResult) {
  return row.score.level === 'excellent' || row.score.level === 'good'
}

function handleSelectionChange(selection: ScanResult[]) {
  selectedResults.value = selection
}

function getActionClass(level: string) {
  return {
    excellent: 'action-excellent',
    good: 'action-good',
    hold: 'action-hold',
    neutral: 'action-neutral'
  }[level] || 'action-neutral'
}

function getActionText(row: ScanResult) {
  if (row.score.level === 'excellent') {
    return row.trendSignal === 'long' ? '做多 (最佳)' : '做空 (最佳)'
  } else if (row.score.level === 'good') {
    return row.trendSignal === 'long' ? '做多 (推荐)' : '做空 (推荐)'
  } else if (row.score.level === 'hold') {
    return row.trendSignal === 'long' ? '多仓持有' : '空仓持有'
  } else {
    return row.trendSignal === 'long' ? '观望 (金叉已久)' : '观望 (死叉已久)'
  }
}

function getScoreClass(score: number) {
  if (score >= 80) return 'score-excellent'
  if (score >= 60) return 'score-good'
  if (score >= 40) return 'score-hold'
  return 'score-neutral'
}

function getAgeClass(level: string) {
  return {
    excellent: 'age-excellent',
    good: 'age-good',
    hold: 'age-hold',
    neutral: 'age-neutral'
  }[level] || 'age-neutral'
}

function getTrendStrength(adx: string) {
  const val = parseFloat(adx)
  if (val > 30) return '强'
  if (val > 20) return '中'
  return '弱'
}

function handleSort({ prop, order }: { prop: string, order: string }) {
  sortState.value = { column: prop, order }
}

function viewResult(row: ScanResult) {
  store.selectedPairs = [row.pair]
  store.timeframe = row.timeframe
  store.backtestParams.maFast = row.fast
  store.backtestParams.maSlow = row.slow
  store.runBacktestAction()
  router.push('/backtest')
}

function applySelectedToBacktest() {
  if (selectedResults.value.length === 0) {
    ElMessage.warning('请先选择要应用的交易对')
    return
  }

  const pairs = selectedResults.value.map(r => r.pair)
  const firstResult = selectedResults.value[0]

  store.selectedPairs = pairs
  store.timeframe = firstResult.timeframe
  store.backtestParams.maFast = firstResult.fast
  store.backtestParams.maSlow = firstResult.slow

  ElMessage.success(`已将 ${pairs.length} 个交易对应用到回测`)
  router.push('/backtest')
}

function exportCSV() {
  const results = store.scanResults
  if (!results.length) return

  const headers = [
    '排名', '交易对', '周期', '推荐操作', '综合评分', '信号天数', '信号质量',
    '快线 (MA)', '慢线 (MA)', '预期收益率 (%)', '交易次数', '胜率 (%)',
    '最大回撤 (%)', '趋势信号', 'ADX 值', '趋势强度'
  ]

  let csv = '\uFEFF' + headers.join(',') + '\n'

  results.forEach((r, i) => {
    const age = r.signalAge || 0
    const adx = parseFloat(r.currentAdx) || 0
    let action = '观望'
    let signalQuality = '无信号'

    if (r.score.level === 'excellent') {
      action = r.trendSignal === 'long' ? '做多 (最佳)' : '做空 (最佳)'
      signalQuality = '优秀'
    } else if (r.score.level === 'good') {
      action = r.trendSignal === 'long' ? '做多 (推荐)' : '做空 (推荐)'
      signalQuality = '良好'
    } else if (r.score.level === 'hold') {
      action = r.trendSignal === 'long' ? '多仓持有' : '空仓持有'
      signalQuality = '持有'
    } else {
      action = r.trendSignal === 'long' ? '观望 (金叉已久)' : '观望 (死叉已久)'
      signalQuality = '过期'
    }

    let trendStrength = '弱'
    if (adx > 30) trendStrength = '强'
    else if (adx > 20) trendStrength = '中'

    const row = [
      i + 1,
      r.pair.replace('-USDT', '').replace('-SWAP', ''),
      r.timeframe,
      action,
      r.score.score,
      age,
      signalQuality,
      r.fast,
      r.slow,
      (r.totalReturn * 100).toFixed(2),
      r.trades,
      (r.winRate * 100).toFixed(2),
      (r.maxDrawdown * 100).toFixed(2),
      r.trendSignal,
      r.currentAdx,
      trendStrength
    ]
    csv += row.join(',') + '\n'
  })

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
  link.href = URL.createObjectURL(blob)
  link.download = `扫描结果_${timestamp}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<style scoped lang="scss">
.scan-view {
  width: 100%;
}

.scan-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  .scan-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-primary);

    .el-icon {
      color: var(--accent-gold);
    }
  }

  .scan-summary {
    font-size: 0.78rem;
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }
}

.level-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
  font-size: 0.75rem;

  span {
    display: flex;
    align-items: center;
    gap: 6px;

    &::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }

    &.level-excellent::before { background: var(--accent-green); }
    &.level-good::before { background: var(--accent-blue); }
    &.level-hold::before { background: var(--accent-gold); }
    &.level-neutral::before { background: var(--text-muted); }
  }
}

.scan-table {
  .action-excellent {
    color: var(--accent-green);
    font-weight: 700;
  }

  .action-good {
    color: var(--accent-blue);
    font-weight: 600;
  }

  .action-hold {
    color: var(--accent-gold);
    font-weight: 600;
  }

  .action-neutral {
    color: var(--text-tertiary);
  }

  .score-excellent {
    color: var(--accent-green);
    font-weight: 700;
  }

  .score-good {
    color: var(--accent-blue);
    font-weight: 600;
  }

  .score-hold {
    color: var(--accent-gold);
    font-weight: 600;
  }

  .score-neutral {
    color: var(--text-tertiary);
  }

  .age-excellent { color: var(--accent-green); }
  .age-good { color: var(--accent-blue); }
  .age-hold { color: var(--accent-gold); }
  .age-neutral { color: var(--text-tertiary); }

  .profit-positive { color: var(--accent-green); font-weight: 600; }
  .profit-negative { color: var(--accent-red); font-weight: 600; }
}
</style>
