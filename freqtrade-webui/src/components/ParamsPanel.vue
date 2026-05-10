<template>
  <div class="params-panel">
    <!-- Section: Market Selection -->
    <div class="panel-section">
      <div class="section-header">
        <div class="section-icon market">
          <el-icon :size="16"><Coin /></el-icon>
        </div>
        <h3>市场选择</h3>
      </div>

      <div class="section-body">
        <div class="form-row">
          <div class="form-group">
            <label>合约类型</label>
            <el-radio-group v-model="store.contractType" @change="onContractTypeChange" size="small">
              <el-radio-button label="SPOT">现货</el-radio-button>
              <el-radio-button label="SWAP">永续合约</el-radio-button>
            </el-radio-group>
          </div>

          <div class="form-group">
            <label>数据周期</label>
            <el-select v-model="store.timeframe" size="small">
              <el-option label="1小时 (1H)" value="1H" />
              <el-option label="4小时 (4H)" value="4H" />
              <el-option label="1天 (1D)" value="1D" />
              <el-option label="15分钟 (15m)" value="15m" />
            </el-select>
          </div>

          <div class="form-group">
            <label>获取条数</label>
            <el-select v-model="store.limit" size="small">
              <el-option label="100 条" value="100" />
              <el-option label="300 条" value="300" />
              <el-option label="500 条" value="500" />
              <el-option label="1000 条" value="1000" />
            </el-select>
          </div>
        </div>

        <div class="pair-section">
          <div class="pair-toolbar">
            <span class="pair-count">交易对 ({{ store.selectedPairs.length }}/{{ filteredPairs.length }})</span>
            <div class="pair-actions">
              <el-button size="small" text @click="store.selectAllPairs">全选</el-button>
              <el-button size="small" text @click="store.deselectAllPairs">清空</el-button>
            </div>
          </div>
          <el-input
            v-model="pairSearch"
            placeholder="搜索币种..."
            prefix-icon="Search"
            size="small"
            class="pair-search"
            clearable
          />
          <div class="pair-tags">
            <el-check-tag
              v-for="pair in filteredPairs"
              :key="pair.symbol"
              :checked="store.selectedPairs.includes(getPairId(pair))"
              @change="store.togglePair(getPairId(pair))"
              class="pair-tag"
              :class="{ 'is-new': pair.isNew, active: store.selectedPairs.includes(getPairId(pair)) }"
            >
              {{ pair.name }}
              <el-tag v-if="pair.isNew" size="small" type="danger" effect="dark" class="new-badge">NEW</el-tag>
            </el-check-tag>
          </div>

          <!-- Custom Pairs -->
          <div class="custom-pair-section">
            <el-input
              v-model="customPairInput"
              placeholder="输入币种，如: TRUMP"
              size="small"
              @keyup.enter="addCustomPair"
              class="custom-input"
            >
              <template #append>
                <el-button @click="addCustomPair" :icon="Plus" />
              </template>
            </el-input>
            <div v-if="customPairsList.length > 0" class="custom-pair-tags">
              <el-check-tag
                v-for="pair in customPairsList"
                :key="pair.symbol"
                :checked="store.selectedPairs.includes(getPairId(pair))"
                @change="store.togglePair(getPairId(pair))"
                class="pair-tag custom-tag"
                :class="{ active: store.selectedPairs.includes(getPairId(pair)) }"
              >
                {{ pair.name }}
                <el-icon class="remove-icon" @click.stop="store.removeCustomPair(pair.symbol)"><Close /></el-icon>
              </el-check-tag>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Section: Strategy Parameters -->
    <div class="panel-section">
      <div class="section-header">
        <div class="section-icon strategy">
          <el-icon :size="16"><Aim /></el-icon>
        </div>
        <h3>策略参数</h3>
      </div>

      <div class="section-body">
        <div class="slider-row">
          <div class="slider-group">
            <div class="slider-label">
              <span>快线周期</span>
              <span class="slider-value">{{ store.backtestParams.maFast }}</span>
            </div>
            <el-slider v-model="store.backtestParams.maFast" :min="5" :max="50" :step="1" show-stops />
          </div>
          <div class="slider-group">
            <div class="slider-label">
              <span>慢线周期</span>
              <span class="slider-value">{{ store.backtestParams.maSlow }}</span>
            </div>
            <el-slider v-model="store.backtestParams.maSlow" :min="10" :max="100" :step="1" show-stops />
          </div>
          <div class="slider-group">
            <div class="slider-label">
              <span>ADX 阈值</span>
              <span class="slider-value">{{ store.backtestParams.adxThreshold }}</span>
            </div>
            <el-slider v-model="store.backtestParams.adxThreshold" :min="0" :max="50" :step="1" />
            <div class="slider-hint">设为 0 关闭 ADX 过滤</div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group compact">
            <label>止损 (%)</label>
            <el-input-number v-model="stopLossPercent" :min="1" :max="50" :step="1" size="small" controls-position="right" />
          </div>
          <div class="form-group compact">
            <label>止盈 (%)</label>
            <el-input-number v-model="takeProfitPercent" :min="1" :max="100" :step="1" size="small" controls-position="right" />
          </div>
          <div class="form-group compact">
            <label>做空</label>
            <el-switch v-model="store.backtestParams.enableShort" active-text="开启" inactive-text="关闭" />
          </div>
          <div class="form-group compact">
            <label>多周期</label>
            <el-switch v-model="store.multiTimeframe" active-text="开启" inactive-text="关闭" />
          </div>
        </div>
      </div>
    </div>

    <!-- Section: Capital Settings -->
    <div class="panel-section">
      <div class="section-header">
        <div class="section-icon capital">
          <el-icon :size="16"><Wallet /></el-icon>
        </div>
        <h3>资金配置</h3>
      </div>

      <div class="section-body">
        <div class="form-row">
          <div class="form-group compact">
            <label>初始资金 (USDT)</label>
            <el-input-number v-model="store.backtestParams.initialCapital" :min="100" :step="100" size="small" controls-position="right" />
          </div>
          <div class="form-group compact">
            <label>单次仓位 (USDT)</label>
            <el-input-number v-model="store.backtestParams.stakeAmount" :min="10" :step="10" size="small" controls-position="right" />
          </div>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-bar">
      <el-button type="primary" size="large" class="action-btn primary" @click="store.runBacktestAction">
        <el-icon :size="18"><VideoPlay /></el-icon>
        <span>运行回测</span>
      </el-button>
      <el-button size="large" class="action-btn" @click="refreshData">
        <el-icon :size="16"><Refresh /></el-icon>
        <span>刷新数据</span>
      </el-button>
      <el-button type="warning" size="large" class="action-btn" @click="store.optimizeParameters">
        <el-icon :size="16"><Aim /></el-icon>
        <span>参数优化</span>
      </el-button>
      <el-button type="danger" size="large" class="action-btn" @click="store.scanMultiplePairs">
        <el-icon :size="16"><Search /></el-icon>
        <span>多品种扫描</span>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBacktestStore } from '@/stores/backtest'
