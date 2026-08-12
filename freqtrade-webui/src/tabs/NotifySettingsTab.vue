<template>
  <div class="tab-content">
    <div class="chart-card">
      <div class="chart-header">
        <div class="chart-title">🔔 通知任务管理</div>
        <button class="btn btn-primary" @click="showCreateForm ? handleCancelForm() : (showCreateForm = true)">
          {{ showCreateForm ? '取消' : '创建新任务' }}
        </button>
      </div>

      <div v-if="tasks.length" class="history-toolbar">
        <select v-model="historyTaskId"><option :value="null">选择任务查看扫描历史</option><option v-for="task in tasks" :key="task.id" :value="task.id">{{ task.name }}</option></select>
        <button class="btn btn-small" :disabled="!historyTaskId" @click="historyTaskId && handleShowHistory(historyTaskId)">查看历史</button>
      </div>
      <div v-if="historyTaskId" class="history-panel">
        <div class="history-header"><strong>扫描历史</strong><button class="btn btn-small" @click="historyTaskId = null">关闭</button></div>
        <div v-if="loadingHistory" class="history-empty">加载中…</div>
        <div v-else-if="scanHistory.length === 0" class="history-empty">暂无历史扫描记录</div>
        <div v-else class="history-list"><div v-for="entry in scanHistory" :key="entry.id" class="history-item" :class="{ failed: entry.error }"><span>{{ formatTime(entry.startedAt) }}</span><span>{{ entry.trigger === 'manual' ? '手动' : '定时' }}</span><span>{{ entry.error ? `失败：${entry.error}` : `命中 ${entry.resultCount} 个` }}</span><span class="history-pairs">{{ entry.pairs.join(', ') || '无命中' }}</span></div></div>
      </div>

      <!-- Create/Edit Form -->
      <div v-if="showCreateForm" class="task-form">
        <h4 class="form-mode-title">{{ editingTaskId ? '编辑任务' : '新建任务' }}</h4>
        <div class="form-row">
          <label>任务名称</label>
          <input v-model="form.name" type="text" placeholder="例如: 高分品种监控" />
        </div>
        <div class="form-row">
          <label>通知邮箱</label>
          <input v-model="form.email" type="email" placeholder="your-email@example.com" />
          <label><input v-model="form.emailEnabled" type="checkbox" /> 推送扫描结果到邮箱</label>
        </div>
        <div class="form-row">
          <label>扫描间隔</label>
          <select v-model="form.interval">
            <option value="15m">每15分钟</option>
            <option value="1h">每小时</option>
            <option value="4h">每4小时</option>
            <option value="12h">每12小时</option>
            <option value="24h">每天</option>
          </select>
        </div>
        <div class="form-section">
          <h4>筛选规则</h4>
          <div class="form-row">
            <label>启用规则至少命中</label>
            <input v-model.number="form.filters.minRuleHits" type="number" min="0" max="9" />
            <small>启用规则中至少命中几条才算通过。设为 9 则要求全部命中。</small>
          </div>
          <div class="rules-config">
            <div v-for="rule in RULE_OPTIONS" :key="rule.key" class="rule-config-row">
              <label class="rule-enable">
                <input v-model="form.filters.rules![rule.key].enabled" type="checkbox" />
                {{ rule.label }}
              </label>
              <label v-if="rule.hasParam" class="rule-param">
                {{ rule.paramLabel }}
                <input v-model.number="(form.filters.rules![rule.key] as any)[rule.paramKey]" :step="rule.paramStep" :min="rule.paramMin" type="number" />
              </label>
            </div>
          </div>
          <div class="form-row">
            <label><input v-model="form.filters.multiTimeframe.enabled" type="checkbox" /> 启用多周期：顺大势逆小势</label>
          </div>
          <div v-if="form.filters.multiTimeframe.enabled" class="checkbox-group">
            <label>大周期<select v-model="form.filters.multiTimeframe.higherTimeframe"><option>4H</option><option>1D</option></select></label>
            <label>小周期<select v-model="form.filters.multiTimeframe.lowerTimeframe"><option>15m</option><option>1H</option></select></label>
          </div>
        </div>
        <div class="form-section">
          <h4>扫描范围</h4>
          <div class="form-row">
            <label>
              <input v-model="useAllPairs" type="checkbox" />
              全部热门品种
            </label>
          </div>
          <div class="form-row auto-sim-row">
            <label><input v-model="form.autoApproveSimulation" type="checkbox" /> 自动批准模拟交易计划</label>
            <small>仅在服务器 TRADING_DRY_RUN=true 时生效，不会下真实订单</small>
          </div>
          <div v-if="!useAllPairs" class="form-row">
            <label>选择交易对（逗号分隔）</label>
            <input v-model="pairsInput" type="text" placeholder="BTC-USDT,ETH-USDT,SOL-USDT" />
          </div>
          <div class="form-row">
            <label>时间周期</label>
            <div class="checkbox-group">
              <label><input v-model="form.timeframes" type="checkbox" value="5m" /> 5m</label>
              <label><input v-model="form.timeframes" type="checkbox" value="15m" /> 15m</label>
              <label><input v-model="form.timeframes" type="checkbox" value="1H" /> 1H</label>
              <label><input v-model="form.timeframes" type="checkbox" value="4H" /> 4H</label>
              <label><input v-model="form.timeframes" type="checkbox" value="1D" /> 1D</label>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click="handleSubmitTask">{{ editingTaskId ? '保存修改' : '创建任务' }}</button>
          <button class="btn btn-secondary" @click="handleCancelForm">取消</button>
        </div>
      </div>

      <!-- Tasks List -->
      <div v-if="tasks.length > 0" class="tasks-list">
        <div v-for="task in tasks" :key="task.id" class="task-card" :class="{ disabled: !task.enabled }">
          <div class="task-header">
            <div class="task-title">
              <span class="task-name">{{ task.name }}</span>
              <span class="task-status" :class="task.enabled ? 'enabled' : 'disabled'">
                {{ task.enabled ? '运行中' : '已停用' }}
              </span>
            </div>
            <div class="task-actions">
              <button class="btn btn-small btn-trigger" @click="handleTrigger(task.id)" title="立即执行">
                ▶ 触发
              </button>
              <button class="btn btn-small btn-debug" :class="{ active: debugTaskId === task.id }" @click="toggleDebug(task.id)" title="查看每条规则命中情况">
                {{ debugTaskId === task.id ? '收起调试' : '调试扫描' }}
              </button>
              <button class="btn btn-small" @click="handleEditTask(task)" title="编辑">
                编辑
              </button>
              <button class="btn btn-small" @click="handleToggle(task.id)" title="启用/停用">
                {{ task.enabled ? '停用' : '启用' }}
              </button>
              <button class="btn btn-small btn-delete" @click="handleDelete(task.id)" title="删除">
                删除
              </button>
            </div>
          </div>
          <div class="task-info">
            <div class="info-row">
              <span class="label">邮箱:</span>
              <span>{{ task.email }}</span>
            </div>
            <div class="info-row">
              <span class="label">间隔:</span>
              <span>{{ intervalLabel(task.interval) }}</span>
            </div>
            <div class="info-row">
              <span class="label">规则:</span>
              <span>{{ taskRuleSummary(task) }}</span>
            </div>
            <div class="info-row">
              <span class="label">品种:</span>
              <span>{{ task.pairs.includes('*') ? '全部热门' : task.pairs.join(', ') }}</span>
            </div>
            <div class="info-row">
              <span class="label">周期:</span>
              <span>{{ task.timeframes.join(', ') }}</span>
            </div>
            <div v-if="task.lastRun" class="info-row">
              <span class="label">上次运行:</span>
              <span>{{ formatTime(task.lastRun) }} - 发现 {{ task.lastResult?.count || 0 }} 个品种</span>
            </div>
          </div>
          <div class="task-analysis">
            <button class="btn btn-small" @click="toggleAnalysis(task.id)">{{ analysisTaskId === task.id ? '收起收益分析' : '查看方案收益' }}</button>
            <div v-if="analysisTaskId === task.id" class="analysis-panel">
              <div class="analysis-columns">
                <div class="analysis-mode original"><h5>原方向</h5><span>收益 <b :class="taskAnalysis(task).pnl >= 0 ? 'profit-positive' : 'profit-negative'">{{ taskAnalysis(task).pnl >= 0 ? '+' : '' }}{{ taskAnalysis(task).pnl.toFixed(2) }} USDT</b></span><span>胜率 <b>{{ taskAnalysis(task).winRate.toFixed(1) }}%</b></span></div>
                <div class="analysis-mode reverse"><h5>反向方向</h5><span>收益 <b :class="taskAnalysis(task).reversePnl >= 0 ? 'profit-positive' : 'profit-negative'">{{ taskAnalysis(task).reversePnl >= 0 ? '+' : '' }}{{ taskAnalysis(task).reversePnl.toFixed(2) }} USDT</b></span><span>胜率 <b>{{ taskAnalysis(task).reverseWinRate.toFixed(1) }}%</b></span></div>
              </div>
              <div class="analysis-summary"><span>已结算 <b>{{ taskAnalysis(task).count }}</b></span><span v-if="taskAnalysis(task).unsettled">未结算 <b>{{ taskAnalysis(task).unsettled }}</b></span><span>原方向最大回撤 <b class="profit-negative">{{ taskAnalysis(task).drawdown.toFixed(2) }} USDT</b></span></div>
            </div>
          </div>
          <div v-if="debugTaskId === task.id" class="task-debug">
            <div class="debug-header">
              <strong>调试扫描结果</strong>
              <div class="debug-actions">
                <label><input v-model="debugFilter" type="radio" value="all" /> 全部</label>
                <label><input v-model="debugFilter" type="radio" value="matched" /> 命中</label>
                <label><input v-model="debugFilter" type="radio" value="rejected" /> 未命中</label>
                <button class="btn btn-small" :disabled="debugLoading" @click="runDebugScan(task.id)">{{ debugLoading ? '扫描中…' : '重新扫描' }}</button>
              </div>
            </div>
            <div v-if="debugLoading" class="debug-empty">正在扫描，请稍候…</div>
            <div v-else-if="displayedDebugResults.length === 0" class="debug-empty">
              暂无调试结果。如果长时间没有数据，可能是网络无法访问 OKX，请尝试配置 HTTPS_PROXY 代理。
            </div>
            <div v-else class="debug-summary">
              共 {{ debugResults.length }} 个候选，命中 {{ debugResults.filter(r => r.matched).length }} 个，未命中 {{ debugResults.filter(r => !r.matched).length }} 个
              <span v-if="debugFilter !== 'all' || selectedRuleIds.length > 0">（当前显示 {{ displayedDebugResults.length }} 个）</span>
            </div>
            <div v-if="!debugLoading && ruleOptions.length > 0" class="debug-rule-filter">
              <div class="rule-filter-label">按命中规则筛选：</div>
              <div class="rule-tags">
                <button v-for="rule in ruleOptions" :key="rule.id" class="rule-tag" :class="{ active: selectedRuleIds.includes(rule.id) }" @click="toggleRule(rule.id)">
                  {{ rule.label }}
                </button>
              </div>
              <div class="rule-mode">
                <label><input v-model="ruleMatchMode" type="radio" value="all" /> 全部命中</label>
                <label><input v-model="ruleMatchMode" type="radio" value="any" /> 命中任意</label>
                <button v-if="selectedRuleIds.length > 0" class="btn btn-small btn-clear" @click="selectedRuleIds = []">清除</button>
              </div>
            </div>
            <div v-if="!debugLoading" class="debug-list">
              <div v-for="entry in displayedDebugResults" :key="`${entry.pair}-${entry.timeframe}`" class="debug-item" :class="{ matched: entry.matched, rejected: !entry.matched }">
                <div class="debug-item-header">
                  <span class="debug-pair">{{ entry.pair }} {{ entry.timeframe }}</span>
                  <span class="debug-badge" :class="entry.matched ? 'badge-matched' : 'badge-rejected'">{{ entry.matched ? '命中' : '未命中' }}</span>
                  <span v-if="entry.insufficientData" class="debug-badge badge-warn">数据不足</span>
                </div>
                <div v-if="entry.rejectReason" class="debug-reason">{{ entry.rejectReason }}</div>
                <div v-if="entry.multiTimeframe" class="debug-multitf">
                  大势：{{ entry.multiTimeframe.higherTimeframe }} {{ entry.multiTimeframe.higherDirection }} {{ entry.multiTimeframe.higherTrendScore }} / 小势：{{ entry.multiTimeframe.lowerTimeframe }} {{ entry.multiTimeframe.lowerPhase }}
                </div>
                <div class="debug-checks">
                  <div v-for="check in entry.ruleChecks" :key="check.id" class="debug-check" :class="{ passed: check.passed, failed: !check.passed, hard: check.hard }">
                    <span class="check-dot" />{{ check.label }}：{{ check.detail }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <p>暂无通知任务，点击"创建新任务"开始</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useNotifyAPI } from '../composables/useNotifyAPI'
