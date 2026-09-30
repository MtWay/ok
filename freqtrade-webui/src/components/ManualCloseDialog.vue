<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h4>手动平仓 · {{ task.name }}</h4>
        <button class="modal-x" @click="emit('close')">×</button>
      </div>

      <div v-if="quoteError && levels.length === 0" class="modal-error">{{ quoteError }}</div>

      <template v-else>
        <div class="modal-section">
          <div class="section-title">
            持仓层
            <label class="select-all">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" /> 全选
            </label>
          </div>
          <div v-if="levels.length === 0" class="modal-empty">该任务当前没有持仓层</div>
          <table v-else class="levels-table">
            <thead>
              <tr>
                <th></th><th>层</th><th>方向</th><th>成交价</th><th>止盈价</th><th>类型</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in levels" :key="l.level">
                <td>
                  <input
                    type="checkbox"
                    :checked="selected.includes(l.level)"
                    :disabled="l.kind === 'no_trade'"
                    @change="toggleLevel(l.level)"
                  />
                </td>
                <td class="mono">{{ levelLabel(l.level) }}</td>
                <td>
                  <span class="side-badge" :class="l.side">{{ l.side === 'long' ? '做多' : '做空' }}</span>
                </td>
                <td class="mono">{{ formatPrice(l.price) }}</td>
                <td class="mono">{{ formatPrice(l.tpPrice) }}</td>
                <td><span class="kind-badge" :class="l.kind">{{ KIND_LABEL[l.kind] }}</span></td>
              </tr>
            </tbody>
          </table>
          <div v-if="quote" class="book">
            盘口 买一 {{ formatPrice(quote.bid) }} / 卖一 {{ formatPrice(quote.ask) }} / 最新 {{ formatPrice(quote.last) }}
          </div>
        </div>

        <div class="modal-section">
          <div class="section-title">平仓方式</div>
          <div class="mode-row">
            <label class="mode-option">
              <input type="radio" value="counter" v-model="mode" /> 对手价
            </label>
            <label class="mode-option">
              <input type="radio" value="market" v-model="mode" /> 市价
            </label>
          </div>
          <div v-if="mode === 'counter'" class="price-row">
            <label>委托价</label>
            <input v-model.number="price" type="number" step="any" class="price-input mono" />
            <button class="btn btn-secondary btn-sm" :disabled="quoting" @click="refreshQuote">
              {{ quoting ? '取价中' : '重新取价' }}
            </button>
          </div>
          <div v-if="mode === 'counter' && quote" class="price-hint">
            {{ isLong ? '平多 → 吃卖一价' : '平空 → 吃买一价' }}，提交价偏离超过 1% 会被拒绝
          </div>
        </div>

        <div v-if="result" class="modal-section">
          <div class="section-title">平仓结果</div>
          <div v-if="result.degraded" class="result-warn">{{ result.degradedNote }}</div>
          <div v-for="c in result.closed" :key="`c${c.level}`" class="result-row ok">
            {{ levelLabel(c.level) }} 已平仓{{ c.price ? ` @ ${formatPrice(c.price)}` : '' }}
          </div>
          <div v-for="s in result.skipped" :key="`s${s.level}`" class="result-row warn">
            {{ levelLabel(s.level) }} 已跳过：{{ s.reason }}
          </div>
          <div v-for="f in result.failed" :key="`f${f.level}`" class="result-row bad">
            {{ levelLabel(f.level) }} 平仓失败：{{ f.error }}
          </div>
        </div>
      </template>

      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" @click="emit('close')">关闭</button>
        <button
          class="btn btn-danger btn-sm"
          :disabled="submitting || selected.length === 0"
          @click="submit"
        >
          {{ submitting ? '平仓中' : `确认平仓 ${selected.length} 层` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CloseLevel, CloseQuote, ManualCloseResult, PositionTask } from '../types'
import { useNotifyAPI } from '../composables/useNotifyAPI'
import { formatPrice } from '../utils/planFormat'

const props = defineProps<{ task: PositionTask }>()
const emit = defineEmits<{ close: []; closed: [] }>()

const { getPositionCloseQuote, manualClosePosition } = useNotifyAPI()

const KIND_LABEL: Record<string, string> = {
  live: '实仓', shadow: '影子单', no_trade: '无 tradeId',
}

const quote = ref<CloseQuote | null>(null)
const levels = ref<CloseLevel[]>([])
const selected = ref<number[]>([])
const mode = ref<'counter' | 'market'>('counter')
const price = ref<number | undefined>(undefined)
const quoteError = ref('')
const quoting = ref(false)
const submitting = ref(false)
const result = ref<ManualCloseResult | null>(null)

const levelsLabel = computed(() =>
  props.task.strategy === 'grid' ? (l: number) => `L${l}` : (l: number) => (l === 0 ? '本仓' : `#${l}`),
)
function levelLabel(level: number): string {
  return levelsLabel.value(level)
}


const isLong = computed(() => (levels.value[0]?.side ?? 'long') === 'long')
const selectable = computed(() => levels.value.filter(l => l.kind !== 'no_trade'))
const allSelected = computed(() =>
  selectable.value.length > 0 && selectable.value.every(l => selected.value.includes(l.level)),
)

function toggleLevel(level: number) {
  const i = selected.value.indexOf(level)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(level)
}

function toggleAll() {
  selected.value = allSelected.value ? [] : selectable.value.map(l => l.level)
}

function defaultPrice(q: CloseQuote): number {
  const side = q.levels.find(l => l.kind === 'live')?.side ?? q.levels[0]?.side ?? 'long'
  return side === 'long' ? q.ask : q.bid
}

async function refreshQuote() {
  quoting.value = true
  quoteError.value = ''
  try {
    const q = await getPositionCloseQuote(props.task.id)
    quote.value = q
    levels.value = q.levels
    const available = q.levels.filter(l => l.kind !== 'no_trade').map(l => l.level)
    // 平仓后层集会变，重新收敛到仍然存在的层
    selected.value = available.filter(l => selected.value.length === 0 || selected.value.includes(l))
    price.value = defaultPrice(q)
  } catch (err) {
    // 取价失败时保留用户已填的价格，只提示，不覆盖
    quoteError.value = err instanceof Error ? err.message : '取价失败'
  } finally {
    quoting.value = false
  }
}

async function submit() {
  submitting.value = true
  try {
    result.value = await manualClosePosition(props.task.id, {
      levels: selected.value,
      mode: mode.value,
      price: mode.value === 'counter' ? price.value : undefined,
    })
    emit('closed')
    await refreshQuote()
  } catch (err) {
    quoteError.value = err instanceof Error ? err.message : '平仓失败'
  } finally {
    submitting.value = false
  }
}

watch(() => props.task.id, () => {
  quote.value = null
  levels.value = []
  selected.value = []
  result.value = null
  price.value = undefined
  refreshQuote()
}, { immediate: true })
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
  width: min(620px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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

.modal-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 0.78rem;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.select-all,
.mode-option {
  font-size: 0.75rem;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.mode-row {
  display: flex;
  gap: 18px;
}

.modal-empty,
.modal-error {
  font-size: 0.8rem;
  padding: 12px;
  text-align: center;
  color: var(--text-secondary);
}

.modal-error { color: var(--accent-red); }

.levels-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.levels-table th {
  text-align: left;
  padding: 4px 6px;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.72rem;
  border-bottom: 1px solid var(--border-color);
}

.levels-table td {
  padding: 5px 6px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  color: var(--text-primary);
}

.mono {
  font-family: 'Space Mono', monospace;
}

.book {
  font-family: 'Space Mono', monospace;
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.price-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.price-input {
  flex: 1;
  padding: 6px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.82rem;
}

.price-hint {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.price-hint.error { color: var(--accent-red); }

.result-row {
  font-size: 0.76rem;
  padding: 3px 0;
}

.result-row.ok { color: var(--accent-green); }
.result-row.warn { color: var(--accent-gold); }
.result-row.bad { color: var(--accent-red); }
.result-warn { font-size: 0.76rem; color: var(--accent-gold); }

.side-badge,
.kind-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
}

.side-badge.long { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); }
.side-badge.short { background: rgba(239, 68, 68, 0.15); color: var(--accent-red); }

.kind-badge { background: rgba(148, 163, 184, 0.18); color: var(--text-secondary); }
.kind-badge.live { background: rgba(59, 130, 246, 0.18); color: var(--accent-blue); }
.kind-badge.no_trade { background: rgba(239, 68, 68, 0.15); color: var(--accent-red); }

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-sm { padding: 4px 10px; font-size: 0.75rem; }
.btn-secondary { background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); }
.btn-danger { background: var(--accent-red); color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
