<template>
  <div class="trading-console">
    <section class="console-hero">
      <div>
        <p class="eyebrow">FUTURES · ISOLATED · DRY-RUN</p>
        <h2>模拟交易控制台</h2>
        <p class="muted">账户、持仓和收益每 15 秒自动同步。</p>
      </div>
      <div class="connection" :class="statusAvailable ? 'online' : 'offline'">
        <span class="dot" />
        {{ statusAvailable ? 'Freqtrade 已连接' : 'Freqtrade 未连接' }}
      </div>
    </section>

    <section class="panel account-panel">
      <div class="section-header">
        <div>
          <p class="section-kicker">ACCOUNT OVERVIEW</p>
          <h3>账户总览</h3>
        </div>
        <button class="btn refresh-btn" :disabled="refreshing" @click="refresh">
          {{ refreshing ? '同步中' : '刷新数据' }}
        </button>
      </div>

      <div v-if="snapshot.available" class="account-grid">
        <article class="account-card primary-card">
          <span class="metric-label">账户总权益</span>
          <strong>{{ formatMoney(accountSummary.total) }}</strong>
          <small>USDT</small>
        </article>
        <article class="account-card">
          <span class="metric-label">可用余额</span>
          <strong>{{ formatMoney(accountSummary.free) }}</strong>
          <small>USDT</small>
        </article>
        <article class="account-card">
          <span class="metric-label">已占用资金</span>
          <strong>{{ formatMoney(accountSummary.used) }}</strong>
          <small>{{ utilizationText }}</small>
        </article>
        <article class="account-card" :class="profitClass(openProfitAbs)">
          <span class="metric-label">持仓浮动收益</span>
          <strong>{{ formatSignedMoney(openProfitAbs) }}</strong>
          <small>{{ formatPercent(openProfitRatio) }}</small>
        </article>
        <article class="account-card">
          <span class="metric-label">当前持仓</span>
          <strong>{{ positions.length }} / {{ maxOpenTrades }}</strong>
          <small>可用 {{ Math.max(maxOpenTrades - positions.length, 0) }} 个仓位</small>
        </article>
      </div>
      <p v-else class="muted empty">{{ snapshot.error || '等待 Freqtrade 服务' }}</p>
    </section>

    <section v-if="historicalDownload.enabled" class="panel data-download-panel">
      <div class="section-header"><div><p class="section-kicker">BACKTEST DATA</p><h3>下载历史数据</h3></div><button class="btn" :disabled="historicalDownload.status === 'running'" @click="startHistoricalDownload">{{ historicalDownload.status === 'running' ? '下载中...' : '下载 OKX K 线' }}</button></div>
      <p class="muted">下载 1H / 4H 历史数据，用于期货策略回测。</p>
      <div class="download-controls"><input v-model="historicalTimerange" pattern="\d{8}-\d{8}" aria-label="历史数据时间范围" /><span :class="historicalDownload.status">{{ historicalDownload.message || '准备就绪' }}</span></div>
    </section>

    <section class="panel">
      <div class="section-header">
        <div>
          <p class="section-kicker">OPEN POSITIONS</p>
          <h3>当前模拟持仓 <span class="count">{{ positions.length }}</span></h3>
        </div>
        <span class="muted sync-time">每 15 秒同步</span>
      </div>

      <div v-if="positions.length" class="positions-grid">
        <article v-for="position in positions" :key="position.id" class="position-card" :class="position.side">
          <div class="position-head">
            <div>
              <strong class="pair-name">{{ position.pair }}</strong>
              <span class="side-badge" :class="position.side">{{ position.side === 'long' ? '做多' : '做空' }}</span>
            </div>
            <div class="position-profit" :class="profitClass(position.currentProfitAbs ?? position.currentProfit)">
              <span>浮动收益</span>
              <strong>{{ formatSignedMoney(position.currentProfitAbs) }}</strong>
              <small>{{ formatPercent(position.currentProfit) }}</small>
            </div>
          </div>
          <div class="position-metrics">
            <div><span>入场价</span><b>{{ formatPrice(position.actualEntryPrice ?? position.entryPrice) }}</b></div>
            <div><span>当前价</span><b>{{ formatPrice(position.currentRate) }}</b></div>
            <div><span>持仓数量</span><b>{{ formatAmount(position.amount) }}</b></div>
            <div><span>保证金</span><b>{{ formatMoney(position.margin) }} USDT</b></div>
            <div><span>杠杆</span><b>{{ position.leverage }}×</b></div>
            <div><span>止损价</span><b class="danger">{{ formatPrice(position.stopLoss ?? position.stopPrice) }}</b></div>
          </div>
          <div class="position-foot">
            <span>Trade ID · {{ position.tradeId || '--' }}</span>
            <span>{{ formatTime(position.submittedAt ?? position.createdAt) }}</span>
          </div>
        </article>
      </div>
      <p v-else class="muted empty">暂无持仓。批准计划后，执行器会自动尝试开仓。</p>
    </section>

    <section class="panel equity-panel">
      <div class="section-header"><div><p class="section-kicker">EQUITY CURVE</p><h3>收益曲线</h3></div><div class="equity-controls"><button v-for="range in equityRanges" :key="range.value" class="btn btn-small" :class="{ active: equityRange === range.value }" @click="equityRange = range.value">{{ range.label }}</button></div></div>
      <div class="equity-stats"><span>累计收益 <b :class="profitClass(totalEquityPnl)">{{ formatSignedMoney(totalEquityPnl) }} USDT</b></span><span>峰值回撤 <b class="loss">{{ formatMoney(maxDrawdown) }} USDT</b></span></div>
      <svg v-if="equityPoints.length > 1" class="equity-chart" viewBox="0 0 800 180" preserveAspectRatio="none" role="img" aria-label="收益曲线">
        <polyline :points="equityPolyline" fill="none" stroke="var(--accent-blue)" stroke-width="3" vector-effect="non-scaling-stroke" />
        <line x1="0" :y1="zeroY" x2="800" :y2="zeroY" stroke="var(--border-color)" stroke-dasharray="4 5" />
      </svg><div v-if="equityPoints.length > 1" class="equity-axis"><span v-for="point in equityAxisLabels" :key="point.key">{{ point.label }}</span></div><p v-else class="muted empty">完成交易后将显示收益曲线</p>
    </section>

    <section class="panel">
      <div class="section-header">
        <div>
          <p class="section-kicker">CLOSED POSITIONS</p>
          <h3>历史持仓 <span class="count">{{ history.length }}</span></h3>
        </div>
        <div class="history-summary">
          <button class="btn btn-small" @click="downloadDiagnostics">导出诊断</button>
          <span>累计收益</span>
          <b :class="profitClass(realizedTotal)">{{ formatSignedMoney(realizedTotal) }} USDT</b>
        </div>
      </div>

      <div v-if="history.length" class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th>交易对</th>
              <th>方向</th>
              <th>入场 / 平仓</th>
              <th>持仓时间</th>
              <th>收益率</th>
              <th>已实现收益</th>
              <th>平仓原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="position in history" :key="position.id">
              <td><strong>{{ position.pair }}</strong><small>#{{ position.tradeId || '--' }}</small></td>
              <td><span class="side-badge" :class="position.side">{{ position.side === 'long' ? '做多' : '做空' }}</span></td>
              <td><b>{{ formatPrice(position.actualEntryPrice ?? position.entryPrice) }}</b><span>→</span><b>{{ formatPrice(position.exitRate) }}</b></td>
              <td><b>{{ formatDuration(position.submittedAt ?? position.createdAt, position.closedAt) }}</b><small>{{ formatTime(position.closedAt) }}</small></td>
              <td><b :class="profitClass(position.currentProfit)">{{ formatPercent(position.currentProfit) }}</b></td>
              <td><b :class="profitClass(position.realizedPnl)">{{ formatSignedMoney(position.realizedPnl) }} USDT</b></td>
              <td>{{ closeReasonLabel(position.closeReason) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted empty">暂无已平仓记录。</p>
    </section>

    <section class="panel">
      <div class="section-header">
        <div>
          <p class="section-kicker">TRADE PLANS</p>
          <h3>交易计划</h3>
        </div>
        <button class="btn btn-danger" :disabled="clearingPlans" @click="handleClearPlans">
          {{ clearingPlans ? '清空中…' : '清空全部计划' }}
        </button>
      </div>
      <div v-if="plans.length" class="plans">
        <article v-for="plan in plans" :key="plan.id" class="plan" :class="plan.side">
          <div class="plan-top">
            <strong>{{ plan.pair }}</strong>
            <span class="side-badge" :class="plan.side">{{ plan.side === 'long' ? '做多' : '做空' }}</span>
            <span class="state">{{ statusLabel(plan.status) }}</span>
          </div>
          <div class="plan-metrics">
            <span>入场 <b>{{ formatPrice(plan.entryPrice) }}</b></span>
            <span>止损 <b>{{ formatPrice(plan.stopPrice) }}</b></span>
            <span>TP1 / TP2 <b>{{ formatPrice(plan.takeProfit1) }} / {{ formatPrice(plan.takeProfit2) }}</b></span>
            <span>最大亏损 <b>{{ formatMoney(plan.maxLoss) }} USDT</b></span>
          </div>
          <div class="profit-comparison">
            <div>
              <span>TP1 计划收益</span>
              <b>{{ formatSignedMoney(plannedProfit(plan, plan.takeProfit1)) }} USDT</b>
            </div>
            <div>
              <span>TP2 计划收益</span>
              <b>{{ formatSignedMoney(plannedProfit(plan, plan.takeProfit2)) }} USDT</b>
            </div>
            <div>
              <span>{{ plan.status === 'closed' ? '实际收益' : '当前实际收益' }}</span>
              <b :class="profitClass(actualProfit(plan))">{{ formatSignedMoney(actualProfit(plan)) }} USDT</b>
            </div>
            <div>
              <span>相对 TP1</span>
              <b :class="profitClass(profitDifference(plan))">{{ formatSignedMoney(profitDifference(plan)) }} USDT</b>
            </div>
          </div>
          <p v-if="plan.status === 'closed' && actualProfit(plan) !== undefined" class="profit-progress">
            实际收益达到 TP1 计划的 {{ formatAchievement(plan) }}
          </p>
          <p v-if="plan.executionError" class="error">执行失败：{{ plan.executionError }}</p>
          <div v-if="plan.status === 'pending'" class="actions">
            <button class="btn approve" @click="changeStatus(plan.id, 'approve')">批准</button>
            <button class="btn reject" @click="changeStatus(plan.id, 'reject')">拒绝</button>
          </div>
          <div v-else-if="plan.status === 'submit_failed'" class="actions">
            <button class="btn approve" @click="retryPlan(plan.id)">手动重试</button>
          </div>
        </article>
      </div>
      <p v-else class="muted empty">暂无交易计划。</p>
    </section>

    <p v-if="error" class="page-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useNotifyAPI } from '../composables/useNotifyAPI'
import type { TradePlan } from '../types'

interface BalanceItem {
  currency?: string
  curr?: string
  total?: number
  balance?: number
  free?: number
  available?: number
  used?: number
}

interface TradingSnapshot {
  available: boolean
  error?: string
  balance?: {
    currencies?: BalanceItem[]
    total?: Record<string, number>
    free?: Record<string, number>
    used?: Record<string, number>
    value?: number
    value_bot?: number
  }
}

const api = useNotifyAPI()
const plans = ref<TradePlan[]>([])
const positions = ref<TradePlan[]>([])
const history = ref<TradePlan[]>([])
const snapshot = ref<TradingSnapshot>({ available: false })
const statusAvailable = ref(false)
const refreshing = ref(false)
const clearingPlans = ref(false)
const error = ref('')
const historicalTimerange = ref('20250101-20260729')
const historicalDownload = ref<{ enabled: boolean; status: string; message?: string }>({ enabled: false, status: 'idle' })
const maxOpenTrades = ref(30)
let timer: number | undefined

const accountSummary = computed(() => {
  const balance = snapshot.value.balance
  const usdt = balance?.currencies?.find(item => (item.currency ?? item.curr) === 'USDT')
  const total = numberOrZero(usdt?.total ?? usdt?.balance ?? balance?.total?.USDT ?? balance?.value ?? balance?.value_bot)
  const free = numberOrZero(usdt?.free ?? usdt?.available ?? balance?.free?.USDT)
  const used = numberOrZero(usdt?.used ?? balance?.used?.USDT) || Math.max(total - free, 0)
  return { total, free, used }
})

const openProfitAbs = computed(() => positions.value.reduce((sum, position) => sum + numberOrZero(position.currentProfitAbs), 0))
const openProfitRatio = computed(() => {
  const notional = positions.value.reduce((sum, position) => sum + numberOrZero(position.notional), 0)
  return notional ? openProfitAbs.value / notional : 0
})
const realizedTotal = computed(() => history.value.reduce((sum, position) => sum + numberOrZero(position.realizedPnl), 0))
const equityRange = ref<'day' | 'week' | 'month'>('day')
const equityRanges = [{ value: 'day' as const, label: '当日' }, { value: 'week' as const, label: '本周' }, { value: 'month' as const, label: '本月' }]
const rangeStart = computed(() => { const now = new Date(); if (equityRange.value === 'day') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); if (equityRange.value === 'week') { const day = now.getDay() || 7; return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1).getTime() } return new Date(now.getFullYear(), now.getMonth(), 1).getTime() })
const equityPoints = computed(() => {
  let total = 0
  return [...history.value].filter(item => (item.closedAt ?? item.updatedAt) >= rangeStart.value).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0)).map(item => ({ time: item.closedAt ?? item.updatedAt, value: total += numberOrZero(item.realizedPnl) }))
})
const totalEquityPnl = computed(() => equityPoints.value.at(-1)?.value ?? 0)
const maxDrawdown = computed(() => { let peak = 0; let drawdown = 0; for (const p of equityPoints.value) { peak = Math.max(peak, p.value); drawdown = Math.max(drawdown, peak - p.value) } return drawdown })
const equityPolyline = computed(() => { const values = equityPoints.value.map(p => p.value); const min = Math.min(0, ...values); const max = Math.max(0, ...values, 1); return equityPoints.value.map((p, i) => `${(i / Math.max(values.length - 1, 1)) * 800},${165 - ((p.value - min) / (max - min)) * 145}`).join(' ') })
const zeroY = computed(() => { const values = equityPoints.value.map(p => p.value); const min = Math.min(0, ...values); const max = Math.max(0, ...values, 1); return 165 - ((0 - min) / (max - min)) * 145 })
const equityAxisLabels = computed(() => equityPoints.value.filter((_, i, all) => i === 0 || i === all.length - 1 || i === Math.floor((all.length - 1) / 2)).map(point => ({ key: point.time, label: new Date(point.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })))
const utilizationText = computed(() => accountSummary.value.total
  ? `使用率 ${((accountSummary.value.used / accountSummary.value.total) * 100).toFixed(1)}%`
  : '使用率 --')

async function refresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const [planData, positionData, historyData, status, snapshotData, downloadStatus] = await Promise.all([
      api.getTradePlans(),
      api.getTradingPositions(),
      api.getTradingHistory(),
      api.getTradingStatus(),
      api.getTradingSnapshot(),
      api.getHistoricalDataDownloadStatus()
    ])
    plans.value = planData
    positions.value = positionData
    history.value = historyData
    const statusPayload = status as { available?: boolean; maxOpenTrades?: number }
    statusAvailable.value = statusPayload.available === true
    if (Number.isFinite(statusPayload.maxOpenTrades)) maxOpenTrades.value = Number(statusPayload.maxOpenTrades)
    snapshot.value = snapshotData as TradingSnapshot
    historicalDownload.value = downloadStatus
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    refreshing.value = false
  }
}