import type { TradePlan } from '../types'
import type { NotifyTask, ScanHistoryEntry, ScanDebugEntry } from '../types'

type RuleKey = 'maDirection' | 'trend' | 'htfLtf' | 'maDistance' | 'pullback' | 'supportResistance' | 'trendScore' | 'riskReward' | 'trailingStop'

type RulesConfig = {
  maDirection: { enabled: boolean }
  trend: { enabled: boolean; minScore: number }
  htfLtf: { enabled: boolean }
  maDistance: { enabled: boolean; maxAtr: number }
  pullback: { enabled: boolean; minAtr: number }
  supportResistance: { enabled: boolean; maxAtr: number }
  trendScore: { enabled: boolean; min: number }
  riskReward: { enabled: boolean; min: number }
  trailingStop: { enabled: boolean; maxPercent: number }
}

interface RuleOption { key: RuleKey; label: string; hasParam: boolean; paramKey: string; paramLabel: string; paramStep: string; paramMin?: number }

const RULE_OPTIONS: RuleOption[] = [
  { key: 'maDirection', label: '均线方向正确', hasParam: false, paramKey: '', paramLabel: '', paramStep: '' },
  { key: 'trend', label: '顺势而为', hasParam: true, paramKey: 'minScore', paramLabel: '最低趋势评分', paramStep: '1', paramMin: 0 },
  { key: 'htfLtf', label: '顺大势逆小势', hasParam: false, paramKey: '', paramLabel: '', paramStep: '' },
  { key: 'maDistance', label: '未偏离均线过远', hasParam: true, paramKey: 'maxAtr', paramLabel: '最大 ATR 距离', paramStep: '0.1', paramMin: 0 },
  { key: 'pullback', label: '回撤幅度达到要求', hasParam: true, paramKey: 'minAtr', paramLabel: '最小 ATR 回撤', paramStep: '0.1', paramMin: 0 },
  { key: 'supportResistance', label: '存在有效支撑/阻力', hasParam: true, paramKey: 'maxAtr', paramLabel: '最大 ATR 距离', paramStep: '0.1', paramMin: 0 },
  { key: 'trendScore', label: '趋势评分达标', hasParam: true, paramKey: 'min', paramLabel: '最低评分', paramStep: '1', paramMin: 0 },
  { key: 'riskReward', label: '盈亏比达标', hasParam: true, paramKey: 'min', paramLabel: '最低盈亏比', paramStep: '0.1', paramMin: 0 },
  { key: 'trailingStop', label: '移动止损可接受', hasParam: true, paramKey: 'maxPercent', paramLabel: '最大止损 %', paramStep: '0.1', paramMin: 0 },
]

