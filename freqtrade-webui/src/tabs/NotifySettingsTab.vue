<template>
  <div class="tab-content">
    <div class="chart-card">
      <div class="chart-header">
        <div class="chart-title">🔔 通知任务管理</div>
        <button class="btn btn-primary" @click="showCreateForm ? handleCancelForm() : (showCreateForm = true)">
          {{ showCreateForm ? '取消' : '创建新任务' }}
        </button>
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
        </div>
        <div class="form-row">
          <label>扫描间隔</label>
          <select v-model="form.interval">
            <option value="1h">每小时</option>
            <option value="4h">每4小时</option>
            <option value="12h">每12小时</option>
            <option value="24h">每天</option>
          </select>
        </div>
        <div class="form-section">
          <h4>筛选条件</h4>
          <div class="form-row">
            <label>最低趋势评分</label>
            <input v-model.number="form.filters.minTrendScore" type="number" min="0" max="100" />
          </div>
          <div class="form-row">
            <label>最低盈亏比</label>
            <input v-model.number="form.filters.minRiskReward" type="number" step="0.1" min="0" />
          </div>
          <div class="form-row">
            <label>最大移动止损%</label>
            <input v-model.number="form.filters.maxTrailingStop" type="number" step="0.1" min="0" />
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
          <div v-if="!useAllPairs" class="form-row">
            <label>选择交易对（逗号分隔）</label>
            <input v-model="pairsInput" type="text" placeholder="BTC-USDT,ETH-USDT,SOL-USDT" />
          </div>
          <div class="form-row">
            <label>时间周期</label>
            <div class="checkbox-group">
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
              <span class="label">条件:</span>
              <span>评分≥{{ task.filters.minTrendScore }} / 盈亏比≥{{ task.filters.minRiskReward }} / 止损≤{{ task.filters.maxTrailingStop }}%</span>
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
        </div>
      </div>
      <div v-else class="empty-state">
        <p>暂无通知任务，点击"创建新任务"开始</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useNotifyAPI } from '../composables/useNotifyAPI'
import type { NotifyTask } from '../types'

const { getTasks, createTask, updateTask, deleteTask, toggleTask, triggerTask } = useNotifyAPI()

const tasks = ref<NotifyTask[]>([])
const showCreateForm = ref(false)
const editingTaskId = ref<string | null>(null)
const useAllPairs = ref(true)
const pairsInput = ref('BTC-USDT,ETH-USDT,SOL-USDT')

function defaultForm() {
  return {
    name: '',
    email: '',
    interval: '1h' as '1h' | '4h' | '12h' | '24h',
    filters: {
      minTrendScore: 60,
      minRiskReward: 1.5,
      maxTrailingStop: 5
    },
    timeframes: ['1H', '4H']
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

function handleEditTask(task: NotifyTask) {
  editingTaskId.value = task.id
  form.value = {
    name: task.name,
    email: task.email,
    interval: task.interval,
    filters: { ...task.filters },
    timeframes: [...task.timeframes]
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

async function handleSubmitTask() {
  if (!form.value.name || !form.value.email) {
    alert('请填写任务名称和邮箱')
    return
  }

  if (form.value.timeframes.length === 0) {
    alert('请至少选择一个时间周期')
    return
  }

  try {
    const pairs = useAllPairs.value ? ['*'] : pairsInput.value.split(',').map(p => p.trim()).filter(Boolean)

    if (editingTaskId.value) {
      await updateTask(editingTaskId.value, {
        name: form.value.name,
        email: form.value.email,
        interval: form.value.interval,
        filters: form.value.filters,
        pairs,
        timeframes: form.value.timeframes
      })
    } else {
      await createTask({
        name: form.value.name,
        email: form.value.email,
        interval: form.value.interval,
        enabled: true,
        filters: form.value.filters,
        pairs,
        timeframes: form.value.timeframes
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

function intervalLabel(interval: string): string {
  const map: Record<string, string> = {
    '1h': '每小时',
    '4h': '每4小时',
    '12h': '每12小时',
    '24h': '每天'
  }
  return map[interval] || interval
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
</style>