import type { PairConfig } from '@/types'
import { Coin, Aim, Wallet, VideoPlay, Refresh, Search, Close, Plus } from '@element-plus/icons-vue'

const store = useBacktestStore()
store.loadCustomPairs()

const pairSearch = ref('')
const customPairInput = ref('')

const stopLossPercent = computed({
  get: () => Math.round(store.backtestParams.stopLoss * 100),
  set: (v) => { store.backtestParams.stopLoss = v / 100 }
})

const takeProfitPercent = computed({
  get: () => Math.round(store.backtestParams.takeProfit * 100),
  set: (v) => { store.backtestParams.takeProfit = v / 100 }
})

const filteredPairs = computed(() => {
  const search = pairSearch.value.toLowerCase()
  return store.availablePairs.filter(p =>
    !p.isCustom && p.name.toLowerCase().includes(search)
  )
})

const customPairsList = computed(() => {
  return store.availablePairs.filter(p => p.isCustom)
})

function getPairId(pair: PairConfig) {
  const suffix = pair.type === 'SWAP' ? '-USDT-SWAP' : '-USDT'
  return `${pair.symbol}${suffix}`
}

function onContractTypeChange() {
  store.selectedPairs = []
}

function addCustomPair() {
  if (store.addCustomPair(customPairInput.value)) {
    customPairInput.value = ''
  }
}