const { getTasks, createTask, updateTask, deleteTask, toggleTask, triggerTask, debugScanTask, getScanHistory, getTradingHistory } = useNotifyAPI()

const tasks = ref<NotifyTask[]>([])
const showCreateForm = ref(false)
const editingTaskId = ref<string | null>(null)
const useAllPairs = ref(true)
const pairsInput = ref('BTC-USDT,ETH-USDT,SOL-USDT')
const historyTaskId = ref<string | null>(null)
const scanHistory = ref<ScanHistoryEntry[]>([])
const loadingHistory = ref(false)
const analysisTaskId = ref<string | null>(null)
const tradeHistory = ref<TradePlan[]>([])
const debugTaskId = ref<string | null>(null)
const debugResults = ref<ScanDebugEntry[]>([])
const debugLoading = ref(false)
const debugFilter = ref<'all' | 'matched' | 'rejected'>('all')
const selectedRuleIds = ref<string[]>([])
const ruleMatchMode = ref<'all' | 'any'>('all')

function defaultForm() {
  return {
    name: '',
    email: '',
    emailEnabled: true,
    interval: '1h' as '15m' | '1h' | '4h' | '12h' | '24h',
    filters: {
      minTrendScore: 60,
      minRiskReward: 1.5,
      maxTrailingStop: 5,
      minRuleHits: 9,
      rules: {
        maDirection: { enabled: true },
        trend: { enabled: true, minScore: 50 },
        htfLtf: { enabled: true },
        maDistance: { enabled: true, maxAtr: 1.5 },
        pullback: { enabled: true, minAtr: 0.8 },
        supportResistance: { enabled: true, maxAtr: 1 },
        trendScore: { enabled: true, min: 60 },
        riskReward: { enabled: true, min: 1.5 },
        trailingStop: { enabled: true, maxPercent: 5 },
      },
      multiTimeframe: { enabled: true, higherTimeframe: '4H', lowerTimeframe: '1H', minHigherTrendScore: 60 }
    },
    timeframes: ['1H', '4H'],
    autoApproveSimulation: false
  }
}

