<template>
  <div class="table-card">
    <div class="table-header">
      <div class="table-icon">
        <el-icon :size="16"><Document /></el-icon>
      </div>
      <div class="table-title">
        <h3>交易记录</h3>
        <span class="table-subtitle">Trade History</span>
      </div>
      <div v-if="trades.length > 0" class="table-count">{{ trades.length }} 笔</div>
    </div>
    <el-table
      :data="trades"
      style="width: 100%"
      :empty-text="emptyText || '暂无交易记录'"
      class="trades-table"
      size="small"
    >
      <el-table-column type="index" label="#" width="50" align="center" />
      <el-table-column label="方向" width="70" align="center">
        <template #default="{ row }">
          <span class="direction-badge" :class="row.direction">
            {{ row.direction === 'long' ? '多' : '空' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="开仓" min-width="140">
        <template #default="{ row }">
          <div class="time-cell">
            <span class="time-date">{{ formatDate(row.entryTime) }}</span>
            <span class="time-price">{{ row.entryPrice.toFixed(4) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="平仓" min-width="140">
        <template #default="{ row }">
          <div class="time-cell">
            <span class="time-date">{{ formatDate(row.exitTime) }}</span>
            <span class="time-price">{{ row.exitPrice.toFixed(4) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="收益" width="90" align="right">
        <template #default="{ row }">
          <span class="pnl-badge" :class="row.pnl >= 0 ? 'positive' : 'negative'">
            {{ row.pnl >= 0 ? '+' : '' }}{{ (row.pnl * 100).toFixed(2) }}%
          </span>
        </template>
      </el-table-column>
      <el-table-column label="时长" width="70" align="right">
        <template #default="{ row }">
          <span class="duration">{{ formatDuration(row.entryTime, row.exitTime) }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import type { Trade } from '@/types'
import { Document } from '@element-plus/icons-vue'

defineProps<{
  trades: Trade[]
  emptyText?: string
}>()

function formatDate(time: string) {
  const d = new Date(time)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(entry: string, exit: string) {
  const hours = Math.round((new Date(exit).getTime() - new Date(entry).getTime()) / 3600000)
  if (hours < 1) return '<1h'
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
</script>

<style scoped lang="scss">
.table-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: all var(--transition-base);

  &:hover {
    border-color: var(--border-medium);
  }
}

.table-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-light);

  .table-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--gradient-purple);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .table-title {
    flex: 1;

    h3 {
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      line-height: 1.2;
    }

    .table-subtitle {
      font-size: 0.68rem;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
  }

  .table-count {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-tertiary);
    background: var(--bg-elevated);
    padding: 4px 10px;
    border-radius: 100px;
    font-family: 'JetBrains Mono', monospace;
  }
}

.trades-table {
  :deep(.el-table__header-wrapper) {
    th {
      background: var(--bg-tertiary) !important;
      color: var(--text-tertiary) !important;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 10px 8px !important;
      border-bottom: 1px solid var(--border-light) !important;
    }
  }

  :deep(.el-table__row) {
    background: transparent !important;
    transition: background var(--transition-fast);

    &:hover {
      background: var(--bg-hover) !important;
    }

    td {
      color: var(--text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      padding: 10px 8px !important;
      border-bottom: 1px solid var(--border-subtle) !important;
    }
  }

  :deep(.el-table__empty-block) {
    background: transparent;
    padding: 40px 0;
  }
}

.direction-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
  font-weight: 800;
  font-family: 'JetBrains Mono', monospace;

  &.long {
    background: var(--accent-green-dim);
    color: var(--accent-green);
  }

  &.short {
    background: var(--accent-red-dim);
    color: var(--accent-red);
  }
}

.time-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;

  .time-date {
    font-size: 0.72rem;
    color: var(--text-secondary);
  }

  .time-price {
    font-size: 0.78rem;
    color: var(--text-primary);
    font-weight: 600;
  }
}

.pnl-badge {
  font-size: 0.82rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;

  &.positive {
    color: var(--accent-green);
  }

  &.negative {
    color: var(--accent-red);
  }
}

.duration {
  font-size: 0.72rem;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
}
</style>
