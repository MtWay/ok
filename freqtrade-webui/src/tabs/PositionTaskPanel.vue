<template>
  <div class="position-panel">
    <div class="panel-header">
      <h3>策略建仓任务</h3>
      <div class="panel-header-actions">
        <button
          v-if="someSelected"
          class="btn btn-danger btn-sm"
          :disabled="batchDeleting"
          @click="handleBatchDelete"
        >{{ batchDeleting ? '删除中…' : `批量删除 (${selectedTaskIds.size})` }}</button>
        <button class="btn btn-primary btn-sm" @click="dialogTask = undefined">
          + 新建任务
        </button>
      </div>
    </div>

    <!-- 创建/编辑弹框 -->
    <PositionTaskDialog
      v-if="dialogTask !== null"
      :task="dialogTask"
      :initial-form="dialogInitialForm"
      @close="dialogTask = null; dialogInitialForm = null"
      @saved="loadTasks"
    />

    <!-- 海龟自动筛选 -->
    <div class="turtle-auto-card">
      <div class="turtle-auto-header">
        <label class="turtle-auto-toggle">
          <input type="checkbox" v-model="turtleAutoEnabled" @change="handleTurtleAutoToggle" />
          <b>海龟自动筛选建仓</b>
        </label>
        <span class="turtle-auto-desc">
          定期重算海龟收益排名，前 {{ turtleAutoForm.topN }} 名自动建任务；掉出名单且无持仓的任务自动停用
        </span>
        <button class="btn btn-secondary btn-sm" :disabled="!turtleAutoEnabled || turtleAutoRunning" @click="handleTurtleAutoRefresh">
          {{ turtleAutoRunning ? '刷新中…' : '手动刷新' }}
        </button>
      </div>
      <div v-if="turtleAutoEnabled" class="turtle-auto-body">
        <div class="turtle-auto-form">
          <label>入选数 <input type="number" v-model.number="turtleAutoForm.topN" min="1" max="30" @change="handleTurtleAutoSave" /></label>
          <label>最少交易 <input type="number" v-model.number="turtleAutoForm.minTrades" min="1" max="20" @change="handleTurtleAutoSave" /></label>
          <label>回看K线 <input type="number" v-model.number="turtleAutoForm.lookbackBars" min="100" max="20000" @change="handleTurtleAutoSave" /></label>
          <label>刷新(小时) <input type="number" v-model.number="turtleAutoForm.refreshHours" min="6" max="168" @change="handleTurtleAutoSave" /></label>
          <label>检测周期
            <select v-model="turtleAutoForm.signalInterval" @change="handleTurtleAutoSave">
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1H">1H</option>
              <option value="4H">4H</option>
            </select>
          </label>
        </div>
        <div v-if="turtleWhitelist" class="turtle-auto-status">
          上次计算: {{ formatTime(turtleWhitelist.computedAt) }}（{{ turtleWhitelist.entries.length }} 个参评）
          <div class="turtle-auto-pairs">
            <span
              v-for="e in turtleWhitelist.entries.slice(0, 15)" :key="e.pair"
              class="wl-chip" :class="{ selected: turtleWhitelist.selected.includes(e.pair), negative: e.returnPct <= 0 }"
              :title="`回看窗口收益 ${e.returnPct.toFixed(1)}% / ${e.trades} 笔`"
            >{{ e.pair.replace('-USDT-SWAP', '') }}</span>
          </div>
        </div>
        <div v-else class="turtle-auto-status">尚未计算白名单，点击「手动刷新」开始</div>
      </div>
    </div>

    <!-- 单边连续自动筛选 -->
    <div class="turtle-auto-card">
      <div class="turtle-auto-header">
        <label class="turtle-auto-toggle">
          <input type="checkbox" v-model="ccAutoEnabled" @change="handleCcAutoToggle" />
          <b>单边连续自动筛选建仓</b>
        </label>
        <span class="turtle-auto-desc">
          定期重算单边连续收益排名，前 {{ ccAutoForm.topN }} 名自动建任务；掉出名单且无持仓的任务自动停用
        </span>
        <button class="btn btn-secondary btn-sm" :disabled="!ccAutoEnabled || ccAutoRunning" @click="handleCcAutoRefresh">
          {{ ccAutoRunning ? '刷新中…' : '手动刷新' }}
        </button>
      </div>
      <div v-if="ccAutoEnabled" class="turtle-auto-body">
        <div class="turtle-auto-form">
          <label>入选数 <input type="number" v-model.number="ccAutoForm.topN" min="1" max="30" @change="handleCcAutoSave" /></label>
          <label>最少交易 <input type="number" v-model.number="ccAutoForm.minTrades" min="1" max="20" @change="handleCcAutoSave" /></label>
          <label>回看K线 <input type="number" v-model.number="ccAutoForm.lookbackBars" min="100" max="20000" @change="handleCcAutoSave" /></label>
          <label>刷新(小时) <input type="number" v-model.number="ccAutoForm.refreshHours" min="6" max="168" @change="handleCcAutoSave" /></label>
          <label>检测周期
            <select v-model="ccAutoForm.signalInterval" @change="handleCcAutoSave">
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1H">1H</option>
              <option value="4H">4H</option>
            </select>
          </label>
        </div>
        <div v-if="ccWhitelist" class="turtle-auto-status">
          上次计算: {{ formatTime(ccWhitelist.computedAt) }}（{{ ccWhitelist.entries.length }} 个参评）
          <div class="turtle-auto-pairs">
            <span
              v-for="e in ccWhitelist.entries.slice(0, 15)" :key="e.pair"
              class="wl-chip" :class="{ selected: ccWhitelist.selected.includes(e.pair), negative: e.returnPct <= 0 }"
              :title="`回看窗口收益 ${e.returnPct.toFixed(1)}% / ${e.trades} 笔`"
            >{{ e.pair.replace('-USDT-SWAP', '') }}</span>
          </div>
        </div>
        <div v-else class="turtle-auto-status">尚未计算白名单，点击「手动刷新」开始</div>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="task-list">
      <div v-if="tasks.length > 1" class="batch-select-bar">
        <label class="batch-select-all">
          <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
          全选
        </label>
      </div>
      <div v-if="tasks.length === 0" class="empty-state">
        暂无建仓任务，从回测结果页点击"建仓"或点击上方"新建任务"创建
      </div>
      <div v-for="task in tasks" :key="task.id" class="task-card" :class="{ disabled: !task.enabled, selected: selectedTaskIds.has(task.id) }">
        <div class="task-header">
          <div class="task-title">
            <input type="checkbox" class="task-checkbox" :checked="selectedTaskIds.has(task.id)" @change="toggleSelectTask(task.id)" />
            <span class="task-name">{{ task.name }}</span>
            <span class="task-pair" @click="emit('selectPair', task.pair)">{{ task.pair }}</span>
            <span v-if="!isPairInWhitelist(task.pair)" class="whitelist-badge not-in-list" title="该交易对不在白名单中">⚠ 未在白名单</span>
            <span class="task-strategy">{{ strategyLabel(task.strategy) }}</span>
            <span class="task-interval">{{ task.interval }}</span>
            <span v-if="task.autoTurtleManaged" class="auto-badge" title="由海龟自动筛选创建和维护">自动</span>
            <span v-if="task.autoCcManaged" class="auto-badge" title="由单边连续自动筛选创建和维护">自动</span>
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
            <button class="btn btn-secondary btn-sm" @click="dialogTask = task">编辑</button>
            <button class="btn btn-secondary btn-sm" @click="handleShowHistory(task.id)">
              {{ historyTaskId === task.id ? '收起历史' : '扫描历史' }}
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
          <div v-if="historyTaskId === task.id" class="task-history">
            <div class="task-history-header">
              <span class="task-history-title">扫描历史</span>
            </div>
            <div v-if="loadingHistory" class="task-history-empty">加载中…</div>
            <div v-else-if="scanHistory.length === 0" class="task-history-empty">暂无扫描记录</div>
            <div v-else class="task-history-list">
              <div v-for="entry in scanHistory" :key="entry.id" class="history-item" :class="{ failed: entry.error }">
                <span class="history-time">{{ formatTime(entry.startedAt) }}</span>
                <span class="history-trigger">{{ entry.trigger === 'manual' ? '手动' : '定时' }}</span>
                <span class="history-result">
                  <template v-if="entry.error">失败: {{ entry.error }}</template>
                  <template v-else-if="entry.resultCount > 0">命中 {{ entry.resultCount }} 个: {{ entry.pairs.join(', ') }}</template>
                  <template v-else>无信号</template>
                </span>
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import type { PositionTask, PositionState, PositionStrategy, PositionTaskStats, TradePlan, ScanHistoryEntry, TurtleWhitelist, PositionInterval } from '../types'
import { useNotifyAPI } from '../composables/useNotifyAPI'
import StrategyParamsPanel from '../components/StrategyParamsPanel.vue'
import ManualCloseDialog from '../components/ManualCloseDialog.vue'
import PositionTaskDialog from '../components/PositionTaskDialog.vue'
import { closeReasonLabel, effectivePnl, formatDuration, formatPercent, formatPrice, formatSignedMoney, formatTime, profitClass, statusLabel } from '../utils/planFormat'

