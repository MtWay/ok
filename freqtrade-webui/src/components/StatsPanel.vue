<template>
  <div class="stats-grid">
    <div class="stat-card" :class="{ 'has-data': result }">
      <div class="stat-icon profit">
        <el-icon :size="20"><TrendCharts /></el-icon>
      </div>
      <div class="stat-content">
        <div class="stat-label">总收益率</div>
        <div class="stat-value" :class="valueClass(result?.totalReturn)">
          {{ result ? formatPercent(result.totalReturn) : '--' }}
        </div>
        <div class="stat-bar">
          <div
            class="stat-bar-fill"
            :class="valueClass(result?.totalReturn)"
            :style="{ width: result ? barWidth(result.totalReturn) : '0%' }"
          />
        </div>
      </div>
    </div>

    <div class="stat-card" :class="{ 'has-data': result }">
      <div class="stat-icon trades">
        <el-icon :size="20"><Switch /></el-icon>
      </div>
      <div class="stat-content">
        <div class="stat-label">交易次数</div>
        <div class="stat-value neutral">
          {{ result ? result.trades.length : '--' }}
        </div>
        <div v-if="result && breakdown" class="stat-breakdown">
          <span class="positive">多 {{ breakdown.long }}</span>
          <span class="divider">/</span>
          <span class="negative">空 {{ breakdown.short }}</span>
        </div>
      </div>
    </div>

    <div class="stat-card" :class="{ 'has-data': result }">
      <div class="stat-icon winrate">
        <el-icon :size="20"><CircleCheck /></el-icon>
      </div>
      <div class="stat-content">
        <div class="stat-label">胜率</div>
        <div class="stat-value neutral">
          {{ result ? formatPercent(result.winRate) : '--' }}
        </div>
        <div class="stat-bar">
          <div
            class="stat-bar-fill neutral"
            :style="{ width: result ? `${result.winRate}%` : '0%' }"
          />
        </div>
      </div>
    </div>

    <div class="stat-card" :class="{ 'has-data': result }">
      <div class="stat-icon drawdown">
        <el-icon :size="20"><ArrowDown /></el-icon>
      </div>
      <div class="stat-content">
        <div class="stat-label">最大回撤</div>
        <div class="stat-value negative">
          {{ result ? `-${result.maxDrawdown.toFixed(2)}%` : '--' }}
        </div>
        <div class="stat-bar">
          <div
            class="stat-bar-fill negative"
            :style="{ width: result ? barWidth(-result.maxDrawdown) : '0%' }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { BacktestResult } from '@/types'
import { TrendCharts, Switch, CircleCheck, ArrowDown } from '@element-plus/icons-vue'

const props = defineProps<{
  result: BacktestResult | null
}>()

const breakdown = computed(() => {
  if (!props.result) return null
  const long = props.result.trades.filter(t => t.direction === 'long').length
  const short = props.result.trades.filter(t => t.direction === 'short').length
  return { long, short }
})

function valueClass(val: number | undefined) {
  if (val === undefined) return 'neutral'
  return val >= 0 ? 'positive' : 'negative'
}

function formatPercent(val: number) {
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

function barWidth(val: number) {
  const abs = Math.abs(val)
  return `${Math.min(abs * 3, 100)}%`
}
</script>

<style scoped lang="scss">
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  transition: all var(--transition-base);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--gradient-blue);
    opacity: 0;
    transition: opacity var(--transition-base);
  }

  &:hover {
    border-color: var(--border-medium);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);

    &::before {
      opacity: 1;
    }
  }

  &.has-data:hover::before {
    opacity: 1;
  }
}

.stat-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.profit {
    background: var(--accent-green-dim);
    color: var(--accent-green);
  }

  &.trades {
    background: var(--accent-blue-dim);
    color: var(--accent-blue);
  }

  &.winrate {
    background: var(--accent-gold-dim);
    color: var(--accent-gold);
  }

  &.drawdown {
    background: var(--accent-red-dim);
    color: var(--accent-red);
  }
}

.stat-content {
  flex: 1;
  min-width: 0;
}

.stat-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 6px;
}

.stat-value {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-family: 'JetBrains Mono', monospace;

  &.positive {
    color: var(--accent-green);
    text-shadow: 0 0 20px rgba(34, 197, 94, 0.2);
  }

  &.negative {
    color: var(--accent-red);
    text-shadow: 0 0 20px rgba(239, 68, 68, 0.2);
  }

  &.neutral {
    color: var(--text-primary);
  }
}

.stat-bar {
  height: 3px;
  background: var(--bg-elevated);
  border-radius: 2px;
  margin-top: 10px;
  overflow: hidden;
}

.stat-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);

  &.positive {
    background: var(--gradient-green);
  }

  &.negative {
    background: var(--gradient-red);
  }

  &.neutral {
    background: var(--gradient-blue);
  }
}

.stat-breakdown {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 0.72rem;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;

  .positive {
    color: var(--accent-green);
  }

  .negative {
    color: var(--accent-red);
  }

  .divider {
    color: var(--text-muted);
  }
}

@media (max-width: 1200px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