const form = ref(defaultForm())

async function loadTasks() {
  try {
    tasks.value = await getTasks()
  } catch (err) {
    console.error('Failed to load tasks:', err)
    alert('加载任务列表失败，请确保后端服务已启动')
  }
}

async function toggleAnalysis(taskId: string) {
  analysisTaskId.value = analysisTaskId.value === taskId ? null : taskId
  if (analysisTaskId.value && tradeHistory.value.length === 0) {
    try { tradeHistory.value = await getTradingHistory() } catch (err) { console.error('Failed to load trade history:', err) }
  }
}

function taskAnalysis(task: NotifyTask) {
  const allRows = tradeHistory.value.filter(plan => plan.sourceKey?.startsWith(`${task.id}:`))
  const rows = allRows.filter(plan => plan.status === 'closed' && typeof plan.realizedPnl === 'number' && Number.isFinite(plan.realizedPnl))
  const pnl = rows.reduce((sum, row) => sum + Number(row.realizedPnl || 0), 0)
  const reversePnl = -pnl
  const wins = rows.filter(row => Number(row.realizedPnl || 0) > 0).length
  const reverseWins = rows.filter(row => Number(row.realizedPnl || 0) < 0).length
  let peak = 0; let drawdown = 0; let running = 0
  rows.slice().sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0)).forEach(row => { running += Number(row.realizedPnl || 0); peak = Math.max(peak, running); drawdown = Math.max(drawdown, peak - running) })
  return { count: rows.length, unsettled: allRows.length - rows.length, pnl, winRate: rows.length ? wins / rows.length * 100 : 0, drawdown, reversePnl, reverseWinRate: rows.length ? reverseWins / rows.length * 100 : 0 }
}

