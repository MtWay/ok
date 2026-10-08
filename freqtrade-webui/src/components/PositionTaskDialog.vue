<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h4>{{ task ? '编辑任务' : '新建任务' }}</h4>
        <button class="modal-x" @click="emit('close')">×</button>
      </div>

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

      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" @click="emit('close')">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="submitting" @click="handleSubmit">
          {{ submitting ? '保存中' : (task ? '保存' : '创建') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { PositionTask, PositionStrategy, PositionInterval, MaCrossParams, TurtlePositionParams, BollingerParams, GridParams, PivotParams } from '../types'
import { useNotifyAPI } from '../composables/useNotifyAPI'

const props = defineProps<{ task?: PositionTask | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { createPositionTask, updatePositionTask, getPositionTasks } = useNotifyAPI()

const submitting = ref(false)

function createDefaultForm() {
  return {
    name: '',
    pair: '',
    strategy: 'bollinger' as PositionStrategy,
    interval: '1H' as PositionInterval,
    params: { period: 20, stdDev: 2 } as MaCrossParams | TurtlePositionParams | BollingerParams | GridParams | PivotParams,
    enabled: true,
  }
}

const form = ref(props.task ? {
  name: props.task.name,
  pair: props.task.pair,
  strategy: props.task.strategy,
  interval: props.task.interval,
  params: { ...props.task.params } as any,
  enabled: props.task.enabled,
} : createDefaultForm())

async function handleSubmit() {
  submitting.value = true
  try {
    if (props.task) {
      await updatePositionTask(props.task.id, {
        name: form.value.name,
        pair: form.value.pair,
        strategy: form.value.strategy,
        interval: form.value.interval,
        params: form.value.params,
      })
    } else {
      const tasks = await getPositionTasks()
      const dup = tasks.find(t => {
        if (t.pair !== form.value.pair || t.strategy !== form.value.strategy || t.interval !== form.value.interval) return false
        const tp = t.params as Record<string, unknown>
        const fp = form.value.params as Record<string, unknown>
        const keys = new Set([...Object.keys(tp), ...Object.keys(fp)])
        for (const k of keys) {
          if (tp[k] !== fp[k]) return false
        }
        return true
      })
      if (dup) {
        const strategyLabels: Record<string, string> = { ma_cross: 'MA交叉', turtle: '海龟', bollinger: '布林', grid: '网格', pivot: '枢轴' }
        if (!confirm(`已存在相同参数的任务「${dup.name}」(${dup.pair} / ${strategyLabels[dup.strategy]} / ${dup.interval})，是否仍要创建？`)) {
          submitting.value = false
          return
        }
      }
      await createPositionTask({
        name: form.value.name,
        pair: form.value.pair,
        strategy: form.value.strategy,
        interval: form.value.interval,
        params: form.value.params,
        enabled: form.value.enabled,
      })
    }
    emit('saved')
    emit('close')
  } catch (err) {
    console.error('Failed to save position task:', err)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  width: min(540px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h4 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--accent-gold);
}

.modal-x {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.3rem;
  cursor: pointer;
  line-height: 1;
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

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
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

.btn:hover {
  opacity: 0.85;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