async function handleClearPlans(): Promise<void> {
  if (!confirm('确定要清空所有交易计划吗？此操作不可恢复。')) return
  clearingPlans.value = true
  try {
    await api.clearTradePlans()
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '清空交易计划失败'
  } finally {
    clearingPlans.value = false
  }
}

async function startHistoricalDownload(): Promise<void> {
  if (!/^\d{8}-\d{8}$/.test(historicalTimerange.value)) { error.value = '时间范围格式应为 YYYYMMDD-YYYYMMDD'; return }
  try { await api.downloadHistoricalData(historicalTimerange.value); await refresh() }
  catch (err) { error.value = err instanceof Error ? err.message : '历史数据下载启动失败' }
}

async function changeStatus(id: string, status: 'approve' | 'reject'): Promise<void> {
  try {
    await api.setTradePlanStatus(id, status)
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '更新失败'
  }
}

async function retryPlan(id: string): Promise<void> {
  try {
    await api.retryTradePlan(id)
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '重试失败'
  }
}

async function downloadDiagnostics(): Promise<void> {
  try {
    const blob = await api.exportTradingDiagnostics()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `trading-diagnostics-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '导出失败'
  }
}

function numberOrZero(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function actualProfit(plan: TradePlan): number | undefined {
  if (plan.status === 'closed') return plan.realizedPnl
  return plan.currentProfitAbs
}

function plannedProfit(plan: TradePlan, targetPrice: number): number {
  const priceChange = plan.side === 'long'
    ? (targetPrice - plan.entryPrice) / plan.entryPrice
    : (plan.entryPrice - targetPrice) / plan.entryPrice
  return plan.notional * priceChange
}

function profitDifference(plan: TradePlan): number | undefined {
  const actual = actualProfit(plan)
  return actual === undefined ? undefined : actual - plannedProfit(plan, plan.takeProfit1)
}

function formatAchievement(plan: TradePlan): string {
  const target = plannedProfit(plan, plan.takeProfit1)
  const actual = actualProfit(plan)
  if (actual === undefined || target === 0) return '--'
  return `${((actual / target) * 100).toFixed(1)}%`
}

function statusLabel(status: TradePlan['status']): string {
  return ({ pending: '待审批', approved: '待执行', submitting: '提交中', open: '持仓中', closed: '已平仓', rejected: '已拒绝', expired: '已过期', submit_failed: '执行失败' })[status]
}

function profitClass(value?: number): string {
  if (numberOrZero(value) > 0) return 'profit'
  if (numberOrZero(value) < 0) return 'loss'
  return 'neutral'
}

function formatMoney(value?: number): string {
  return value === undefined || !Number.isFinite(Number(value)) ? '--' : Number(value).toFixed(2)
}

function formatSignedMoney(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}`
}

function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  const number = Number(value) * 100
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}

