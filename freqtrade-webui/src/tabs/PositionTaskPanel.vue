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
          <label>上界价格</label>
          <input v-model.number="(form.params as any).upperPrice" type="number" step="0.01">
        </div>
        <div class="form-group">
          <label>下界价格</label>
          <input v-model.number="(form.params as any).lowerPrice" type="number" step="0.01">
        </div>
        <div class="form-group">
          <label>网格数</label>
          <input v-model.number="(form.params as any).gridCount" type="number" min="2" max="50">
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
            <span class="task-pair">{{ task.pair }}</span>
            <span class="task-strategy">{{ strategyLabel(task.strategy) }}</span>
            <span class="task-interval">{{ task.interval }}</span>
          </div>
          <div class="task-actions">
            <button class="btn btn-sm" :class="task.enabled ? 'btn-warning' : 'btn-success'" @click="handleToggle(task)">
              {{ task.enabled ? '暂停' : '启用' }}
            </button>
            <button class="btn btn-secondary btn-sm" @click="handleTrigger(task)">手动触发</button>
            <button class="btn btn-danger btn-sm" @click="handleDelete(task)">删除</button>
          </div>
        </div>
        <div class="task-body">
          <div class="task-state" v-if="taskStates[task.id]">
            <span class="state-label">状态:</span>
            <span class="state-value" :class="taskStates[task.id].status">
              {{ statusLabel(taskStates[task.id].status) }}
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
          <div v-if="task.lastResult" class="task-last-run">
            上次运行: {{ formatTime(task.lastRun) }}
            <span v-if="task.lastResult.actions.length > 0" class="task-actions-summary">
              → {{ task.lastResult.actions.join(', ') }}
            </span>
            <span v-else class="task-actions-summary">→ 无信号</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { PositionTask, PositionState, PositionStrategy, PositionInterval, MaCrossParams, TurtlePositionParams, BollingerParams, GridParams, PivotParams } from '../types'
import { useNotifyAPI } from '../composables/useNotifyAPI'

const { getPositionTasks, createPositionTask, deletePositionTask, togglePositionTask, triggerPositionTask, getPositionTaskState } = useNotifyAPI()

const tasks = ref<PositionTask[]>([])
const taskStates = ref<Record<string, PositionState>>({})
const showCreateForm = ref(false)
const form = ref(createDefaultForm())

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

function statusLabel(s: string): string {
  const labels: Record<string, string> = { flat: '空仓', long: '做多', short: '做空' }
  return labels[s] ?? s
}

function formatTime(ts?: number): string {
  if (!ts) return '--'
  return new Date(ts).toLocaleTimeString()
}

async function loadTasks() {
  try {
    tasks.value = await getPositionTasks()
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

async function handleCreate() {
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

async function handleTrigger(task: PositionTask) {
  try {
    await triggerPositionTask(task.id)
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
</style>