import { API_BASE, fetchWithFallback } from '../config/api'

const { getPositionTasks, deletePositionTask, deletePositionTasks, togglePositionTask, triggerPositionTask, getPositionTaskState, getPositionTaskStats, getAllTradePlans, getWhitelist, addToWhitelist, getTurtleAuto, updateTurtleAuto, refreshTurtleAuto, getCcAuto, updateCcAuto, refreshCcAuto } = useNotifyAPI()

// ---- 海龟自动筛选 ----
const turtleAutoEnabled = ref(false)
const turtleAutoRunning = ref(false)
const turtleWhitelist = ref<TurtleWhitelist | null>(null)
const turtleAutoForm = ref({ topN: 10, minTrades: 3, lookbackBars: 360, refreshHours: 24, signalInterval: '1H' as PositionInterval })

async function loadTurtleAuto() {
  try {
    const status = await getTurtleAuto()
    turtleAutoEnabled.value = status.config.enabled
    turtleAutoRunning.value = status.running
    turtleWhitelist.value = status.whitelist
    turtleAutoForm.value = {
      topN: status.config.whitelist.topN ?? 10,
      minTrades: status.config.whitelist.minTrades ?? 3,
      lookbackBars: status.config.whitelist.lookbackBars ?? 360,
      refreshHours: status.config.refreshHours ?? 24,
      signalInterval: status.config.signalInterval ?? '1H',
    }
    // 刷新中则轮询直到完成
    if (status.running) setTimeout(loadTurtleAuto, 10_000)
  } catch (err) {
    console.error('加载 turtle-auto 失败:', err)
  }
}