function formatPrice(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  const number = Number(value)
  return number >= 100 ? number.toFixed(2) : number >= 1 ? number.toFixed(4) : number.toFixed(6)
}

function formatAmount(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(start?: number, end?: number): string {
  if (!start || !end || end < start) return '--'
  const minutes = Math.floor((end - start) / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

function closeReasonLabel(reason?: string): string {
  if (!reason) return '--'
  const labels: Record<string, string> = {
    roi: '达到目标收益',
    stop_loss: '触发止损',
    stoploss_on_exchange: '交易所止损',
    trailing_stop_loss: '移动止损',
    exit_signal: '策略离场',
    force_exit: '手动平仓'
  }
  return labels[reason] ?? reason
}

function handleBrowserOnline(): void {
  void refresh()
}

onMounted(() => {
  void refresh()
  window.addEventListener('online', handleBrowserOnline)
  timer = window.setInterval(refresh, 15_000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
  window.removeEventListener('online', handleBrowserOnline)
})
</script>

<style scoped>
.trading-console {
  display: flex;
  flex-direction: column;
  gap: 18px;
  text-align: left;
}

.console-hero,
.panel {
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: var(--bg-card);
}

.console-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 26px;
  background:
    radial-gradient(circle at 10% 0%, rgba(59, 130, 246, 0.22), transparent 40%),
    linear-gradient(135deg, #18243a, #111827);
}

.console-hero h2,
.panel h3 {
  margin: 0;
  color: var(--text-primary);
}

.console-hero h2 {
  margin-bottom: 5px;
  font-size: 1.45rem;
}

.eyebrow,
.section-kicker {
  margin: 0 0 6px;
  color: var(--accent-blue);
  font: 700 0.65rem 'Space Mono', monospace;
  letter-spacing: 1.6px;
}

.muted {
  color: var(--text-secondary);
}

.connection {
  flex: 0 0 auto;
  padding: 9px 13px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
}

.connection.online {
  color: #34d399;
  background: rgba(16, 185, 129, 0.12);
}

.connection.offline {
  color: #f87171;
  background: rgba(239, 68, 68, 0.12);
}

.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 10px currentColor;
}

.panel {
  padding: 22px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-header h3 {
  font-size: 1.05rem;
}

.count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  margin-left: 5px;
  border-radius: 6px;
  color: var(--accent-blue);
  background: rgba(59, 130, 246, 0.12);
  font: 700 0.68rem 'Space Mono', monospace;
}

.btn {
  padding: 8px 13px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s;
}

.btn:hover:not(:disabled) {
  border-color: var(--accent-blue);
  transform: translateY(-1px);
}

.btn:disabled {
  cursor: wait;
  opacity: 0.6;
}

.account-grid {
  display: grid;
  grid-template-columns: 1.25fr repeat(4, 1fr);
  gap: 10px;
}

.account-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 12px;
  background: #111a2b;
}

.account-card.primary-card {
  border-color: rgba(59, 130, 246, 0.3);
  background: linear-gradient(145deg, rgba(59, 130, 246, 0.17), rgba(17, 26, 43, 0.9));
}

.metric-label,
.account-card small {
  display: block;
  color: var(--text-secondary);
  font-size: 0.7rem;
}

.account-card strong {
  display: block;
  overflow: hidden;
  margin: 8px 0 4px;
  color: var(--text-primary);
  font: 700 1.2rem 'Space Mono', monospace;
  text-overflow: ellipsis;
}

.positions-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.position-card {
  position: relative;
  overflow: hidden;
  padding: 17px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: #121b2c;
}

.position-card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--accent-green);
  content: '';
}

