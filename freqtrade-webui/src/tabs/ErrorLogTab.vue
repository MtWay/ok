<template>
  <div class="tab-content">
    <div class="err-card">
      <div class="err-header">
        <div class="err-title">🐛 错误日志（{{ errors.length }} 条）</div>
        <div class="err-actions">
          <select v-model="filterStage" class="err-select">
            <option value="">全部阶段</option>
            <option v-for="s in stages" :key="s" :value="s">{{ getStageLabel(s) }}</option>
          </select>
          <select v-model="filterLevel" class="err-select">
            <option value="">全部级别</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
          <button class="btn btn-small" @click="refreshBackend">拉取后端错误</button>
          <button class="btn btn-small" @click="exportAsJSON">导出 JSON</button>
          <button class="btn btn-small" @click="exportAsCSV">导出 CSV</button>
          <button class="btn btn-small btn-danger" :disabled="errors.length === 0" @click="clearAll">清空</button>
        </div>
      </div>

      <div v-if="filterStage" class="err-hint">
        已过滤：{{ getStageLabel(filterStage as any) }}
        <button class="err-hint-close" @click="filterStage = ''">×</button>
      </div>

      <div v-if="filtered.length === 0" class="empty-state">
        <p>{{ errors.length === 0 ? '暂无错误记录' : '没有匹配的错误' }}</p>
      </div>

      <div v-else class="err-list">
        <div v-for="record in paginated" :key="record.id" class="err-row" :class="'level-' + record.level">
          <div class="err-row-main" @click="toggleExpand(record.id)">
            <div class="err-row-left">
              <span class="err-level-badge" :class="'badge-' + record.level">{{ record.level }}</span>
              <span class="err-stage-badge">{{ getStageLabel(record.stage) }}</span>
              <span class="err-time">{{ formatTime(record.timestamp) }}</span>
              <span class="err-msg">{{ record.message }}</span>
            </div>
            <div class="err-row-right">
              <span v-if="!record.resolved" class="err-unresolved">未解决</span>
              <span v-else class="err-resolved">已解决</span>
              <span class="err-expand-icon">{{ expandedIds.has(record.id) ? '▼' : '▶' }}</span>
            </div>
          </div>

          <div v-if="expandedIds.has(record.id)" class="err-detail">
            <div class="err-suggestion">
              <span class="err-suggestion-label">💡 处理建议：</span>
              {{ record.suggestion }}
            </div>
            <div v-if="record.detail" class="err-detail-block">
              <div class="err-detail-label">详细信息：</div>
              <pre class="err-pre">{{ record.detail }}</pre>
            </div>
            <div v-if="record.stack" class="err-detail-block">
              <div class="err-detail-label">堆栈：</div>
              <pre class="err-pre err-stack">{{ record.stack }}</pre>
            </div>
            <div v-if="record.context && Object.keys(record.context).length > 0" class="err-detail-block">
              <div class="err-detail-label">上下文：</div>
              <pre class="err-pre">{{ JSON.stringify(record.context, null, 2) }}</pre>
            </div>
            <div class="err-detail-actions">
              <button v-if="!record.resolved" class="btn btn-small btn-primary" @click.stop="markResolved(record.id)">标记已解决</button>
              <button class="btn btn-small" @click.stop="copyRecord(record)">复制</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="totalPages > 1" class="err-pagination">
        <button class="btn btn-small" :disabled="page <= 1" @click="page--">上一页</button>
        <span class="err-page-info">{{ page }} / {{ totalPages }}</span>
        <button class="btn btn-small" :disabled="page >= totalPages" @click="page++">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useErrorCollector } from '../composables/useErrorCollector'
import type { ErrorStage, ErrorRecord } from '../composables/useErrorCollector'

const {
  getErrors,
  markResolved,
  clearErrors,
  exportAsJSON,
  exportAsCSV,
  subscribe,
  getStageLabel,
  fetchBackendErrors,
} = useErrorCollector()

const errors = ref(getErrors())
const filterStage = ref<ErrorStage | ''>('')
const filterLevel = ref<string>('')
const expandedIds = ref(new Set<string>())
const page = ref(1)
const pageSize = 50

const stages: ErrorStage[] = [
  'data-fetch', 'backtest', 'optimize', 'scan', 'validate', 'trend-scan',
  'position', 'notify', 'trading', 'grid', 'whitelist', 'strategy', 'system',
]