async function handleTurtleAutoToggle() {
  try {
    await updateTurtleAuto({ enabled: turtleAutoEnabled.value })
    await loadTurtleAuto()
    await loadTasks() // 刚开启会触发同步，任务列表稍后变化
  } catch (err) {
    console.error('更新 turtle-auto 失败:', err)
    turtleAutoEnabled.value = !turtleAutoEnabled.value
  }
}

async function handleTurtleAutoSave() {
  try {
    await updateTurtleAuto({
      refreshHours: turtleAutoForm.value.refreshHours,
      signalInterval: turtleAutoForm.value.signalInterval,
      whitelist: {
        topN: turtleAutoForm.value.topN,
        minTrades: turtleAutoForm.value.minTrades,
        lookbackBars: turtleAutoForm.value.lookbackBars,
      },
    })
  } catch (err) {
    console.error('保存 turtle-auto 配置失败:', err)
  }
}

async function handleTurtleAutoRefresh() {
  try {
    turtleAutoRunning.value = true
    await refreshTurtleAuto()
    setTimeout(loadTurtleAuto, 5_000)
  } catch (err) {
    console.error('手动刷新失败:', err)
    turtleAutoRunning.value = false
  }
}

// ---- 单边连续自动筛选 ----
const ccAutoEnabled = ref(false)
const ccAutoRunning = ref(false)
const ccWhitelist = ref<TurtleWhitelist | null>(null)
const ccAutoForm = ref({ topN: 5, minTrades: 3, lookbackBars: 1440, refreshHours: 24, signalInterval: '1H' as PositionInterval })

