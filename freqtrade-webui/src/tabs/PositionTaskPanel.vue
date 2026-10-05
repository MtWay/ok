<template>
  <div class="position-panel">
    <div class="panel-header">
      <h3>策略建仓任务</h3>
      <button class="btn btn-primary btn-sm" @click="showCreateForm = true">
        + 新建任务
      </button>
    </div>

    <!-- 创建表单 -->
    <div v-if="showCreateForm" class="create-form">
      <div class="form-row">
        <div class="form-group">
          <label>任务名称</label>
          <input v-model="form.name" type="text" placeholder="例: BTC布林回归">
        </div>
        <div class="form-group">
          <label>交易对</label>
          <input v-model="form.pair" type="text" placeholder="BTC-USDT-SWAP">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>策略</label>
          <select v-model="form.strategy">
            <option value="ma_cross">MA交叉</option>
            <option value="turtle">海龟突破</option>
            <option value="bollinger">布林回归</option>
            <option value="grid">网格交易</option>
          </select>
        </div>
        <div class="form-group">
          <label>检测间隔</label>
          <select v-model="form.interval">
            <option value="5m">5分钟</option>
            <option value="15m">15分钟</option>
            <option value="1H">1小时</option>
            <option value="4H">4小时</option>
          </select>
        </div>
      </div>

      <!-- MA Cross 参数 -->
      <div v-if="form.strategy === 'ma_cross'" class="form-row">
        <div class="form-group">
          <label>快线周期</label>
          <input v-model.number="(form.params as any).fastPeriod" type="number" min="3" max="50">
        </div>
        <div class="form-group">
          <label>慢线周期</label>
          <input v-model.number="(form.params as any).slowPeriod" type="number" min="10" max="200">
        </div>
      </div>

      <!-- Turtle 参数 -->
      <div v-if="form.strategy === 'turtle'" class="form-row">
        <div class="form-group">
          <label>入场通道</label>
          <input v-model.number="(form.params as any).entryBars" type="number" min="5" max="100">
        </div>
        <div class="form-group">
          <label>退出通道</label>
          <input v-model.number="(form.params as any).exitBars" type="number" min="3" max="50">
        </div>
        <div class="form-group">
          <label>最大单位</label>
          <input v-model.number="(form.params as any).maxUnits" type="number" min="1" max="8">
        </div>
      </div>

      <!-- Bollinger 参数 -->
      <div v-if="form.strategy === 'bollinger'" class="form-row">
        <div class="form-group">
          <label>周期</label>
          <input v-model.number="(form.params as any).period" type="number" min="10" max="50">
        </div>
        <div class="form-group">
          <label>标准差倍数</label>
          <input v-model.number="(form.params as any).stdDev" type="number" min="1" max="4" step="0.1">
        </div>
      </div>

      <!-- Grid 参数 -->
      <div v-if="form.strategy === 'grid'" class="form-row">
        <div class="form-group">
          <label>回看周期</label>
          <input v-model.number="(form.params as any).lookback" type="number" min="20" max="300">
        </div>
        <div class="form-group">
          <label>网格数</label>
          <input v-model.number="(form.params as any).gridCount" type="number" min="2" max="50">
        </div>
      </div>
      <div v-if="form.strategy === 'grid'" class="form-row">
        <div class="form-group">
          <label>止损%</label>
          <input v-model.number="(form.params as any).stopPercent" type="number" min="0.5" max="10" step="0.5" placeholder="默认2">
        </div>
        <div class="form-group">
          <label>最大层数</label>
          <input v-model.number="(form.params as any).maxLevels" type="number" min="1" max="10" placeholder="默认=网格数">
        </div>
        <div class="form-group">
          <label>趋势过滤</label>
          <select v-model="(form.params as any).trendFilter">
            <option :value="true">开启</option>
            <option :value="false">关闭</option>
          </select>
        </div>
      </div>

      <!-- Pivot 参数 -->
      <div v-if="form.strategy === 'pivot'" class="form-row">
        <div class="form-group">
          <label>枢轴周期</label>
          <input v-model.number="(form.params as any).pivotPeriod" type="number" min="5" max="100">
        </div>
        <div class="form-group">
          <label>触及阈值%</label>
          <input v-model.number="(form.params as any).threshold" type="number" min="0" max="3" step="0.1">
        </div>
        <div class="form-group">
          <label>止损%</label>
          <input v-model.number="(form.params as any).stopPercent" type="number" min="0.5" max="10" step="0.5">
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-sm" @click="handleCreate">创建</button>
        <button class="btn btn-secondary btn-sm" @click="showCreateForm = false">取消</button>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="task-list">
      <div v-if="tasks.length === 0" class="empty-state">
        暂无建仓任务，从回测结果页点击"建仓"或点击上方"新建任务"创建
      </div>
      <div v-for="task in tasks" :key="task.id" class="task-card" :class="{ disabled: !task.enabled }">
        <div class="task-header">
          <div class="task-title">
            <span class="task-name">{{ task.name }}</span>
            <span class="task-pair" @click="emit('selectPair', task.pair)">{{ task.pair }}</span>
            <span v-if="!isPairInWhitelist(task.pair)" class="whitelist-badge not-in-list" title="该交易对不在白名单中">⚠ 未在白名单</span>
            <span class="task-strategy">{{ strategyLabel(task.strategy) }}</span>
            <span class="task-interval">{{ task.interval }}</span>
          </div>
          <div class="task-actions">
            <button class="btn btn-sm" :class="task.enabled ? 'btn-warning' : 'btn-success'" @click="handleToggle(task)">
              {{ task.enabled ? '暂停' : '启用' }}
            </button>
            <button class="btn btn-secondary btn-sm" @click="handleTrigger(task)">手动触发</button>
            <button
              class="btn btn-danger btn-sm"
              :disabled="!canClose(task)"
              @click="openCloseDialog(task)"
            >手动平仓</button>
            <button class="btn btn-secondary btn-sm" @click="toggleParams(task)">
              {{ paramsTaskId === task.id ? '收起参数' : '策略参数' }}
            </button>
            <button class="btn btn-secondary btn-sm" @click="toggleExpand(task)">
              {{ expandedTaskId === task.id ? '收起记录' : '交易记录' }}
              <span v-if="taskStats[task.id]" class="trade-count">{{ taskStats[task.id].tradeCount }}</span>
            </button>
            <button class="btn btn-danger btn-sm" @click="handleDelete(task)">删除</button>
          </div>
        </div>
        <div class="task-body">
          <div class="task-state" v-if="taskStates[task.id]">
            <span class="state-label">状态:</span>
            <span class="state-value" :class="taskStates[task.id].status">
              {{ stateLabel(taskStates[task.id].status) }}
            </span>
            <span v-if="taskStates[task.id].entryPrice" class="state-detail">
              入场: {{ taskStates[task.id].entryPrice?.toFixed(4) }}
            </span>
            <span v-if="taskStates[task.id].units?.length" class="state-detail">
              单位: {{ taskStates[task.id].units!.length }}
            </span>
            <span v-if="taskStates[task.id].gridLevels?.length" class="state-detail">
              层位: {{ taskStates[task.id].gridLevels!.length }}
            </span>
          </div>
          <div v-if="taskStats[task.id]" class="task-stats">
            <div class="stat-item">
              <span class="stat-label">已实现收益</span>
              <span class="stat-value" :class="profitClass(taskStats[task.id].totalRealizedPnl)">
                {{ formatSignedMoney(taskStats[task.id].totalRealizedPnl) }} USDT
              </span>
            </div>
            <div class="stat-item">
              <span class="stat-label">交易 / 胜率</span>
              <span class="stat-value">
                {{ taskStats[task.id].tradeCount }} / {{ (taskStats[task.id].winRate * 100).toFixed(0) }}%
              </span>
            </div>
            <div class="stat-item" v-if="taskStats[task.id].openProfit !== 0">
              <span class="stat-label">浮动盈亏</span>
              <span class="stat-value" :class="profitClass(taskStats[task.id].openProfit)">
                {{ formatSignedMoney(taskStats[task.id].openProfit) }} USDT
                <small>({{ formatPercent(taskStats[task.id].openProfitPct) }})</small>
              </span>
            </div>
            <div class="stat-item" v-if="taskStats[task.id].shadowTradeCount > 0">
              <span class="stat-label">影子收益</span>
              <span class="stat-value" :class="profitClass(taskStats[task.id].shadowPnl)">
                {{ formatSignedMoney(taskStats[task.id].shadowPnl) }} USDT
                <small>({{ taskStats[task.id].shadowTradeCount }}笔 / {{ (taskStats[task.id].shadowWinRate * 100).toFixed(0) }}%)</small>
              </span>
            </div>
          </div>
          <div v-if="task.lastResult" class="task-last-run">
            上次运行: {{ formatTime(task.lastRun) }}
            <span v-if="task.lastResult.actions.length > 0" class="task-actions-summary">
              → {{ task.lastResult.actions.join(', ') }}
            </span>
            <span v-else class="task-actions-summary">→ 无信号</span>
          </div>
          <div v-if="paramsTaskId === task.id" class="task-params">
            <StrategyParamsPanel
              :indicators="taskStates[task.id]?.indicators"
              :last-run="task.lastRun"
              :interval="task.interval"
            />
          </div>
          <div v-if="expandedTaskId === task.id" class="task-trades">
            <div class="task-trades-header">
              <span class="task-trades-title">交易记录 <b>{{ taskPlans(task).length }}</b> 笔</span>
              <div class="task-trades-tools">
                <label class="shadow-toggle">
                  <input v-model="showShadow" type="checkbox"> 显示影子单
                </label>
                <button class="btn btn-sm" :disabled="plansLoading" @click="loadPlans">
                  {{ plansLoading ? '加载中' : '刷新' }}
                </button>
              </div>
            </div>
            <div v-if="plansError" class="task-trades-error">{{ plansError }}</div>
            <div v-else-if="taskPlans(task).length === 0" class="task-trades-empty">该任务暂无交易记录</div>
            <div v-else class="trades-table-wrap">
              <table class="trades-table">
                <thead>
                  <tr>
                    <th>方向</th>
                    <th>入场 → 平仓</th>
                    <th>持仓时间</th>
                    <th>收益率</th>
                    <th>收益</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="plan in visiblePlans(task)" :key="plan.id">
                    <td>
                      <span class="side-badge" :class="plan.side">{{ plan.side === 'long' ? '做多' : '做空' }}</span>
                      <span v-if="plan.shadow" class="shadow-badge">影子</span>
                    </td>
                    <td class="mono">
                      {{ formatPrice(plan.actualEntryPrice ?? plan.entryPrice) }}
                      → {{ formatPrice(plan.exitRate) }}
                    </td>
                    <td>
                      <div>{{ formatDuration(plan.submittedAt ?? plan.createdAt, plan.closedAt) }}</div>
                      <small class="muted">{{ formatTime(plan.closedAt ?? plan.createdAt) }}</small>
                    </td>
                    <td class="mono" :class="profitClass(plan.currentProfit)">{{ formatPercent(plan.currentProfit) }}</td>
                    <td class="mono" :class="profitClass(planProfit(plan))">
                      {{ formatSignedMoney(planProfit(plan)) }} USDT
                    </td>
                    <td>{{ planStatusLabel(plan) }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="taskPlans(task).length > TRADE_LIMIT" class="task-trades-more">
                <button class="btn btn-sm" @click="showAllTrades = !showAllTrades">
                  {{ showAllTrades ? '收起' : `显示全部 ${taskPlans(task).length} 条` }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ManualCloseDialog
      v-if="closeTarget"
      :task="closeTarget"
      @close="closeTarget = null"
      @closed="loadTasks"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { PositionTask, PositionState, PositionStrategy, PositionInterval, MaCrossParams, TurtlePositionParams, BollingerParams, GridParams, PivotParams, PositionTaskStats, TradePlan } from '../types'
import { useNotifyAPI } from '../composables/useNotifyAPI'
import StrategyParamsPanel from '../components/StrategyParamsPanel.vue'
import ManualCloseDialog from '../components/ManualCloseDialog.vue'
import { closeReasonLabel, effectivePnl, formatDuration, formatPercent, formatPrice, formatSignedMoney, formatTime, profitClass, statusLabel } from '../utils/planFormat'

const { getPositionTasks, createPositionTask, deletePositionTask, togglePositionTask, triggerPositionTask, getPositionTaskState, getPositionTaskStats, getAllTradePlans, getWhitelist, addToWhitelist } = useNotifyAPI()

const TRADE_LIMIT = 50

const tasks = ref<PositionTask[]>([])
const taskStates = ref<Record<string, PositionState>>({})
const taskStats = ref<Record<string, PositionTaskStats>>({})
const showCreateForm = ref(false)
const form = ref(createDefaultForm())

const expandedTaskId = ref<string | null>(null)
const paramsTaskId = ref<string | null>(null)
const closeTarget = ref<PositionTask | null>(null)
const plans = ref<TradePlan[]>([])
const plansLoading = ref(false)
const plansError = ref('')
const showShadow = ref(true)
const showAllTrades = ref(false)
const whitelistPairs = ref<string[]>([])

let refreshInterval: ReturnType<typeof setInterval> | null = null

function createDefaultForm() {
  return {
    name: '',
    pair: '',
    strategy: 'bollinger' as PositionStrategy,
    interval: '15m' as PositionInterval,
    params: { period: 20, stdDev: 2 } as MaCrossParams | TurtlePositionParams | BollingerParams | GridParams | PivotParams,
    enabled: true,
  }
}

function strategyLabel(s: PositionStrategy): string {
  const labels: Record<PositionStrategy, string> = {
    ma_cross: 'MA交叉',
    turtle: '海龟',
    bollinger: '布林',
    grid: '网格',
    pivot: '枢轴'
  }
  return labels[s]
}

function stateLabel(s: string): string {
  const labels: Record<string, string> = { flat: '空仓', long: '做多', short: '做空' }
  return labels[s] ?? s
}

function taskPlans(task: PositionTask): TradePlan[] {
  return plans.value.filter(p => p.sourceKey?.startsWith(`${task.id}:`) && (showShadow.value || !p.shadow))
}

function visiblePlans(task: PositionTask): TradePlan[] {
  const rows = [...taskPlans(task)].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return showAllTrades.value ? rows : rows.slice(0, TRADE_LIMIT)
}

function planProfit(plan: TradePlan): number | undefined {
  return plan.status === 'closed' ? effectivePnl(plan) : plan.currentProfitAbs
}

function planStatusLabel(plan: TradePlan): string {
  if (plan.status === 'closed' && plan.closeReason) return `${statusLabel(plan.status)}·${closeReasonLabel(plan.closeReason)}`
  return statusLabel(plan.status)
}

async function loadPlans() {
  plansLoading.value = true
  plansError.value = ''
  try {
    plans.value = await getAllTradePlans()
  } catch (err) {
    plansError.value = err instanceof Error ? err.message : '交易记录加载失败'
  } finally {
    plansLoading.value = false
  }
}

async function toggleExpand(task: PositionTask) {
  if (expandedTaskId.value === task.id) {
    expandedTaskId.value = null
    return
  }
  expandedTaskId.value = task.id
  showAllTrades.value = false
  await loadPlans()
}

function toggleParams(task: PositionTask) {
  paramsTaskId.value = paramsTaskId.value === task.id ? null : task.id
}

function canClose(task: PositionTask): boolean {
  const state = taskStates.value[task.id]
  if (!state || state.status === 'flat') return false

  // 与 position-close.ts 的 collectCloseLevels 逻辑保持一致
  if (task.strategy === 'grid') {
    return (state.gridLevels?.length ?? 0) > 0
  }

  if (task.strategy === 'turtle') {
    return (state.units?.length ?? 0) > 0
  }

  return !!state.planId
}

function openCloseDialog(task: PositionTask) {
  closeTarget.value = task
}

async function loadTasks() {
  try {
    const [tasksData, statsData, whitelistData] = await Promise.all([
      getPositionTasks(),
      getPositionTaskStats().catch(() => ({} as Record<string, PositionTaskStats>)),
      getWhitelist().catch(() => ({ whitelist: [] }))
    ])
    tasks.value = tasksData
    taskStats.value = statsData
    whitelistPairs.value = whitelistData.whitelist
    for (const task of tasks.value) {
      try {
        taskStates.value[task.id] = await getPositionTaskState(task.id)
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error('Failed to load position tasks:', err)
  }
}

function isDuplicateTask(): PositionTask | null {
  const f = form.value
  return tasks.value.find(t => {
    if (t.pair !== f.pair || t.strategy !== f.strategy || t.interval !== f.interval) return false
    const tp = t.params as Record<string, unknown>
    const fp = f.params as Record<string, unknown>
    const keys = new Set([...Object.keys(tp), ...Object.keys(fp)])
    for (const k of keys) {
      if (tp[k] !== fp[k]) return false
    }
    return true
  }) ?? null
}

async function handleCreate() {
  const dup = isDuplicateTask()
  if (dup) {
    const msg = `已存在相同参数的任务「${dup.name}」(${dup.pair} / ${strategyLabel(dup.strategy)} / ${dup.interval})，是否仍要创建？`
    if (!confirm(msg)) return
  }
  try {
    await createPositionTask({
      name: form.value.name,
      pair: form.value.pair,
      strategy: form.value.strategy,
      interval: form.value.interval,
      params: form.value.params,
      enabled: form.value.enabled,
    })
    showCreateForm.value = false
    form.value = createDefaultForm()
    await loadTasks()
  } catch (err) {
    console.error('Failed to create position task:', err)
  }
}

async function handleToggle(task: PositionTask) {
  try {
    await togglePositionTask(task.id)
    await loadTasks()
  } catch (err) {
    console.error('Failed to toggle:', err)
  }
}

function isPairInWhitelist(pair: string): boolean {
  // 将 OKX 格式转为 Freqtrade 格式后比较
  const ftPair = pair.includes(':') ? pair.toUpperCase() : pair.replace(/-USDT-SWAP$/i, '/USDT:USDT').replace(/-USDT$/i, '/USDT:USDT').toUpperCase()
  return whitelistPairs.value.some(w => w.toUpperCase() === ftPair)
}

async function handleTrigger(task: PositionTask) {
  try {
    // 预检白名单
    const inWhitelist = isPairInWhitelist(task.pair)
    if (!inWhitelist) {
      const pairDisplay = task.pair.replace(/-USDT-SWAP$/i, '').replace(/-USDT$/i, '')
      if (!confirm(`交易对 ${pairDisplay} 不在白名单中，是否将其加入白名单并触发建仓？`)) {
        return
      }
      // 用户确认：先加入白名单，再触发
      await addToWhitelist(task.pair)
      await triggerPositionTask(task.id, true)
    } else {
      await triggerPositionTask(task.id, true)
    }
    setTimeout(loadTasks, 2000)
  } catch (err) {
    console.error('Failed to trigger:', err)
  }
}

async function handleDelete(task: PositionTask) {
  if (!confirm(`确定删除任务 "${task.name}"？`)) return
  try {
    await deletePositionTask(task.id)
    await loadTasks()
  } catch (err) {
    console.error('Failed to delete:', err)
  }
}

onMounted(() => {
  loadTasks()
  refreshInterval = setInterval(loadTasks, 30000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})

const emit = defineEmits<{ selectPair: [pair: string] }>()
defineExpose({ loadTasks, form, showCreateForm })
</script>

<style scoped>
.position-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent-gold);
}

.create-form {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.form-group input,
.form-group select {
  padding: 8px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.85rem;
}

.form-actions {
  display: flex;
  gap: 8px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.task-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 16px;
}

.task-card.disabled {
  opacity: 0.6;
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.task-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-name {
  font-weight: 700;
  color: var(--text-primary);
}

.task-pair {
  font-family: 'Space Mono', monospace;
  font-size: 0.8rem;
  color: var(--accent-blue);
  cursor: pointer;
}

.task-pair:hover {
  text-decoration: underline;
}

.whitelist-badge {
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.whitelist-badge.not-in-list {
  background: rgba(255, 152, 0, 0.15);
  color: #ff9800;
  border: 1px solid rgba(255, 152, 0, 0.3);
}

.task-strategy {
  font-size: 0.75rem;
  padding: 2px 8px;
  background: rgba(59, 130, 246, 0.15);
  border-radius: 4px;
  color: var(--accent-blue);
}

.task-interval {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.task-actions {
  display: flex;
  gap: 6px;
}

.task-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-state {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}

.state-label {
  color: var(--text-secondary);
}

.state-value {
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
}

.state-value.flat {
  background: rgba(148, 163, 184, 0.15);
  color: var(--text-secondary);
}

.state-value.long {
  background: rgba(16, 185, 129, 0.15);
  color: var(--accent-green);
}

.state-value.short {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red);
}

.state-detail {
  font-family: 'Space Mono', monospace;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.task-last-run {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.task-actions-summary {
  color: var(--accent-gold);
}

.task-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 0 4px;
  border-top: 1px dashed rgba(148, 163, 184, 0.12);
  margin-top: 6px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 80px;
}

.stat-label {
  font-size: 0.68rem;
  color: var(--text-secondary);
}

.stat-value {
  font: 700 0.8rem 'Space Mono', monospace;
  color: var(--text-primary);
}

.stat-value small {
  font-weight: 400;
  font-size: 0.68rem;
  color: var(--text-secondary);
  margin-left: 4px;
}

.stat-value.profit {
  color: var(--accent-green);
}

.stat-value.loss {
  color: var(--accent-red);
}

.stat-value.neutral {
  color: var(--text-secondary);
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

.btn-primary {
  background: var(--accent-blue);
  color: #fff;
}

.btn-secondary {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-success {
  background: var(--accent-green);
  color: #fff;
}

.btn-warning {
  background: var(--accent-gold);
  color: #fff;
}

.btn-danger {
  background: var(--accent-red);
  color: #fff;
}

.btn:hover {
  opacity: 0.85;
}

.trade-count {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.25);
  font: 700 0.7rem 'Space Mono', monospace;
}

.task-params {
  margin-top: 10px;
}

.task-trades {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.task-trades-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.task-trades-title {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.task-trades-title b {
  color: var(--text-primary);
}

.task-trades-tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.shadow-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-trades-empty,
.task-trades-error {
  padding: 16px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.task-trades-error {
  color: var(--accent-red);
}

.trades-table-wrap {
  overflow-x: auto;
}

.trades-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.trades-table th {
  text-align: left;
  padding: 4px 8px;
  color: var(--text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.trades-table td {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  color: var(--text-primary);
}

.trades-table .mono {
  font-family: 'Space Mono', monospace;
  white-space: nowrap;
}

.trades-table .profit {
  color: var(--accent-green);
}

.trades-table .loss {
  color: var(--accent-red);
}

.trades-table .neutral {
  color: var(--text-secondary);
}

.trades-table small {
  color: var(--text-secondary);
  font-size: 0.7rem;
}

.side-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}

.side-badge.long {
  background: rgba(16, 185, 129, 0.15);
  color: var(--accent-green);
}

.side-badge.short {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red);
}

.shadow-badge {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.2);
  color: var(--text-secondary);
  font-size: 0.68rem;
}

.task-trades-more {
  margin-top: 8px;
  text-align: center;
}
</style>