.position-card.short::before {
  background: var(--accent-red);
}

.position-head,
.position-head > div,
.plan-top {
  display: flex;
  align-items: center;
  gap: 9px;
}

.position-head {
  justify-content: space-between;
}

.pair-name {
  color: var(--text-primary);
  font-size: 0.95rem;
}

.side-badge {
  display: inline-flex;
  padding: 3px 7px;
  border-radius: 5px;
  font-size: 0.68rem;
  font-weight: 700;
}

.side-badge.long {
  color: #34d399;
  background: rgba(16, 185, 129, 0.12);
}

.side-badge.short {
  color: #f87171;
  background: rgba(239, 68, 68, 0.12);
}

.equity-controls { display: flex; gap: 6px; }
.equity-controls .btn.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }
.equity-stats { display: flex; gap: 28px; color: var(--text-secondary); font-size: .82rem; margin-bottom: 12px; }
.equity-stats b { margin-left: 8px; color: var(--text-primary); }
.equity-chart { display: block; width: 100%; height: 180px; border-radius: 8px; background: rgba(15, 23, 42, .45); }
.equity-axis { display: flex; justify-content: space-between; color: var(--text-secondary); font: .68rem 'Space Mono', monospace; margin-top: 7px; }
.data-download-panel .muted { margin: -6px 0 14px; }
.download-controls { display: flex; align-items: center; gap: 12px; }
.download-controls input { width: 160px; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); font: .8rem 'Space Mono', monospace; }
.download-controls span { color: var(--text-secondary); font-size: .8rem; }
.download-controls span.running { color: var(--accent-blue); }
.download-controls span.completed { color: var(--accent-green); }
.download-controls span.failed { color: var(--accent-red); }