const filtered = computed(() => {
  let list = errors.value
  if (filterStage.value) list = list.filter((r) => r.stage === filterStage.value)
  if (filterLevel.value) list = list.filter((r) => r.level === filterLevel.value)
  return [...list].reverse()
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const paginated = computed(() => {
  const start = (page.value - 1) * pageSize
  return filtered.value.slice(start, start + pageSize)
})

function toggleExpand(id: string) {
  const s = new Set(expandedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expandedIds.value = s
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN')
}

async function refreshBackend() {
  const base = import.meta.env.VITE_NOTIFY_API_BASE || ''
  const count = await fetchBackendErrors(base)
  errors.value = getErrors()
  if (count > 0) alert(`已拉取 ${count} 条后端错误`)
}

function clearAll() {
  if (confirm('确定清空所有错误记录？')) {
    clearErrors()
    errors.value = getErrors()
  }
}

async function copyRecord(record: ErrorRecord) {
  const text = [
    `时间: ${formatTime(record.timestamp)}`,
    `阶段: ${getStageLabel(record.stage)}`,
    `级别: ${record.level}`,
    `消息: ${record.message}`,
    `建议: ${record.suggestion}`,
    record.detail ? `详情: ${record.detail}` : '',
    record.stack ? `堆栈: ${record.stack}` : '',
  ].filter(Boolean).join('\n')
  await navigator.clipboard.writeText(text)
}

let unsub: (() => void) | null = null
onMounted(() => {
  unsub = subscribe(() => {
    errors.value = getErrors()
  })
})
onUnmounted(() => {
  unsub?.()
})
</script>

<style scoped>
.err-card {
  background: #1a1a2e;
  border-radius: 8px;
  padding: 16px;
  color: #e0e0e0;
}
.err-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.err-title {
  font-size: 16px;
  font-weight: 600;
}
.err-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.err-select {
  background: #16213e;
  color: #e0e0e0;
  border: 1px solid #334;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
}
.err-hint {
  background: #16213e;
  border: 1px solid #334;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 13px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.err-hint-close {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 16px;
}
.err-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.err-row {
  border: 1px solid #334;
  border-radius: 6px;
  overflow: hidden;
}
.err-row.level-info { border-left: 3px solid #4caf50; }
.err-row.level-warning { border-left: 3px solid #ff9800; }
.err-row.level-error { border-left: 3px solid #f44336; }
.err-row.level-critical { border-left: 3px solid #9c27b0; background: #2a1a2e; }
.err-row-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  gap: 8px;
}
.err-row-main:hover { background: #16213e; }
.err-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.err-row-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.err-level-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
  flex-shrink: 0;
}
.badge-info { background: #1b5e20; color: #a5d6a7; }
.badge-warning { background: #e65100; color: #ffcc80; }
.badge-error { background: #b71c1c; color: #ef9a9a; }
.badge-critical { background: #4a148c; color: #ce93d8; }
.err-stage-badge {
  font-size: 12px;
  background: #16213e;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.err-time {
  font-size: 12px;
  color: #888;
  flex-shrink: 0;
}
.err-msg {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.err-unresolved {
  font-size: 11px;
  color: #f44336;
}
.err-resolved {
  font-size: 11px;
  color: #4caf50;
}
.err-expand-icon {
  font-size: 10px;
  color: #888;
}
.err-detail {
  padding: 12px;
  background: #0f1629;
  border-top: 1px solid #334;
}
.err-suggestion {
  background: #1a2e1a;
  border: 1px solid #2e4a2e;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  margin-bottom: 10px;
}
.err-suggestion-label {
  font-weight: 600;
}
.err-detail-block {
  margin-bottom: 8px;
}
.err-detail-label {
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
}
.err-pre {
  background: #0a0e1a;
  border: 1px solid #223;
  border-radius: 4px;
  padding: 8px;
  font-size: 12px;
  font-family: 'Consolas', monospace;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
.err-stack {
  max-height: 150px;
  color: #ef9a9a;
}
.err-detail-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.err-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.err-page-info {
  font-size: 13px;
  color: #888;
}
.empty-state {
  text-align: center;
  padding: 40px;
  color: #888;
}
</style>
