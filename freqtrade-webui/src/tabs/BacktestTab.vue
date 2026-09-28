<template>
  <div class="tab-content">
    <!-- 策略切换标签 -->
    <div v-if="strategyResults && strategyResults.size > 0" class="strategy-switcher">
      <button
        v-for="label in strategyLabels"
        :key="label.key"
        class="strategy-btn"
        :class="{ active: currentMethod === label.key }"
        @click="emit('switchStrategy', label.key)"
      >
        {{ label.name }}
        <span class="strategy-return">
          {{ formatReturn(getStrategyReturn(label.key)) }}
        </span>
      </button>
      <button class="strategy-btn position-btn" @click="emit('openPosition', currentMethod)">
        建仓
      </button>
    </div>

    <!-- 统计指标 -->
    <StatsPanel v-if="result" :stats="stats" />

    <div v-if="result?.reverseComparison" class="comparison-card">
      <div class="chart-title">原方向 / 反向信号对照</div>
      <div class="comparison-grid">
        <div><span>模式</span><b>原方向</b><strong>{{ (result.totalReturn * 100).toFixed(2) }}%</strong></div>
        <div><span>模式</span><b>反向信号</b><strong>{{ (result.reverseComparison.totalReturn * 100).toFixed(2) }}%</strong></div>
      </div>
      <small>反向结果使用相同数据、参数、止盈止损和手续费假设，仅交换多空信号方向。</small>
    </div>

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
        <div v-if="method === 'turtle'" class="system-filter">
          <button
            class="filter-btn"
            :class="{ active: systemFilter === 'all' }"
            @click="systemFilter = 'all'"
          >
            全部
          </button>
          <button
            class="filter-btn"
            :class="{ active: systemFilter === 'S1' }"
            @click="systemFilter = 'S1'"
          >
            S1
          </button>
          <button
            class="filter-btn"
            :class="{ active: systemFilter === 'S2' }"
            @click="systemFilter = 'S2'"
          >
            S2
          </button>
        </div>
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
              <th v-if="method === 'turtle'" class="sortable" @click="handleSort('system')">
                系统 <span class="sort-icon">{{ getSortIcon('system') }}</span>
              </th>
              <th v-if="method === 'turtle'" class="sortable" @click="handleSort('units')">
                单位 <span class="sort-icon">{{ getSortIcon('units') }}</span>
              </th>
              <th v-if="method === 'grid'" class="sortable" @click="handleSort('level')">
                层位 <span class="sort-icon">{{ getSortIcon('level') }}</span>
              </th>
              <th v-if="method === 'pivot'" class="sortable" @click="handleSort('pivotLevel')">
                枢轴层 <span class="sort-icon">{{ getSortIcon('pivotLevel') }}</span>
              </th>
              <th v-if="method === 'bollinger'" class="sortable" @click="handleSort('closeReason')">
                平仓原因 <span class="sort-icon">{{ getSortIcon('closeReason') }}</span>
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
              <th v-if="method !== 'ma_cross'" class="sortable" @click="handleSort('closeReason')">
                平仓原因 <span class="sort-icon">{{ getSortIcon('closeReason') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(trade, index) in sortedTradesList" :key="index">
              <td>{{ trade.originalIndex + 1 }}</td>
              <td :class="trade.direction === 'long' ? 'profit-positive' : 'profit-negative'">
                {{ trade.direction === 'long' ? '做多' : '做空' }}
              </td>
              <td v-if="method === 'turtle'">{{ trade.system ?? '--' }}</td>
              <td v-if="method === 'turtle'">{{ trade.units ?? 1 }}</td>
              <td v-if="method === 'grid'">{{ trade.level ?? '--' }}</td>
              <td v-if="method === 'pivot'">{{ trade.pivotLevel ?? '--' }}</td>
              <td v-if="method === 'bollinger'">{{ closeReasonText[trade.closeReason ?? ''] ?? (trade.closeReason ?? '--') }}</td>
              <td>{{ trade.entryTime }}</td>
              <td>{{ trade.exitTime }}</td>
              <td>{{ trade.entryPrice.toFixed(4) }}</td>
              <td>{{ trade.exitPrice.toFixed(4) }}</td>
              <td :class="trade.pnl > 0 ? 'profit-positive' : 'profit-negative'">
                {{ trade.pnl > 0 ? '+' : '' }}{{ (trade.pnl * 100).toFixed(2) }}%
              </td>
              <td :class="trade.pnlAmount > 0 ? 'profit-positive' : 'profit-negative'">
                {{ trade.pnlAmount > 0 ? '+' : '' }}{{ trade.pnlAmount.toFixed(2) }}
              </td>
              <td v-if="method !== 'ma_cross'">{{ closeReasonText[trade.closeReason ?? ''] ?? (trade.closeReason ?? '--') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 滑动窗口评估日志 -->
    <div v-if="result?.evaluationLog?.length" class="eval-log-section">
      <div class="eval-log-header" @click="evalLogExpanded = !evalLogExpanded">
        <span class="eval-log-toggle">{{ evalLogExpanded ? '▼' : '▶' }}</span>
        <strong>滑动窗口评估日志</strong>
        <span class="eval-log-badge">{{ result.evaluationLog.length }} 条</span>
        <span v-if="evalLogStats && !evalCompareMode" class="eval-log-stats-inline">
          持仓 {{ evalLogStats.inPosition }} ·
          买入信号 {{ evalLogStats.buySignals }} ·
          卖出信号 {{ evalLogStats.sellSignals }}
        </span>
        <button
          v-if="strategyResults && strategyResults.size > 1"
          class="eval-compare-toggle"
          :class="{ active: evalCompareMode }"
          @click.stop="evalCompareMode = !evalCompareMode"
        >
          {{ evalCompareMode ? '单策略' : '对比全部策略' }}
        </button>
      </div>
      <div v-if="evalLogExpanded" class="eval-log-body">
        <div class="eval-log-filters">
          <select v-model="evalLogPositionFilter" class="eval-log-select">
            <option value="">全部仓位</option>
            <option value="long">多头</option>
            <option value="short">空头</option>
            <option value="none">空仓</option>
          </select>
          <select v-model="evalLogSignalFilter" class="eval-log-select">
            <option value="">全部信号</option>
            <option value="buy">买入</option>
            <option value="sell">卖出</option>
            <option value="hold">持有</option>
          </select>
          <label class="eval-hide-hold">
            <input type="checkbox" v-model="evalHideHold" />
            <span>隐藏无信号</span>
          </label>
          <span v-if="!evalCompareMode" class="eval-log-filter-hint">显示 {{ filteredEvalLog.length }} / {{ result.evaluationLog.length }} 条</span>
          <span v-else class="eval-log-filter-hint">共 {{ allStrategyEvalLogs.length }} 个策略</span>
        </div>

        <!-- 单策略模式 -->
        <div v-if="!evalCompareMode" class="eval-log-table-wrap">
          <table class="eval-log-table">
            <thead><tr>
              <th>#</th><th>时间</th><th>权益</th><th>收益率%</th><th>仓位</th><th>信号</th>
            </tr></thead>
            <tbody>
              <tr v-for="(entry, i) in filteredEvalLog" :key="i"
                :class="{ 'eval-in-position': entry.position !== 'none', 'eval-signal-buy': entry.signal === 'buy', 'eval-signal-sell': entry.signal === 'sell' }">
                <td>{{ entry.index }}</td>
                <td>{{ entry.date }}</td>
                <td>{{ entry.equity.toFixed(2) }}</td>
                <td :class="entry.pnlPct >= 0 ? 'profit-positive' : 'profit-negative'">{{ entry.pnlPct.toFixed(2) }}%</td>
                <td :class="entry.position === 'long' ? 'profit-positive' : entry.position === 'short' ? 'profit-negative' : ''">{{ entry.position === 'long' ? '多' : entry.position === 'short' ? '空' : '—' }}</td>
                <td :class="entry.signal === 'buy' ? 'profit-positive' : entry.signal === 'sell' ? 'profit-negative' : ''">{{ entry.signal === 'buy' ? '买' : entry.signal === 'sell' ? '卖' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 多策略对比模式 -->
        <div v-else class="eval-compare-sections">
          <div v-for="item in filteredCompareLogs" :key="item.key" class="eval-strategy-block">
            <div class="eval-strategy-header" :style="{ borderLeftColor: item.color }">
              <strong>{{ item.name }}</strong>
              <span class="eval-strategy-return" :style="{ color: item.totalReturn >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }">
                {{ formatReturn(item.totalReturn) }}
              </span>
              <span class="eval-strategy-stats">
                持仓 {{ item.filteredStats.inPosition }} · 买入 {{ item.filteredStats.buySignals }} · 卖出 {{ item.filteredStats.sellSignals }}
              </span>
              <span class="eval-strategy-count">{{ item.filteredLog.length }} / {{ item.log.length }} 条</span>
            </div>
            <div class="eval-log-table-wrap">
              <table class="eval-log-table">
                <thead><tr>
                  <th>#</th><th>时间</th><th>权益</th><th>收益率%</th><th>仓位</th><th>信号</th>
                </tr></thead>
                <tbody>
                  <tr v-for="(entry, i) in item.filteredLog" :key="i"
                    :class="{ 'eval-in-position': entry.position !== 'none', 'eval-signal-buy': entry.signal === 'buy', 'eval-signal-sell': entry.signal === 'sell' }">
                    <td>{{ entry.index }}</td>
                    <td>{{ entry.date }}</td>
                    <td>{{ entry.equity.toFixed(2) }}</td>
                    <td :class="entry.pnlPct >= 0 ? 'profit-positive' : 'profit-negative'">{{ entry.pnlPct.toFixed(2) }}%</td>
                    <td :class="entry.position === 'long' ? 'profit-positive' : entry.position === 'short' ? 'profit-negative' : ''">{{ entry.position === 'long' ? '多' : entry.position === 'short' ? '空' : '—' }}</td>
                    <td :class="entry.signal === 'buy' ? 'profit-positive' : entry.signal === 'sell' ? 'profit-negative' : ''">{{ entry.signal === 'buy' ? '买' : entry.signal === 'sell' ? '卖' : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
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
import type { BacktestResult, BacktestEvalEntry, CandleData } from '../types'
import { useBacktest } from '../composables/useBacktest'
import StatsPanel from '../components/StatsPanel.vue'
import ChartPanel from '../components/ChartPanel.vue'

const props = defineProps<{
  result: BacktestResult | null
  strategyResults: Map<string, BacktestResult> | null
  candleData: CandleData | null
}>()

const emit = defineEmits<{
  switchStrategy: [method: string]
  openPosition: [strategy: string]
}>()

const equityChartRef = ref()
const klineChartRef = ref()

const { calculateMA } = useBacktest()

// 海龟系统筛选
const systemFilter = ref<'all' | 'S1' | 'S2'>('all')

// ---- 滑动窗口评估日志 ----
const evalLogExpanded = ref(false)
const evalLogPositionFilter = ref<'' | 'long' | 'short' | 'none'>('')
const evalLogSignalFilter = ref<'' | 'buy' | 'sell' | 'hold'>('')
const evalCompareMode = ref(false)
const evalHideHold = ref(true)

const strategyColors: Record<string, string> = {
  ma_cross: '#f59e0b', turtle: '#3b82f6', grid: '#10b981', bollinger: '#a855f7', pivot: '#ec4899',
}
const strategyNames: Record<string, string> = {
  ma_cross: 'MA交叉', turtle: '海龟突破', grid: '网格交易', bollinger: '布林回归', pivot: '枢轴反转',
}

function applyEvalFilters(log: BacktestEvalEntry[]): BacktestEvalEntry[] {
  let entries = log
  if (evalHideHold.value) entries = entries.filter(e => e.signal !== 'hold')
  if (evalLogPositionFilter.value) entries = entries.filter(e => e.position === evalLogPositionFilter.value)
  if (evalLogSignalFilter.value) entries = entries.filter(e => e.signal === evalLogSignalFilter.value)
  return entries
}

const filteredEvalLog = computed(() => {
  const log = props.result?.evaluationLog
  if (!log) return []
  return applyEvalFilters(log)
})

const evalLogStats = computed(() => {
  const log = props.result?.evaluationLog
  if (!log || log.length === 0) return null
  return {
    total: log.length,
    inPosition: log.filter(e => e.position !== 'none').length,
    buySignals: log.filter(e => e.signal === 'buy').length,
    sellSignals: log.filter(e => e.signal === 'sell').length,
  }
})

const allStrategyEvalLogs = computed(() => {
  if (!props.strategyResults) return []
  const logs: Array<{
    key: string; name: string; color: string; log: BacktestEvalEntry[]
    totalReturn: number
    stats: { total: number; inPosition: number; buySignals: number; sellSignals: number }
  }> = []
  for (const [key, r] of props.strategyResults) {
    if (!r.evaluationLog?.length) continue
    logs.push({
      key, name: strategyNames[key] ?? key, color: strategyColors[key] ?? '#888',
      log: r.evaluationLog, totalReturn: r.totalReturn,
      stats: {
        total: r.evaluationLog.length,
        inPosition: r.evaluationLog.filter(e => e.position !== 'none').length,
        buySignals: r.evaluationLog.filter(e => e.signal === 'buy').length,
        sellSignals: r.evaluationLog.filter(e => e.signal === 'sell').length,
      },
    })
  }
  return logs
})

const filteredCompareLogs = computed(() => {
  return allStrategyEvalLogs.value.map(item => {
    const filtered = applyEvalFilters(item.log)
    return {
      ...item,
      filteredLog: filtered,
      filteredStats: {
        inPosition: filtered.filter(e => e.position !== 'none').length,
        buySignals: filtered.filter(e => e.signal === 'buy').length,
        sellSignals: filtered.filter(e => e.signal === 'sell').length,
      },
    }
  })
})

// 当前回测方法（旧结果无 method 字段，视为 MA 交叉）
const method = computed(() => props.result?.method ?? 'ma_cross')
const currentMethod = computed(() => method.value)

const strategyLabels: Array<{ key: string; name: string }> = [
  { key: 'ma_cross', name: 'MA交叉' },
  { key: 'turtle', name: '海龟突破' },
  { key: 'grid', name: '网格交易' },
  { key: 'bollinger', name: '布林回归' },
  { key: 'pivot', name: '枢轴反转' },
]

function getStrategyReturn(key: string): number | null {
  const r = props.strategyResults?.get(key)
  return r ? r.totalReturn : null
}

function formatReturn(val: number | null): string {
  if (val === null) return '--'
  return (val * 100).toFixed(1) + '%'
}

const closeReasonText: Record<string, string> = {
  stop_2n: '2N止损',
  channel_exit: '通道退出',
  breakout_entry: '反向突破',
  grid_tp: '网格止盈',
  grid_stop: '网格止损',
  backtest_end: '回测结束',
  bollinger_middle: '回归中轨',
  stop_loss: '止损',
  take_profit: '止盈',
  pivot_tp: '枢轴止盈',
  pivot_tp2: '枢轴目标2',
  pivot_stop: '枢轴止损',
}

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
    pnlAmount: trade.pnlAmount ?? trade.pnl * 1000
  }))
})

// 排序后的交易列表
const sortedTradesList = computed(() => {
  let list = [...tradesWithIndex.value]
  
  // 海龟系统筛选
  if (method.value === 'turtle' && systemFilter.value !== 'all') {
    list = list.filter(t => t.system === systemFilter.value)
  }
  
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
      case 'system':
        aVal = a.system ?? ''
        bVal = b.system ?? ''
        break
      case 'units':
        aVal = a.units ?? 0
        bVal = b.units ?? 0
        break
      case 'level':
        aVal = a.level ?? 0
        bVal = b.level ?? 0
        break
      case 'pivotLevel':
        aVal = a.pivotLevel ?? ''
        bVal = b.pivotLevel ?? ''
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
      case 'closeReason':
        aVal = a.closeReason ?? ''
        bVal = b.closeReason ?? ''
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

// 资金曲线图配置（多策略叠加对比）
const equityChartOption = computed(() => {
  if (!props.result || !props.candleData) return {} as EChartsOption

  const series: any[] = []
  const colors: Record<string, string> = {
    ma_cross: '#f59e0b',
    turtle: '#3b82f6',
    grid: '#10b981',
    bollinger: '#a855f7',
    pivot: '#ec4899',
  }
  const names: Record<string, string> = {
    ma_cross: 'MA交叉',
    turtle: '海龟突破',
    grid: '网格交易',
    bollinger: '布林回归',
    pivot: '枢轴反转',
  }

  if (props.strategyResults && props.strategyResults.size > 1) {
    for (const [key, r] of props.strategyResults) {
      series.push({
        name: names[key] ?? key,
        type: 'line',
        data: r.equityCurve,
        smooth: true,
        lineStyle: { color: colors[key] ?? '#888', width: key === method.value ? 2.5 : 1.5 },
        areaStyle: key === method.value ? {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: (colors[key] ?? '#888') + '40' },
              { offset: 1, color: (colors[key] ?? '#888') + '00' }
            ]
          }
        } : undefined,
        symbol: 'none',
      })
    }
  } else {
    series.push({
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
    })
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a2236',
      borderColor: '#2d3748',
      textStyle: { color: '#e2e8f0' }
    },
    legend: props.strategyResults && props.strategyResults.size > 1 ? {
      data: series.map(s => s.name),
      textStyle: { color: '#94a3b8' }
    } : undefined,
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
    series
  } as EChartsOption
})

// K线图配置
const klineChartOption = computed(() => {
  if (!props.result || !props.candleData) return {} as EChartsOption

  const showMa = method.value === 'ma_cross'
  const showBollinger = method.value === 'bollinger'
  const showPivot = method.value === 'pivot'
  const maFast = showMa ? calculateMA(props.candleData.data, props.result.maFast) : []
  const maSlow = showMa ? calculateMA(props.candleData.data, props.result.maSlow) : []

  // 布林带计算
  let bollingerMiddle: (number | null)[] = []
  let bollingerUpper: (number | null)[] = []
  let bollingerLower: (number | null)[] = []
  if (showBollinger && props.candleData.data.length > 20) {
    const period = 20
    const stdDevMult = 2
    for (let i = 0; i < props.candleData.data.length; i++) {
      if (i < period) {
        bollingerMiddle.push(null)
        bollingerUpper.push(null)
        bollingerLower.push(null)
      } else {
        const closes: number[] = []
        for (let j = i - period; j < i; j++) {
          closes.push(parseFloat(props.candleData.data[j][1]))
        }
        const mean = closes.reduce((a, b) => a + b, 0) / period
        const variance = closes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / period
        const stddev = Math.sqrt(variance)
        bollingerMiddle.push(mean)
        bollingerUpper.push(mean + stdDevMult * stddev)
        bollingerLower.push(mean - stdDevMult * stddev)
      }
    }
  }

  // 枢轴点轨道计算
  let pivotPP: (number | null)[] = []
  let pivotS1: (number | null)[] = []
  let pivotS2: (number | null)[] = []
  let pivotR1: (number | null)[] = []
  let pivotR2: (number | null)[] = []
  if (showPivot && props.candleData.data.length > 5) {
    const period = 20
    const d = props.candleData.data
    for (let i = 0; i < d.length; i++) {
      if (i < period) {
        pivotPP.push(null); pivotS1.push(null); pivotS2.push(null); pivotR1.push(null); pivotR2.push(null)
      } else {
        const recalc = i === period || (i - period) % period === 0
        if (recalc || pivotPP[i - 1] === null) {
          let hi = -Infinity, lo = Infinity
          const start = Math.max(0, i - period)
          for (let j = start; j < i; j++) {
            hi = Math.max(hi, parseFloat(d[j][3]))
            lo = Math.min(lo, parseFloat(d[j][2]))
          }
          const close = parseFloat(d[i - 1][1])
          const pp = (hi + lo + close) / 3
          pivotPP.push(pp)
          pivotS1.push(2 * pp - hi)
          pivotS2.push(pp - (hi - lo))
          pivotR1.push(2 * pp - lo)
          pivotR2.push(pp + (hi - lo))
        } else {
          pivotPP.push(pivotPP[i - 1])
          pivotS1.push(pivotS1[i - 1])
          pivotS2.push(pivotS2[i - 1])
          pivotR1.push(pivotR1[i - 1])
          pivotR2.push(pivotR2[i - 1])
        }
      }
    }
  }

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

  const symbolSize = props.result.tradesList.length > 50 ? 12 : 40

  const legendData = showMa
    ? ['K线', `MA${props.result.maFast}`, `MA${props.result.maSlow}`]
    : showBollinger
      ? ['K线', 'BB上轨', 'BB中轨', 'BB下轨']
      : showPivot
        ? ['K线', 'PP', 'S1', 'S2', 'R1', 'R2']
        : ['K线']

  const series: EChartsOption['series'] = [
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
        symbolSize,
        label: { fontSize: 10 }
      }
    }
  ]

  if (showMa) {
    series.push(
      {
        name: `MA${props.result.maFast}`,
        type: 'line',
        data: maFast,
        smooth: true,
        lineStyle: { color: '#f59e0b', width: 1 },
        symbol: 'none'
      } as any,
      {
        name: `MA${props.result.maSlow}`,
        type: 'line',
        data: maSlow,
        smooth: true,
        lineStyle: { color: '#3b82f6', width: 1 },
        symbol: 'none'
      } as any
    )
  }

  if (showBollinger) {
    series.push(
      {
        name: 'BB上轨',
        type: 'line',
        data: bollingerUpper,
        smooth: true,
        lineStyle: { color: '#a855f7', width: 1, type: 'dashed' },
        symbol: 'none'
      } as any,
      {
        name: 'BB中轨',
        type: 'line',
        data: bollingerMiddle,
        smooth: true,
        lineStyle: { color: '#f59e0b', width: 1 },
        symbol: 'none'
      } as any,
      {
        name: 'BB下轨',
        type: 'line',
        data: bollingerLower,
        smooth: true,
        lineStyle: { color: '#a855f7', width: 1, type: 'dashed' },
        symbol: 'none'
      } as any
    )
  }

  if (showPivot) {
    const pivotColors: Record<string, string> = { PP: '#f59e0b', S1: '#10b981', S2: '#10b981', R1: '#ef4444', R2: '#ef4499' }
    const pivotData: Record<string, (number | null)[]> = { PP: pivotPP, S1: pivotS1, S2: pivotS2, R1: pivotR1, R2: pivotR2 }
    for (const [name, data] of Object.entries(pivotData)) {
      series.push({
        name,
        type: 'line',
        data,
        smooth: false,
        lineStyle: { color: pivotColors[name], width: 1, type: 'dashed' },
        symbol: 'none'
      } as any)
    }
  }

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
      data: legendData,
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
    series
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

.strategy-switcher {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: var(--bg-card);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

.strategy-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
  font-family: 'Space Mono', monospace;
}

.strategy-btn:hover {
  border-color: var(--accent-blue);
  color: var(--text-primary);
}

.strategy-btn.active {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
}

.strategy-return {
  font-size: 0.75rem;
  opacity: 0.8;
}

.strategy-btn.active .strategy-return {
  opacity: 1;
}

.position-btn {
  margin-left: auto;
  background: rgba(245, 158, 11, 0.15);
  border-color: var(--accent-gold);
  color: var(--accent-gold);
}

.position-btn:hover {
  background: var(--accent-gold);
  color: #fff;
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

.system-filter {
  display: flex;
  gap: 8px;
}

.filter-btn {
  padding: 6px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
  font-family: 'Space Mono', monospace;
}

.filter-btn:hover {
  border-color: var(--accent-blue);
  color: var(--text-primary);
}

.filter-btn.active {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
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

.eval-log-section { margin-top: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); }
.eval-log-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; user-select: none; }
.eval-log-header:hover { background: var(--bg-card); }
.eval-log-toggle { font-size: .7rem; color: var(--text-secondary); width: 12px; }
.eval-log-badge { padding: 1px 8px; border-radius: 8px; font-size: .7rem; background: rgba(59, 130, 246, 0.15); color: var(--accent-blue, #3b82f6); }
.eval-log-stats-inline { font-size: .75rem; color: var(--text-secondary); margin-left: auto; }
.eval-log-body { padding: 0 14px 14px; }
.eval-log-filters { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.eval-log-select { padding: 4px 8px; font-size: .8rem; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-card); color: var(--text-primary); }
.eval-log-filter-hint { font-size: .75rem; color: var(--text-secondary); margin-left: auto; }
.eval-hide-hold { display: flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
.eval-hide-hold input { accent-color: var(--accent-blue); cursor: pointer; }
.eval-log-table-wrap { max-height: 500px; overflow: auto; border: 1px solid var(--border-color); border-radius: 4px; }
.eval-log-table { width: 100%; border-collapse: collapse; font-size: .78rem; white-space: nowrap; }
.eval-log-table th { position: sticky; top: 0; background: var(--bg-card); padding: 6px 10px; text-align: left; font-weight: 600; border-bottom: 1px solid var(--border-color); z-index: 1; }
.eval-log-table td { padding: 4px 10px; border-bottom: 1px solid var(--border-color); }
.eval-log-table tr:last-child td { border-bottom: none; }
.eval-log-table tr.eval-in-position { background: rgba(16, 185, 129, 0.04); }
.eval-log-table tr.eval-signal-buy { border-left: 3px solid var(--accent-green); }
.eval-log-table tr.eval-signal-sell { border-left: 3px solid var(--accent-red); }

.eval-compare-toggle {
  margin-left: auto;
  padding: 2px 10px;
  font-size: .72rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.eval-compare-toggle:hover { border-color: var(--accent-blue); color: var(--text-primary); }
.eval-compare-toggle.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }

.eval-compare-sections { display: flex; flex-direction: column; gap: 12px; }
.eval-strategy-block { border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
.eval-strategy-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-left: 3px solid;
  background: var(--bg-card);
}
.eval-strategy-header strong { font-size: .85rem; color: var(--text-primary); }
.eval-strategy-return { font-size: .75rem; font-family: 'Space Mono', monospace; }
.eval-strategy-stats { font-size: .72rem; color: var(--text-secondary); }
.eval-strategy-count { font-size: .7rem; color: var(--text-secondary); margin-left: auto; opacity: .7; }
</style>
