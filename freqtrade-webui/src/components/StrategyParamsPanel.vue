<template>
  <div class="params-panel">
    <div v-if="!ind" class="params-empty">
      暂无策略参数，任务运行一次后显示
    </div>
    <template v-else>
      <div class="params-stale">
        取自 {{ lastRun ? formatTime(lastRun) : '未知时间' }}
        <span class="params-stale-hint">（下一轮 {{ interval }} 扫描时刷新）</span>
      </div>
      <div class="params-grid">
        <div v-for="row in rows" :key="row.label" class="params-row" :class="{ highlight: row.highlight }">
          <span class="params-label">{{ row.label }}</span>
          <span class="params-value mono" :class="row.tone">{{ row.value }}</span>
        </div>
      </div>
      <div v-if="extraLevels.length" class="params-levels">
        <div class="params-levels-title">持仓层</div>
        <table class="params-levels-table">
          <thead>
            <tr><th>层</th><th>成交价</th><th>止盈价</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in extraLevels" :key="l.level">
              <td class="mono">L{{ l.level }}</td>
              <td class="mono">{{ formatPrice(l.price) }}</td>
              <td class="mono">{{ formatPrice(l.tpPrice) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PositionIndicators } from '../types'
import { formatPrice, formatTime } from '../utils/planFormat'

const props = defineProps<{
  indicators?: PositionIndicators
  lastRun?: number
  interval: string
}>()

interface Row {
  label: string
  value: string
  tone?: 'profit' | 'loss'
  highlight?: boolean
}

const num = (v: number | undefined, digits = 6): string =>
  v === undefined || !isFinite(v) ? '--' : v.toFixed(digits)

const CROSS_LABEL: Record<string, string> = { golden: '金叉 ↑', dead: '死叉 ↓', none: '无交叉' }

const ind = computed(() => props.indicators)

const rows = computed<Row[]>(() => {
  const i = props.indicators
  if (!i) return []
  switch (i.kind) {
    case 'ma_cross':
      return [
        { label: '收盘价', value: num(i.close) },
        { label: '快线', value: num(i.fast) },
        { label: '慢线', value: num(i.slow) },
        { label: '上一根 快/慢', value: `${num(i.fastPrev)} / ${num(i.slowPrev)}` },
        { label: '交叉状态', value: CROSS_LABEL[i.cross] ?? i.cross, highlight: i.cross !== 'none' },
        { label: `ADX (阈值 ${i.adxThreshold})`, value: num(i.adx, 2), tone: i.adx >= i.adxThreshold ? 'profit' : 'loss' },
        { label: 'ATR(14)', value: num(i.atr) },
        { label: '止损价', value: num(i.stopPrice) },
        { label: '止盈 TP1', value: num(i.takeProfit1), tone: 'profit' },
        { label: '止盈 TP2', value: num(i.takeProfit2), tone: 'profit' },
      ]
    case 'turtle':
      return [
        { label: '收盘价', value: num(i.close) },
        { label: '入场通道', value: `${num(i.entryLow)} ~ ${num(i.entryHigh)}` },
        { label: '离场通道', value: `${num(i.exitLow)} ~ ${num(i.exitHigh)}` },
        { label: 'ATR', value: num(i.atr) },
        { label: '单位间距', value: num(i.unitStep) },
        { label: '上一单位价', value: num(i.lastUnitPrice) },
        { label: '下一加仓触发价', value: num(i.nextAddPrice), highlight: i.nextAddPrice !== undefined },
        { label: '止损价', value: num(i.stopPrice) },
        { label: '单位数', value: `${i.unitsUsed} / ${i.maxUnits}` },
      ]
    case 'bollinger':
      return [
        { label: '收盘价', value: num(i.close) },
        { label: '上轨', value: num(i.upper) },
        { label: '中轨', value: num(i.middle) },
        { label: '下轨 (入场触发)', value: num(i.lower), highlight: true },
        { label: '带宽', value: `${(i.bandwidth * 100).toFixed(2)}%` },
        { label: 'ATR(14)', value: num(i.atr) },
        { label: '止损价', value: num(i.stopPrice) },
      ]
    case 'grid':
      return [
        { label: '当前价', value: num(i.close) },
        { label: '上一根收盘', value: num(i.prevClose) },
        { label: `下界 (20% 分位, 回看 ${i.lookback})`, value: num(i.lower) },
        { label: '上界 (80% 分位)', value: num(i.upper) },
        { label: '层间距', value: num(i.step) },
        { label: '网格数', value: String(i.gridCount) },
        {
          label: `下一触发层 L${i.nextLevel ?? '--'}`,
          value: num(i.nextLevelPrice),
          highlight: i.nextLevelPrice !== undefined,
        },
      ]
    case 'pivot':
      return [
        { label: '收盘价', value: num(i.close) },
        { label: 'PP', value: num(i.pp) },
        { label: 'S1 / S2', value: `${num(i.s1)} / ${num(i.s2)}` },
        { label: 'R1 / R2', value: `${num(i.r1)} / ${num(i.r2)}` },
        { label: '触及阈值', value: `${i.thresholdPct}%` },
        { label: '止损', value: `${i.stopPct}%` },
        { label: '持仓止损价', value: num(i.stopPrice) },
        { label: '持仓止盈价', value: num(i.takeProfitPrice), tone: 'profit' },
      ]
    default:
      return []
  }
})

const extraLevels = computed(() =>
  props.indicators?.kind === 'grid' ? props.indicators.levels : [],
)
</script>

<style scoped>
.params-panel {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.params-empty {
  font-size: 0.78rem;
  color: var(--text-secondary);
  text-align: center;
  padding: 8px 0;
}

.params-stale {
  font-size: 0.7rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.params-stale-hint {
  opacity: 0.75;
}

.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 4px 14px;
}

.params-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px;
  border-radius: 4px;
}

.params-row.highlight {
  background: rgba(59, 130, 246, 0.12);
}

.params-label {
  font-size: 0.72rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.params-value {
  font-family: 'Space Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-primary);
  text-align: right;
}

.params-value.profit { color: var(--accent-green); }
.params-value.loss { color: var(--accent-red); }

.params-levels {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed rgba(148, 163, 184, 0.15);
}

.params-levels-title {
  font-size: 0.72rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.params-levels-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.params-levels-table th {
  text-align: left;
  padding: 2px 8px 2px 0;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.7rem;
}

.params-levels-table td {
  padding: 2px 8px 2px 0;
  color: var(--text-primary);
}

.mono {
  font-family: 'Space Mono', monospace;
}
</style>
