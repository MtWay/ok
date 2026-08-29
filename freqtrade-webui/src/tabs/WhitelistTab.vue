<template>
  <div class="tab-content">
    <!-- 当前白名单 -->
    <div class="wl-card">
      <div class="wl-header">
        <div class="wl-title">📋 当前白名单（{{ draft.length }} 个）</div>
        <div class="wl-actions">
          <button class="btn btn-small" :disabled="loading" @click="refresh">刷新</button>
          <button
            class="btn btn-small btn-primary"
            :disabled="!dirty || saving || draft.length === 0"
            @click="save"
          >
            {{ saving ? '保存中...' : dirty ? '保存并热重载' : '已生效' }}
          </button>
        </div>
      </div>
      <div v-if="dirty" class="wl-hint">有未保存的修改，点击"保存并热重载"后写入配置并让 Freqtrade 热加载生效（无需重启）。</div>
      <div class="wl-add-row">
        <input
          v-model="manualPair"
          class="wl-input"
          placeholder="手动添加，如 BTC/USDT:USDT"
          @keyup.enter="addManual"
        />
        <button class="btn btn-small" @click="addManual">添加</button>
      </div>
      <div v-if="draft.length > 0" class="wl-chips">
        <span v-for="pair in draft" :key="pair" class="wl-chip">
          {{ pair }}
          <button class="wl-chip-remove" title="移除" @click="removePair(pair)">×</button>
        </span>
      </div>
      <div v-else class="empty-state"><p>白名单为空，请先从下方拉取数据添加</p></div>
    </div>

    <!-- 候选交易对 -->
    <div class="wl-card">
      <div class="wl-header">
        <div class="wl-title">🔍 OKX 永续合约候选</div>
        <div class="wl-actions">
          <select v-model="sortMode" class="wl-select">
            <option value="volume">按 24h 成交额</option>
            <option value="change">按 24h 涨跌幅</option>
            <option value="new">按新上线</option>
          </select>
          <button class="btn btn-small" :disabled="fetching" @click="fetchCandidates">
            {{ fetching ? '拉取中...' : '拉取数据' }}
          </button>
          <button class="btn btn-small btn-primary" :disabled="selected.size === 0" @click="addSelected">
            添加所选（{{ selected.size }}）
          </button>
        </div>
      </div>
      <div v-if="candidates.length > 0" class="wl-add-row">
        <input v-model="search" class="wl-input" placeholder="搜索币种，如 BTC" />
      </div>
      <div v-if="filteredCandidates.length > 0" class="table-container">
        <table class="wl-table">
          <thead>
            <tr>
              <th><input type="checkbox" :checked="allVisibleSelected" @change="toggleAllVisible" /></th>
              <th>交易对</th>
              <th>最新价</th>
              <th>24h 涨跌</th>
              <th>24h 成交额(USDT)</th>
              <th>上线时间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filteredCandidates" :key="item.instId">
              <td>
                <input
                  type="checkbox"
                  :checked="selected.has(item.instId)"
                  :disabled="inWhitelist(item.instId)"
                  @change="toggleSelect(item.instId)"
                />
              </td>
              <td>{{ toFreqtradePair(item.instId) }}</td>
              <td>{{ item.last }}</td>
              <td :class="item.change24h >= 0 ? 'positive' : 'negative'">
                {{ (item.change24h * 100).toFixed(2) }}%
              </td>
              <td>{{ formatVolume(item.volCcy24h) }}</td>
              <td>{{ formatListTime(item.listTime) }}</td>
              <td><span v-if="inWhitelist(item.instId)" class="wl-badge">已在白名单</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state"><p>{{ candidates.length > 0 ? '无匹配结果' : '点击"拉取数据"获取 OKX 永续合约列表' }}</p></div>
    </div>

    <div v-if="errorMsg" class="wl-error" @click="errorMsg = ''">{{ errorMsg }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDynamicPairs } from '../composables/useDynamicPairs'
import { useNotifyAPI } from '../composables/useNotifyAPI'
import type { HotPairInfo } from '../types'

const { fetchHotPairs } = useDynamicPairs()
const { getWhitelist, setWhitelist } = useNotifyAPI()

const draft = ref<string[]>([])
const applied = ref<string[]>([])
const loading = ref(false)
const saving = ref(false)
const fetching = ref(false)
const errorMsg = ref('')
const manualPair = ref('')
const search = ref('')
const sortMode = ref<'volume' | 'change' | 'new'>('volume')
const hotPairs = ref<{ byVolume: HotPairInfo[]; byChange: HotPairInfo[]; byListTime: HotPairInfo[] } | null>(null)
const selected = ref(new Set<string>())

const dirty = computed(() =>
  draft.value.length !== applied.value.length ||
  draft.value.some(pair => !applied.value.includes(pair))
)