async function refreshData() {
  if (store.activePair) {
    await store.loadData(store.activePair, true)
    await store.runBacktestAction()
  }
}
</script>

<style scoped lang="scss">
.params-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.panel-section {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: all var(--transition-base);

  &:hover {
    border-color: var(--border-medium);
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-light);

  .section-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;

    &.market {
      background: var(--gradient-blue);
    }

    &.strategy {
      background: var(--gradient-gold);
    }

    &.capital {
      background: var(--gradient-green);
    }
  }

  h3 {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }
}

.section-body {
  padding: 20px;
}

.form-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;

  &:not(:last-child) {
    margin-bottom: 16px;
  }
}

.form-group {
  flex: 1;
  min-width: 160px;

  &.compact {
    flex: 0 0 auto;
    min-width: 140px;
  }

  label {
    display: block;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
    font-family: 'JetBrains Mono', monospace;
  }
}

/* Pair Section */
.pair-section {
  margin-top: 8px;
}

.pair-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;

  .pair-count {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-secondary);
    font-family: 'JetBrains Mono', monospace;
  }

  .pair-actions {
    display: flex;
    gap: 4px;
  }
}

.pair-search {
  margin-bottom: 10px;
}

.pair-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
}

.pair-tag {
  font-size: 0.8rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  border: 1px solid transparent;

  &:hover {
    transform: translateY(-1px);
  }

  &.active {
    background: var(--accent-blue-dim);
    border-color: var(--accent-blue);
    color: var(--accent-blue);
  }

  &.is-new {
    border-color: var(--accent-red);
    color: var(--accent-red);

    &.active {
      background: var(--accent-red-dim);
    }
  }
}

.new-badge {
  margin-left: 4px;
  font-size: 0.55rem;
  padding: 0 4px;
  height: 14px;
  line-height: 14px;
}

.custom-pair-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-light);
}

.custom-input {
  max-width: 280px;
}

.custom-pair-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.custom-tag {
  background: var(--accent-purple-dim);
  border-color: var(--accent-purple);
  color: var(--accent-purple);
}

.remove-icon {
  margin-left: 6px;
  cursor: pointer;
  opacity: 0.6;
  transition: all var(--transition-fast);

  &:hover {
    opacity: 1;
    color: var(--accent-red);
    transform: scale(1.1);
  }
}

/* Sliders */
.slider-row {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;

  .slider-group {
    flex: 1;
  }
}

.slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;

  span {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: 'JetBrains Mono', monospace;
  }

  .slider-value {
    color: var(--accent-gold);
    font-size: 0.85rem;
    font-weight: 700;
    background: var(--accent-gold-dim);
    padding: 2px 10px;
    border-radius: 100px;
  }
}

.slider-hint {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 4px;
  font-family: 'JetBrains Mono', monospace;
}

/* Action Bar */
.action-bar {
  display: flex;
  gap: 10px;
  justify-content: center;
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);

  .action-btn {
    min-width: 130px;
    font-weight: 700;
    letter-spacing: 0.01em;
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);

    &.primary {
      background: var(--gradient-blue);
      border: none;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.45);
      }
    }

    &:not(.primary):hover {
      transform: translateY(-2px);
    }

    span {
      margin-left: 6px;
    }
  }
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-switch__label) {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary);
}
</style>