function getTaskRulesConfig(task: NotifyTask): RulesConfig {
  return (task.filters.rules as RulesConfig | undefined) || migrateToRules(task)
}

function migrateToRules(task: NotifyTask): RulesConfig {
  const old = task.filters.optionalRules || {}
  const defaults = defaultForm().filters.rules
  return {
    maDirection: { enabled: true },
    trend: { enabled: true, minScore: 50 },
    htfLtf: { enabled: true },
    maDistance: { enabled: old.maDistance?.enabled !== false, maxAtr: Number(old.maDistance?.maxAtr ?? defaults?.maDistance?.maxAtr ?? 1.5) },
    pullback: { enabled: old.pullback?.enabled !== false, minAtr: Number(old.pullback?.minAtr ?? defaults?.pullback?.minAtr ?? 0.8) },
    supportResistance: { enabled: old.supportResistance?.enabled !== false, maxAtr: Number(old.supportResistance?.maxAtr ?? defaults?.supportResistance?.maxAtr ?? 1) },
    trendScore: { enabled: old.trendScore?.enabled !== false, min: Number(old.trendScore?.min ?? task.filters.minTrendScore ?? defaults?.trendScore?.min ?? 60) },
    riskReward: { enabled: old.riskReward?.enabled !== false, min: Number(old.riskReward?.min ?? task.filters.minRiskReward ?? defaults?.riskReward?.min ?? 1.5) },
    trailingStop: { enabled: old.trailingStop?.enabled !== false, maxPercent: Number(old.trailingStop?.maxPercent ?? task.filters.maxTrailingStop ?? defaults?.trailingStop?.maxPercent ?? 5) },
  }
}

function handleEditTask(task: NotifyTask) {
  editingTaskId.value = task.id
  const rules = getTaskRulesConfig(task)
  const enabledRuleCount = Object.values(rules).filter(r => r.enabled).length
  form.value = {
    name: task.name,
    email: task.email,
    emailEnabled: task.emailEnabled !== false,
    interval: task.interval,
    filters: {
      ...defaultForm().filters,
      ...task.filters,
      minRuleHits: task.filters.minRuleHits ?? task.filters.minOptionalHits ?? enabledRuleCount,
      rules,
      multiTimeframe: { ...defaultForm().filters.multiTimeframe, ...(task.filters.multiTimeframe || {}) }
    },
    timeframes: [...task.timeframes],
    autoApproveSimulation: task.autoApproveSimulation === true
  }
  useAllPairs.value = task.pairs.includes('*')
  pairsInput.value = useAllPairs.value ? pairsInput.value : task.pairs.join(',')
  showCreateForm.value = true
}