async function loadCcAuto() {
  try {
    const status = await getCcAuto()
    ccAutoEnabled.value = status.config.enabled
    ccAutoRunning.value = status.running
    ccWhitelist.value = status.whitelist
    ccAutoForm.value = {
      topN: status.config.whitelist.topN ?? 5,
      minTrades: status.config.whitelist.minTrades ?? 3,
      lookbackBars: status.config.whitelist.lookbackBars ?? 1440,
      refreshHours: status.config.refreshHours ?? 24,
      signalInterval: status.config.signalInterval ?? '1H',
    }
    // 刷新中则轮询直到完成
    if (status.running) setTimeout(loadCcAuto, 10_000)
  } catch (err) {
    console.error('加载 cc-auto 失败:', err)
  }
}

async function handleCcAutoToggle() {
  try {
    await updateCcAuto({ enabled: ccAutoEnabled.value })
    await loadCcAuto()
    await loadTasks() // 刚开启会触发同步，任务列表稍后变化
  } catch (err) {
    console.error('更新 cc-auto 失败:', err)
    ccAutoEnabled.value = !ccAutoEnabled.value
  }
}

async function handleCcAutoSave() {
  try {
    await updateCcAuto({
      refreshHours: ccAutoForm.value.refreshHours,
      signalInterval: ccAutoForm.value.signalInterval,
      whitelist: {
        topN: ccAutoForm.value.topN,
        minTrades: ccAutoForm.value.minTrades,
        lookbackBars: ccAutoForm.value.lookbackBars,
      },
    })
  } catch (err) {
    console.error('保存 cc-auto 配置失败:', err)
  }
}

async function handleCcAutoRefresh() {
  try {
    ccAutoRunning.value = true
    await refreshCcAuto()
    setTimeout(loadCcAuto, 5_000)
  } catch (err) {
    console.error('手动刷新失败:', err)
    ccAutoRunning.value = false
  }
}

const TRADE_LIMIT = 50

const tasks = ref<PositionTask[]>([])
const taskStates = ref<Record<string, PositionState>>({})
const taskStats = ref<Record<string, PositionTaskStats>>({})
const dialogTask = ref<PositionTask | null | undefined>(null)
const dialogInitialForm = ref<Record<string, unknown> | null>(null)
const historyTaskId = ref<string | null>(null)
const scanHistory = ref<ScanHistoryEntry[]>([])
const loadingHistory = ref(false)

const expandedTaskId = ref<string | null>(null)
const paramsTaskId = ref<string | null>(null)
const closeTarget = ref<PositionTask | null>(null)
const plans = ref<TradePlan[]>([])
const plansLoading = ref(false)
const plansError = ref('')
const showShadow = ref(true)
const showAllTrades = ref(false)
const whitelistPairs = ref<string[]>([])
const selectedTaskIds = ref<Set<string>>(new Set())
const batchDeleting = ref(false)

const allSelected = computed(() => tasks.value.length > 0 && selectedTaskIds.value.size === tasks.value.length)
const someSelected = computed(() => selectedTaskIds.value.size > 0)

function toggleSelectAll() {
  if (allSelected.value) {
    selectedTaskIds.value = new Set()
  } else {
    selectedTaskIds.value = new Set(tasks.value.map(t => t.id))
  }
}