.position-profit {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.position-profit span,
.position-profit small {
  font-size: 0.66rem;
}

.position-profit span {
  color: var(--text-secondary);
}

.position-profit strong {
  margin: 2px 0;
  font: 700 1.05rem 'Space Mono', monospace;
}

.position-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 18px;
}

.position-metrics div {
  min-width: 0;
}

.position-metrics span,
.position-metrics b {
  display: block;
}

.position-metrics span {
  margin-bottom: 4px;
  color: var(--text-secondary);
  font-size: 0.68rem;
}

.position-metrics b,
.plan-metrics b {
  overflow: hidden;
  color: var(--text-primary);
  font: 600 0.78rem 'Space Mono', monospace;
  text-overflow: ellipsis;
}

.position-foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
  padding-top: 10px;
  border-top: 1px dashed rgba(148, 163, 184, 0.16);
  color: var(--text-secondary);
  font: 0.63rem 'Space Mono', monospace;
}

.history-summary {
  text-align: right;
}

.history-summary span,
.history-summary b {
  display: block;
}

.history-summary span {
  color: var(--text-secondary);
  font-size: 0.68rem;
}

.history-summary b {
  margin-top: 3px;
  font: 700 0.9rem 'Space Mono', monospace;
}

.history-table-wrap {
  overflow-x: auto;
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
}