function handleCancelForm() {
  showCreateForm.value = false
  editingTaskId.value = null
  form.value = defaultForm()
}

function buildFiltersForSubmit() {
  const f = form.value.filters
  const rules: RulesConfig = f.rules || defaultForm().filters.rules
  const enabledCount = Object.values(rules).filter(r => r.enabled).length
  const minRuleHits = Math.min(Math.max(0, f.minRuleHits ?? enabledCount), enabledCount)
  const cleaned: NotifyTask['filters'] = {
    minTrendScore: Number(rules.trendScore.min ?? f.minTrendScore ?? 60),
    minRiskReward: Number(rules.riskReward.min ?? f.minRiskReward ?? 1.5),
    maxTrailingStop: Number(rules.trailingStop.maxPercent ?? f.maxTrailingStop ?? 5),
    minRuleHits,
    rules,
    multiTimeframe: f.multiTimeframe
  }
  return cleaned
}

async function handleSubmitTask() {
  if (!form.value.name || (form.value.emailEnabled && !form.value.email)) {
    alert('请填写任务名称和邮箱')
    return
  }

  if (form.value.timeframes.length === 0) {
    alert('请至少选择一个时间周期')
    return
  }

  try {
    const pairs = useAllPairs.value ? ['*'] : pairsInput.value.split(',').map(p => p.trim()).filter(Boolean)
    const filters = buildFiltersForSubmit()

    if (editingTaskId.value) {
      await updateTask(editingTaskId.value, {
        name: form.value.name,
        email: form.value.email,
        emailEnabled: form.value.emailEnabled,
        interval: form.value.interval,
        filters,
        pairs,
        timeframes: form.value.timeframes,
        autoApproveSimulation: form.value.autoApproveSimulation
      })
    } else {
      await createTask({
        name: form.value.name,
        email: form.value.email,
        emailEnabled: form.value.emailEnabled,
        interval: form.value.interval,
        enabled: true,
        filters,
        pairs,
        timeframes: form.value.timeframes,
        autoApproveSimulation: form.value.autoApproveSimulation
      })
    }

    handleCancelForm()
    await loadTasks()
  } catch (err) {
    console.error('Failed to save task:', err)
    alert(editingTaskId.value ? '保存修改失败' : '创建任务失败')
  }
}

async function handleToggle(id: string) {
  try {
    await toggleTask(id)
    await loadTasks()
  } catch (err) {
    console.error('Failed to toggle task:', err)
    alert('切换任务状态失败')
  }
}

async function handleDelete(id: string) {
  if (!confirm('确定要删除这个任务吗？')) return

  try {
    await deleteTask(id)
    await loadTasks()
  } catch (err) {
    console.error('Failed to delete task:', err)
    alert('删除任务失败')
  }
}

async function handleTrigger(id: string) {
  try {
    await triggerTask(id)
    alert('任务已触发，稍后将发送邮件通知')
  } catch (err) {
    console.error('Failed to trigger task:', err)
    alert('触发任务失败')
  }
}

async function toggleDebug(taskId: string) {
  if (debugTaskId.value === taskId) {
    debugTaskId.value = null
    return
  }
  debugTaskId.value = taskId
  await runDebugScan(taskId)
}

async function runDebugScan(taskId: string) {
  debugLoading.value = true
  debugResults.value = []
  selectedRuleIds.value = []
  try {
    debugResults.value = await debugScanTask(taskId)
  } catch (err) {
    console.error('Failed to debug scan task:', err)
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('aborted') || message.includes('timeout') || message.includes('AbortError')) {
      alert('调试扫描超时。候选品种较多或网络较慢，建议缩小扫描范围或配置 HTTPS_PROXY 代理后重试。')
    } else {
      alert(`调试扫描失败：${message}`)
    }
  } finally {
    debugLoading.value = false
  }
}

const ruleOptions = computed(() => {
  const map = new Map<string, string>()
  for (const entry of debugResults.value) {
    for (const check of entry.ruleChecks || []) {
      if (!map.has(check.id)) map.set(check.id, check.label)
    }
  }
  return Array.from(map.entries()).map(([id, label]) => ({ id, label }))
})

const displayedDebugResults = computed(() => {
  let list = debugResults.value
  if (debugFilter.value === 'matched') list = list.filter(r => r.matched)
  if (debugFilter.value === 'rejected') list = list.filter(r => !r.matched)

  if (selectedRuleIds.value.length > 0) {
    list = list.filter(entry => {
      const passedIds = new Set((entry.ruleChecks || []).filter(c => c.passed).map(c => c.id))
      if (ruleMatchMode.value === 'all') {
        return selectedRuleIds.value.every(id => passedIds.has(id))
      }
      return selectedRuleIds.value.some(id => passedIds.has(id))
    })
  }
  return list
})