function toggleSelectTask(id: string) {
  const next = new Set(selectedTaskIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedTaskIds.value = next
}

async function handleBatchDelete() {
  const count = selectedTaskIds.value.size
  if (count === 0) return
  if (!confirm(`确定删除选中的 ${count} 个任务？此操作不可撤销。`)) return
  try {
    batchDeleting.value = true
    await deletePositionTasks([...selectedTaskIds.value])
    selectedTaskIds.value = new Set()
    await loadTasks()
  } catch (err) {
    console.error('Failed to batch delete:', err)
  } finally {
    batchDeleting.value = false
  }
}

let refreshInterval: ReturnType<typeof setInterval> | null = null

function strategyLabel(s: PositionStrategy): string {
  const labels: Record<PositionStrategy, string> = {
    ma_cross: 'MA交叉',
    turtle: '海龟',
    bollinger: '布林',
    grid: '网格',
    pivot: '枢轴',
    consecutive_candle: '连续单边'
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
    const validIds = new Set(tasksData.map(t => t.id))
    selectedTaskIds.value = new Set([...selectedTaskIds.value].filter(id => validIds.has(id)))
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

async function handleShowHistory(taskId: string) {
  if (historyTaskId.value === taskId) {
    historyTaskId.value = null
    return
  }
  historyTaskId.value = taskId
  loadingHistory.value = true
  try {
    const res = await fetchWithFallback(`${API_BASE}/position-tasks/${taskId}/history`)
    scanHistory.value = res.ok ? await res.json() : []
  } catch {
    scanHistory.value = []
  } finally {
    loadingHistory.value = false
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
  loadTurtleAuto()
  loadCcAuto()
  refreshInterval = setInterval(loadTasks, 30000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})

const emit = defineEmits<{ selectPair: [pair: string] }>()
async function openWithParams(data: Record<string, unknown>) {
  dialogInitialForm.value = data
  dialogTask.value = null
  await nextTick()
  dialogTask.value = undefined
}

defineExpose({ loadTasks, dialogTask, openWithParams })
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

.panel-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.batch-select-bar {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.batch-select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-checkbox {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.task-card.selected {
  border-color: var(--accent-blue);
  background: rgba(59, 130, 246, 0.04);
}

.panel-header h3 {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent-gold);
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

.task-history {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.task-history-header {
  margin-bottom: 8px;
}

.task-history-title {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.task-history-empty {
  padding: 12px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.task-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 0.78rem;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.05);
}

.history-item.failed {
  background: rgba(239, 68, 68, 0.08);
}

.history-time {
  color: var(--text-secondary);
  font-family: 'Space Mono', monospace;
  font-size: 0.72rem;
  white-space: nowrap;
}

.history-trigger {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.12);
  color: var(--accent-blue);
}

.history-result {
  color: var(--text-primary);
}

.history-item.failed .history-result {
  color: var(--accent-red);
}
</style>

<style scoped>
.turtle-auto-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 18px; margin-bottom: 16px; }
.turtle-auto-header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.turtle-auto-toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.turtle-auto-desc { color: var(--text-secondary); font-size: 0.8rem; flex: 1; min-width: 200px; }
.turtle-auto-body { margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px; }
.turtle-auto-form { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
.turtle-auto-form label { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); }
.turtle-auto-form input { width: 60px; padding: 3px 6px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-secondary); color: var(--text-primary); }
.turtle-auto-status { font-size: 0.8rem; color: var(--text-secondary); }
.turtle-auto-pairs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.wl-chip { padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border-color); cursor: help; }
.wl-chip.selected { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); border-color: var(--accent-green); font-weight: bold; }
.wl-chip.negative { opacity: 0.6; }
.auto-badge { padding: 1px 6px; border-radius: 8px; font-size: 0.7rem; background: rgba(16, 185, 129, 0.2); color: var(--accent-green); border: 1px solid var(--accent-green); }
</style>