.history-table th,
.history-table td {
  padding: 12px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  text-align: left;
  white-space: nowrap;
}

.history-table th {
  color: var(--text-secondary);
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.5px;
}

.history-table td {
  color: var(--text-secondary);
}

.history-table td > strong,
.history-table td > small {
  display: block;
}

.history-table td > strong,
.history-table td b {
  color: var(--text-primary);
}

.history-table td small {
  margin-top: 3px;
  color: #64748b;
  font: 0.62rem 'Space Mono', monospace;
}

.history-table td:nth-child(3) span {
  margin: 0 5px;
  color: #64748b;
}

.plans {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.plan {
  padding: 15px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--accent-green);
  border-radius: 10px;
  background: #121b2c;
}

.plan.short {
  border-left-color: var(--accent-red);
}

.plan-top strong {
  color: var(--text-primary);
}

.state {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 0.7rem;
}

.plan-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin-top: 13px;
  color: var(--text-secondary);
  font-size: 0.72rem;
}

.profit-comparison {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed rgba(148, 163, 184, 0.16);
}

.profit-comparison div {
  min-width: 0;
  padding: 9px 10px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.48);
}

.profit-comparison span,
.profit-comparison b {
  display: block;
}

.profit-comparison span {
  margin-bottom: 4px;
  color: var(--text-secondary);
  font-size: 0.64rem;
}

.profit-comparison b {
  overflow: hidden;
  color: var(--text-primary);
  font: 700 0.72rem 'Space Mono', monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profit-progress {
  margin: 9px 0 0;
  color: var(--text-secondary);
  font-size: 0.68rem;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.approve {
  border-color: var(--accent-blue);
  color: #fff;
  background: var(--accent-blue);
}

.reject,
.error,
.page-error,
.danger,
.loss {
  color: #f87171 !important;
}

.profit {
  color: #34d399 !important;
}

.neutral {
  color: var(--text-primary) !important;
}

.error {
  margin-top: 12px;
  font-size: 0.72rem;
  word-break: break-word;
}

.empty {
  padding: 22px;
  text-align: center;
}

.page-error {
  margin: 0;
  padding: 10px 14px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  font-size: 0.75rem;
}

.btn-danger {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #ef4444;
}
.btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.22);
}

@media (max-width: 1100px) {
  .account-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .positions-grid,
  .plans {
    grid-template-columns: 1fr;
  }

  .profit-comparison {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .console-hero,
  .section-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .account-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .position-metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .history-summary {
    text-align: left;
  }
}

@media (max-width: 460px) {
  .account-grid {
    grid-template-columns: 1fr;
  }
}
</style>