function toggleRule(ruleId: string) {
  const set = new Set(selectedRuleIds.value)
  if (set.has(ruleId)) set.delete(ruleId)
  else set.add(ruleId)
  selectedRuleIds.value = Array.from(set)
}

async function handleShowHistory(taskId: string) {
  historyTaskId.value = taskId
  loadingHistory.value = true
  try { scanHistory.value = await getScanHistory(taskId) }
  catch (err) { console.error('Failed to load scan history:', err); alert('加载扫描历史失败') }
  finally { loadingHistory.value = false }
}

function intervalLabel(interval: string): string {
  const map: Record<string, string> = {
    '15m': '每15分钟',
    '1h': '每小时',
    '4h': '每4小时',
    '12h': '每12小时',
    '24h': '每天'
  }
  return map[interval] || interval
}

function taskRuleSummary(task: NotifyTask) {
  const rules = getTaskRulesConfig(task)
  const enabled = Object.values(rules).filter(r => r.enabled).length
  const hits = task.filters.minRuleHits ?? task.filters.minOptionalHits ?? enabled
  return `启用 ${enabled}/9 条规则，至少命中 ${hits} 条`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

onMounted(() => {
  loadTasks()
})
</script>

<style scoped>
.tab-content { display: flex; flex-direction: column; gap: 24px; }
.chart-card { background: var(--bg-card); border-radius: 16px; padding: 24px; border: 1px solid var(--border-color); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.chart-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); }