const candidates = computed<HotPairInfo[]>(() => {
  if (!hotPairs.value) return []
  if (sortMode.value === 'change') return hotPairs.value.byChange
  if (sortMode.value === 'new') return hotPairs.value.byListTime
  return hotPairs.value.byVolume
})

const filteredCandidates = computed(() => {
  const keyword = search.value.trim().toUpperCase()
  if (!keyword) return candidates.value
  return candidates.value.filter(item => item.instId.toUpperCase().includes(keyword))
})

const allVisibleSelected = computed(() =>
  filteredCandidates.value.length > 0 &&
  filteredCandidates.value.every(item => selected.value.has(item.instId) || inWhitelist(item.instId))
)

function toFreqtradePair(instId: string): string {
  const base = instId.replace(/-USDT-SWAP$/i, '')
  return `${base}/USDT:USDT`
}

function inWhitelist(instId: string): boolean {
  return draft.value.includes(toFreqtradePair(instId))
}

function toggleSelect(instId: string) {
  if (selected.value.has(instId)) selected.value.delete(instId)
  else selected.value.add(instId)
  selected.value = new Set(selected.value)
}

function toggleAllVisible() {
  const next = new Set(selected.value)
  if (allVisibleSelected.value) {
    filteredCandidates.value.forEach(item => next.delete(item.instId))
  } else {
    filteredCandidates.value.forEach(item => { if (!inWhitelist(item.instId)) next.add(item.instId) })
  }
  selected.value = next
}

function addPair(pair: string) {
  if (!draft.value.includes(pair)) draft.value.push(pair)
}

function addSelected() {
  selected.value.forEach(instId => addPair(toFreqtradePair(instId)))
  selected.value = new Set()
}

function addManual() {
  const pair = manualPair.value.trim().toUpperCase()
  if (!pair) return
  if (!/^[A-Z0-9._-]+\/USDT:USDT$/.test(pair)) {
    errorMsg.value = '格式错误，应为 BTC/USDT:USDT'
    return
  }
  addPair(pair)
  manualPair.value = ''
}

function removePair(pair: string) {
  draft.value = draft.value.filter(item => item !== pair)
}

async function refresh() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { whitelist } = await getWhitelist()
    draft.value = [...whitelist]
    applied.value = [...whitelist]
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '获取白名单失败'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  errorMsg.value = ''
  try {
    const { whitelist } = await setWhitelist(draft.value)
    draft.value = [...whitelist]
    applied.value = [...whitelist]
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '保存白名单失败'
  } finally {
    saving.value = false
  }
}

async function fetchCandidates() {
  fetching.value = true
  errorMsg.value = ''
  try {
    hotPairs.value = await fetchHotPairs('SWAP', 100)
    selected.value = new Set()
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '拉取 OKX 数据失败'
  } finally {
    fetching.value = false
  }
}

function formatVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(Math.round(value))
}

function formatListTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('zh-CN')
}

onMounted(refresh)
</script>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.wl-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
}

.wl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.wl-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.wl-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.btn {
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
}

.btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.25);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-small {
  font-size: 0.85rem;
}

.btn-primary {
  background: rgba(245, 158, 11, 0.18);
  border-color: var(--accent-gold);
  color: var(--accent-gold);
}

.btn-primary:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.3);
}

.wl-hint {
  color: var(--accent-gold);
  font-size: 0.85rem;
  margin-bottom: 12px;
}

.wl-add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.wl-input {
  flex: 1;
  max-width: 320px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 8px 12px;
  font-family: 'Space Mono', monospace;
  font-size: 0.85rem;
}

.wl-select {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 6px 10px;
  font-family: inherit;
  font-size: 0.85rem;
}

.wl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wl-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: var(--accent-green);
  border-radius: 16px;
  padding: 4px 10px;
  font-family: 'Space Mono', monospace;
  font-size: 0.8rem;
}

.wl-chip-remove {
  background: none;
  border: none;
  color: var(--accent-red);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0;
}

.table-container {
  overflow-x: auto;
  max-height: 480px;
  overflow-y: auto;
}

.wl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.wl-table th,
.wl-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.wl-table th {
  color: var(--text-secondary);
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
}

.wl-table td {
  font-family: 'Space Mono', monospace;
}

.positive { color: var(--accent-green); }
.negative { color: var(--accent-red); }

.wl-badge {
  color: var(--accent-green);
  font-size: 0.78rem;
}

.empty-state {
  text-align: center;
  color: var(--text-secondary);
  padding: 30px 0;
}

.wl-error {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 20px;
  background: rgba(239, 68, 68, 0.9);
  border-radius: 8px;
  color: #fff;
  z-index: 1001;
  font-size: 0.85rem;
  cursor: pointer;
}
</style>
