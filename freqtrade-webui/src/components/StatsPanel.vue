<template>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">总收益率</div>
      <div class="stat-value" :class="getProfitClass(stats.totalReturn)">
        {{ formatPercent(stats.totalReturn) }}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">交易次数</div>
      <div class="stat-value neutral">{{ stats.trades }}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">胜率</div>
      <div class="stat-value neutral">{{ formatPercent(stats.winRate) }}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">最大回撤</div>
      <div class="stat-value negative">-{{ formatPercent(stats.maxDrawdown) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Stats {
  totalReturn: number
  trades: number
  winRate: number
  maxDrawdown: number
}

const props = defineProps<{
  stats: Stats
}>()

function getProfitClass(value: number): string {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

function formatPercent(value: number): string {
  if (value === undefined || value === null) return '--'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(2)}%`
}
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid var(--border-color);
  transition: all 0.3s;
}

.stat-card:hover {
  border-color: var(--accent-blue);
  transform: translateY(-2px);
}

.stat-label {
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-family: 'Space Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  margin-top: 8px;
  font-family: 'Space Mono', monospace;
}

.stat-value.positive {
  color: var(--accent-green);
}

.stat-value.negative {
  color: var(--accent-red);
}

.stat-value.neutral {
  color: var(--accent-blue);
}

@media (max-width: 1200px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