.btn { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 0.8rem; cursor: pointer; background: var(--bg-secondary); color: var(--text-primary); transition: all 0.3s; }
.btn:hover { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }
.btn-primary { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }
.btn-primary:hover { background: #2563eb; }
.btn-secondary { background: var(--bg-secondary); }
.btn-delete { background: var(--accent-red); border-color: var(--accent-red); color: #fff; }
.btn-delete:hover { background: #dc2626; }
.btn-trigger { background: var(--accent-green); border-color: var(--accent-green); color: #fff; }
.btn-trigger:hover { background: #059669; }

.task-form { background: var(--bg-secondary); padding: 20px; border-radius: 8px; margin-bottom: 20px; }
.form-mode-title { margin: 0 0 16px 0; font-size: 1rem; color: var(--text-primary); font-weight: 600; }
.form-row { margin-bottom: 16px; }
.form-row label { display: block; margin-bottom: 6px; font-size: 0.9rem; color: var(--text-secondary); font-weight: 500; }
.form-row input[type="text"], .form-row input[type="email"], .form-row input[type="number"], .form-row select { width: 100%; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-card); color: var(--text-primary); font-size: 0.9rem; }
.form-section { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color); }
.form-section h4 { margin-bottom: 12px; font-size: 0.95rem; color: var(--text-primary); }
.checkbox-group { display: flex; gap: 16px; }
.checkbox-group label { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; }
.form-actions { display: flex; gap: 12px; margin-top: 20px; }
.history-toolbar { display: flex; gap: 8px; margin: -4px 0 16px; }
.history-toolbar select { flex: 1; padding: 6px 8px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; }
.history-panel { margin-bottom: 20px; padding: 16px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; }
.history-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
.history-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; }
.history-item { display: grid; grid-template-columns: 145px 50px 90px 1fr; gap: 8px; padding: 8px; background: var(--bg-card); border-radius: 6px; font-size: .78rem; }
.history-item.failed { border-left: 3px solid var(--accent-red); }
.history-pairs { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.history-empty { color: var(--text-secondary); padding: 12px 0; font-size: .85rem; }
.auto-sim-row small { display: block; margin-top: 5px; color: var(--text-secondary); font-size: .75rem; }
.analysis-panel { margin-top: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); }
.analysis-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.analysis-mode { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 6px; background: var(--bg-card); }
.analysis-mode h5 { margin: 0 0 3px; font-size: .8rem; color: var(--text-primary); }
.analysis-mode.original { border-left: 3px solid var(--accent-blue); }
.analysis-mode.reverse { border-left: 3px solid var(--accent-orange, #f59e0b); }
.analysis-summary { display: flex; gap: 20px; margin-top: 10px; color: var(--text-secondary); font-size: .8rem; }
.analysis-summary b { color: var(--text-primary); }
.sim-enabled { color: var(--accent-green); }

.btn-debug { background: var(--accent-purple, #8b5cf6); border-color: var(--accent-purple, #8b5cf6); color: #fff; }
.btn-debug:hover { background: #7c3aed; }
.btn-debug.active { background: var(--bg-secondary); border-color: var(--accent-purple, #8b5cf6); color: var(--accent-purple, #8b5cf6); }

.task-debug { margin-top: 14px; padding: 14px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); }
.debug-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
.debug-header strong { color: var(--text-primary); }
.debug-actions { display: flex; align-items: center; gap: 12px; }
.debug-actions label { display: flex; align-items: center; gap: 4px; font-size: .8rem; color: var(--text-secondary); cursor: pointer; }
.debug-empty { color: var(--text-secondary); padding: 16px 0; font-size: .85rem; text-align: center; }
.debug-summary { font-size: .8rem; color: var(--text-secondary); margin-bottom: 10px; }
.debug-list { display: flex; flex-direction: column; gap: 10px; max-height: 520px; overflow: auto; }
.debug-item { padding: 12px; border-radius: 6px; background: var(--bg-card); border-left: 3px solid var(--border-color); }
.debug-item.matched { border-left-color: var(--accent-green); }
.debug-item.rejected { border-left-color: var(--accent-red); }
.debug-item-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.debug-pair { font-weight: 600; color: var(--text-primary); }
.debug-badge { padding: 2px 6px; border-radius: 4px; font-size: .72rem; font-weight: 500; }
.badge-matched { background: rgba(16, 185, 129, 0.2); color: var(--accent-green); }
.badge-rejected { background: rgba(239, 68, 68, 0.2); color: var(--accent-red); }
.badge-warn { background: rgba(245, 158, 11, 0.2); color: var(--accent-orange, #f59e0b); }
.debug-reason { font-size: .8rem; color: var(--accent-red); margin-bottom: 8px; }
.debug-multitf { font-size: .78rem; color: var(--text-secondary); margin-bottom: 8px; }
.debug-checks { display: flex; flex-wrap: wrap; gap: 6px; }
.debug-check { display: flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 4px; font-size: .75rem; background: rgba(239, 68, 68, 0.1); color: var(--accent-red); }
.debug-check.passed { background: rgba(16, 185, 129, 0.1); color: var(--accent-green); }
.debug-check.hard { font-weight: 600; }
.check-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.debug-rule-filter { margin: 12px 0; padding: 12px; background: var(--bg-card); border-radius: 6px; }
.rule-filter-label { font-size: .8rem; color: var(--text-secondary); margin-bottom: 8px; }
.rule-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.rule-tag { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 14px; font-size: .78rem; background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer; transition: all 0.2s; }
.rule-tag:hover { border-color: var(--accent-blue); color: var(--accent-blue); }
.rule-tag.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }
.rule-mode { display: flex; align-items: center; gap: 12px; }
.rule-mode label { display: flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--text-secondary); cursor: pointer; }
.rule-mode .btn-clear { margin-left: auto; }

.tasks-list { display: flex; flex-direction: column; gap: 16px; }
.task-card { background: var(--bg-secondary); padding: 16px; border-radius: 8px; border: 1px solid var(--border-color); }
.task-card.disabled { opacity: 0.6; }
.task-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.task-title { display: flex; align-items: center; gap: 12px; }
.task-name { font-size: 1rem; font-weight: 600; color: var(--text-primary); }
.task-status { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
.task-status.enabled { background: rgba(16, 185, 129, 0.2); color: var(--accent-green); }
.task-status.disabled { background: rgba(156, 163, 175, 0.2); color: var(--text-secondary); }
.task-actions { display: flex; gap: 8px; }
.task-info { display: flex; flex-direction: column; gap: 8px; }
.info-row { display: flex; gap: 8px; font-size: 0.85rem; }
.info-row .label { color: var(--text-secondary); min-width: 80px; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }

.rules-config { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.rule-config-row { display: flex; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 4px; background: var(--bg-card); }
.rule-enable { display: flex; align-items: center; gap: 6px; font-size: .85rem; color: var(--text-primary); cursor: pointer; min-width: 150px; }
.rule-param { display: flex; align-items: center; gap: 6px; font-size: .8rem; color: var(--text-secondary); margin-left: auto; }
.rule-param input { width: 70px; padding: 3px 6px; font-size: .8rem; }
</style>
