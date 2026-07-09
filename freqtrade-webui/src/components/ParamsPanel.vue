<template>
  <div class="params-section">
    <div class="panel-title">
      <span>⚙️</span> 策略参数配置
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMessage" class="params-error-message" @click="errorMessage = ''">
      {{ errorMessage }}
    </div>

    <!-- 第一行：交易对选择 -->
    <div class="pair-selection-row">
      <div class="form-group">
        <label>合约类型</label>
        <select v-model="contractType" @change="updatePairList">
          <option value="SPOT">现货 (Spot)</option>
          <option value="SWAP">永续合约 (Perp)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="pair-label">
          <span>选择交易对 <span class="pair-count">({{ visiblePairCount }})</span></span>
          <span class="pair-actions">
            <button class="btn btn-small" @click="openDiscoveryPanel">🔥 发现热门/新币</button>
            <button class="btn btn-small" @click="selectAllPairs">全选</button>
            <button class="btn btn-small" @click="deselectAllPairs">清空</button>
          </span>
        </label>
        <div class="pair-tags-container">
          <input
            v-model="pairSearch"
            type="text"
            placeholder="🔍 搜索币种..."
            class="pair-search"
            @input="filterPairs"
          >
          <div class="pair-tags">
            <span
              v-for="pair in filteredPairs"
              :key="pair.id"
              class="pair-tag"
              :class="{ active: selectedPairs.includes(pair.id) }"
              @click="togglePair(pair.id)"
            >
              {{ pair.name }}
              <span v-if="pair.isNew" class="new-badge">NEW</span>
            </span>
          </div>
        </div>
        <div v-if="showDiscoveryPanel" class="discovery-panel">
          <div class="discovery-header">
            <span>热门/新币发现（{{ contractType === 'SPOT' ? '现货' : '永续' }}）</span>
            <button class="btn btn-small" @click="showDiscoveryPanel = false">✕ 关闭</button>
          </div>
          <div v-if="discoveryError" class="discovery-error">{{ discoveryError }}</div>
          <div v-else-if="discoveryLoading" class="discovery-loading">加载中...</div>
          <div v-else-if="hotPairs" class="discovery-columns">
            <div class="discovery-column">
              <div class="discovery-column-title">成交量榜</div>
              <label v-for="p in hotPairs.byVolume" :key="p.instId" class="discovery-item">
                <input
                  type="checkbox"
                  :checked="checkedHotPairs.has(p.instId)"
                  @change="toggleHotPairCheck(p.instId)"
                >
                {{ p.instId }}
              </label>
            </div>
            <div class="discovery-column">
              <div class="discovery-column-title">涨跌幅榜</div>
              <label v-for="p in hotPairs.byChange" :key="p.instId" class="discovery-item">
                <input
                  type="checkbox"
                  :checked="checkedHotPairs.has(p.instId)"
                  @change="toggleHotPairCheck(p.instId)"
                >
                {{ p.instId }} ({{ (p.change24h * 100).toFixed(1) }}%)
              </label>
            </div>
            <div class="discovery-column">
              <div class="discovery-column-title">最新上币榜</div>
              <label v-for="p in hotPairs.byListTime" :key="p.instId" class="discovery-item">
                <input
                  type="checkbox"
                  :checked="checkedHotPairs.has(p.instId)"
                  @change="toggleHotPairCheck(p.instId)"
                >
                {{ p.instId }}
              </label>
            </div>
          </div>
          <button class="btn btn-small btn-apply" @click="addCheckedHotPairs">加入选择</button>
        </div>
      </div>
    </div>

    <!-- 第二行：时间周期和K线数量 -->
    <div class="params-row">
      <div class="form-group">
        <label>时间周期</label>
        <select v-model="timeframe">
          <option value="1H">1小时 (1H)</option>
          <option value="4H">4小时 (4H)</option>
          <option value="1D">日线 (1D)</option>
        </select>
      </div>
      <div class="form-group">
        <label>K线数量</label>
        <select v-model="limit">
          <option value="300">300 根</option>
          <option value="600">600 根</option>
          <option value="900">900 根</option>
        </select>
      </div>
      <div class="form-group">
        <label>ADX阈值</label>
        <input v-model.number="adxThreshold" type="number" min="10" max="50" step="1">
      </div>
    </div>

    <!-- 第三行：MA参数 -->
    <div class="params-row">
      <div class="form-group">
        <label>快线周期 MA{{ maFast }}</label>
        <input
          v-model.number="maFast"
          type="range"
          min="3"
          max="30"
          step="1"
        >
      </div>
      <div class="form-group">
        <label>慢线周期 MA{{ maSlow }}</label>
        <input
          v-model.number="maSlow"
          type="range"
          min="10"
          max="100"
          step="5"
        >
      </div>
    </div>

    <!-- 第四行：风控参数 -->
    <div class="params-row">
      <div class="form-group">
        <label>止损比例 {{ stopLoss }}%</label>
        <input
          v-model.number="stopLoss"
          type="range"
          min="1"
          max="20"
          step="1"
        >
      </div>
      <div class="form-group">
        <label>止盈比例 {{ takeProfit }}%</label>
        <input
          v-model.number="takeProfit"
          type="range"
          min="5"
          max="100"
          step="5"
        >
      </div>
    </div>

    <!-- 第五行：资金和开关 -->
    <div class="params-row">
      <div class="form-group">
        <label>初始资金 (USDT)</label>
        <input v-model.number="initialCapital" type="number" min="100" step="100">
      </div>
      <div class="form-group">
        <label>单次仓位 (USDT)</label>
        <input v-model.number="stakeAmount" type="number" min="10" step="10">
      </div>
      <div class="form-group checkbox-group">
        <label class="checkbox-label">
          <input v-model="enableShort" type="checkbox">
          <span>允许做空</span>
        </label>
        <label class="checkbox-label">
          <input v-model="multiTimeframe" type="checkbox">
          <span>多周期扫描</span>
        </label>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="buttons-row">
      <button class="btn btn-primary" @click="emitRunBacktest">
        ▶ 运行回测
      </button>
      <button class="btn btn-secondary" @click="emitOptimize">
        🔍 参数优化
      </button>
      <button class="btn btn-secondary" @click="emitScan">
        📊 多品种扫描
      </button>
      <button class="btn btn-secondary" @click="emitValidate">
        ✅ 滑动窗口验证
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDynamicPairs } from '@/composables/useDynamicPairs'
import type { HotPairInfo } from '@/types'

// 交易对列表
const defaultPairs = [
  { id: 'BTC-USDT', name: 'BTC/USDT', type: 'SPOT', isNew: false },
  { id: 'ETH-USDT', name: 'ETH/USDT', type: 'SPOT', isNew: false },
  { id: 'SOL-USDT', name: 'SOL/USDT', type: 'SPOT', isNew: false },
  { id: 'XRP-USDT', name: 'XRP/USDT', type: 'SPOT', isNew: false },
  { id: 'DOGE-USDT', name: 'DOGE/USDT', type: 'SPOT', isNew: false },
  { id: 'ADA-USDT', name: 'ADA/USDT', type: 'SPOT', isNew: false },
  { id: 'AVAX-USDT', name: 'AVAX/USDT', type: 'SPOT', isNew: false },
  { id: 'LINK-USDT', name: 'LINK/USDT', type: 'SPOT', isNew: false },
  { id: 'DOT-USDT', name: 'DOT/USDT', type: 'SPOT', isNew: false },
  { id: 'MATIC-USDT', name: 'MATIC/USDT', type: 'SPOT', isNew: false },
  { id: 'UNI-USDT', name: 'UNI/USDT', type: 'SPOT', isNew: false },
  { id: 'LTC-USDT', name: 'LTC/USDT', type: 'SPOT', isNew: false },
  { id: 'BCH-USDT', name: 'BCH/USDT', type: 'SPOT', isNew: false },
  { id: 'ETC-USDT', name: 'ETC/USDT', type: 'SPOT', isNew: false },
  { id: 'FIL-USDT', name: 'FIL/USDT', type: 'SPOT', isNew: false },
  { id: 'NEAR-USDT', name: 'NEAR/USDT', type: 'SPOT', isNew: false },
  { id: 'APT-USDT', name: 'APT/USDT', type: 'SPOT', isNew: true },
  { id: 'SUI-USDT', name: 'SUI/USDT', type: 'SPOT', isNew: true },
  { id: 'BTC-USDT-SWAP', name: 'BTC/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'ETH-USDT-SWAP', name: 'ETH/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'SOL-USDT-SWAP', name: 'SOL/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'XRP-USDT-SWAP', name: 'XRP/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'DOGE-USDT-SWAP', name: 'DOGE/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'ADA-USDT-SWAP', name: 'ADA/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'AVAX-USDT-SWAP', name: 'AVAX/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'LINK-USDT-SWAP', name: 'LINK/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'DOT-USDT-SWAP', name: 'DOT/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'MATIC-USDT-SWAP', name: 'MATIC/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'UNI-USDT-SWAP', name: 'UNI/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'LTC-USDT-SWAP', name: 'LTC/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'BCH-USDT-SWAP', name: 'BCH/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'ETC-USDT-SWAP', name: 'ETC/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'FIL-USDT-SWAP', name: 'FIL/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'NEAR-USDT-SWAP', name: 'NEAR/USDT 永续', type: 'SWAP', isNew: false },
  { id: 'APT-USDT-SWAP', name: 'APT/USDT 永续', type: 'SWAP', isNew: true },
  { id: 'SUI-USDT-SWAP', name: 'SUI/USDT 永续', type: 'SWAP', isNew: true }
]

// 响应式状态
const contractType = ref('SPOT')
const pairSearch = ref('')
const selectedPairs = ref<string[]>(['BTC-USDT']) // 默认选中 BTC
const timeframe = ref('1H')
const errorMessage = ref('')
const limit = ref('300')
const adxThreshold = ref(5)
const maFast = ref(10)
const maSlow = ref(30)
const stopLoss = ref(5)
const takeProfit = ref(20)
const initialCapital = ref(10000)
const stakeAmount = ref(10000)
const enableShort = ref(true)
const multiTimeframe = ref(false)

const { loading: discoveryLoading, error: discoveryError, fetchHotPairs } = useDynamicPairs()
const showDiscoveryPanel = ref(false)
const hotPairs = ref<{ byVolume: HotPairInfo[]; byChange: HotPairInfo[]; byListTime: HotPairInfo[] } | null>(null)
const checkedHotPairs = ref<Set<string>>(new Set())
// 动态加入的品种，与 defaultPairs 分开维护，渲染时合并展示
const dynamicPairs = ref<Array<{ id: string; name: string; type: string; isNew: boolean }>>([])

async function openDiscoveryPanel() {
  showDiscoveryPanel.value = true
  try {
    hotPairs.value = await fetchHotPairs(contractType.value as 'SPOT' | 'SWAP')
  } catch {
    // discoveryError 已经在 composable 内部设置，面板会显示提示
  }
}

function toggleHotPairCheck(instId: string) {
  if (checkedHotPairs.value.has(instId)) {
    checkedHotPairs.value.delete(instId)
  } else {
    checkedHotPairs.value.add(instId)
  }
}

function addCheckedHotPairs() {
  for (const instId of checkedHotPairs.value) {
    if (!selectedPairs.value.includes(instId)) {
      selectedPairs.value.push(instId)
    }
    if (!dynamicPairs.value.some(p => p.id === instId) && !defaultPairs.some(p => p.id === instId)) {
      dynamicPairs.value.push({
        id: instId,
        name: instId.replace('-USDT-SWAP', '/USDT 永续').replace('-USDT', '/USDT'),
        type: contractType.value,
        isNew: false
      })
    }
  }
  checkedHotPairs.value.clear()
  showDiscoveryPanel.value = false
}

// 计算属性
const filteredPairs = computed(() => {
  return [...defaultPairs, ...dynamicPairs.value].filter(pair => {
    if (pair.type !== contractType.value) return false
    if (!pairSearch.value) return true
    return pair.name.toLowerCase().includes(pairSearch.value.toLowerCase())
  })
})

const visiblePairCount = computed(() => filteredPairs.value.length)

// 方法
function updatePairList() {
  // 切换合约类型时清空选择
  selectedPairs.value = []
}

function filterPairs() {
  // 搜索时自动过滤
}

function togglePair(pairId: string) {
  const index = selectedPairs.value.indexOf(pairId)
  if (index > -1) {
    selectedPairs.value.splice(index, 1)
  } else {
    selectedPairs.value.push(pairId)
  }
}

function selectAllPairs() {
  selectedPairs.value = filteredPairs.value.map(p => p.id)
}

function deselectAllPairs() {
  selectedPairs.value = []
}

// 事件发射
const emit = defineEmits<{
  runBacktest: [config: BacktestConfig]
  optimize: [config: BacktestConfig]
  scan: [config: BacktestConfig]
  validate: [config: BacktestConfig]
}>()

export interface BacktestConfig {
  selectedPairs: string[]
  timeframe: string
  limit: string
  adxThreshold: number
  maFast: number
  maSlow: number
  stopLoss: number
  takeProfit: number
  initialCapital: number
  stakeAmount: number
  enableShort: boolean
  multiTimeframe: boolean
}

function getConfig(): BacktestConfig {
  return {
    selectedPairs: selectedPairs.value,
    timeframe: timeframe.value,
    limit: limit.value,
    adxThreshold: adxThreshold.value,
    maFast: maFast.value,
    maSlow: maSlow.value,
    stopLoss: stopLoss.value,
    takeProfit: takeProfit.value,
    initialCapital: initialCapital.value,
    stakeAmount: stakeAmount.value,
    enableShort: enableShort.value,
    multiTimeframe: multiTimeframe.value
  }
}

function showError(msg: string) {
  errorMessage.value = msg
  setTimeout(() => {
    errorMessage.value = ''
  }, 5000)
}

function emitRunBacktest() {
  if (selectedPairs.value.length === 0) {
    showError('请至少选择一个交易对')
    return
  }
  emit('runBacktest', getConfig())
}

function emitOptimize() {
  if (selectedPairs.value.length === 0) {
    showError('请至少选择一个交易对')
    return
  }
  emit('optimize', getConfig())
}

function emitScan() {
  if (selectedPairs.value.length === 0) {
    showError('请至少选择一个交易对')
    return
  }
  emit('scan', getConfig())
}

function emitValidate() {
  if (selectedPairs.value.length === 0) {
    showError('请至少选择一个交易对')
    return
  }
  emit('validate', getConfig())
}

// 暴露方法给父组件
defineExpose({
  getConfig,
  selectedPairs
})
</script>

<style scoped>
.params-section {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid var(--border-color);
}

/* 错误提示 */
.params-error-message {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  color: #ef4444;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s;
}

.params-error-message:hover {
  background: rgba(239, 68, 68, 0.2);
}

.panel-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent-gold);
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 8px;
}

.pair-selection-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.pair-selection-row .form-group:first-child {
  min-width: 150px;
  flex: 0 0 auto;
}

.pair-selection-row .form-group:last-child {
  flex: 1;
}

.pair-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pair-count {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.pair-actions {
  display: flex;
  gap: 8px;
}

.pair-search {
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.85rem;
  margin-bottom: 8px;
}

.pair-tags-container {
  max-height: 120px;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.pair-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pair-tag {
  padding: 6px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.3s;
  font-family: 'Space Mono', monospace;
  display: flex;
  align-items: center;
  gap: 4px;
}

.pair-tag:hover {
  border-color: var(--accent-blue);
}

.pair-tag.active {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
}

.new-badge {
  display: inline-block;
  padding: 1px 5px;
  background: var(--accent-red);
  color: #fff;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
}

.discovery-panel {
  margin-top: 10px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.discovery-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 0.85rem;
  color: var(--text-primary);
}

.discovery-error {
  color: var(--accent-red, #ef4444);
  font-size: 0.85rem;
}

.discovery-loading {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.discovery-columns {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.discovery-column {
  flex: 1;
  min-width: 160px;
  max-height: 180px;
  overflow-y: auto;
}

.discovery-column-title {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
  text-transform: uppercase;
}

.discovery-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  padding: 3px 0;
  cursor: pointer;
}

.params-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  align-items: flex-end;
  margin-bottom: 16px;
}

.params-row .form-group {
  flex: 1;
  min-width: 150px;
  max-width: 200px;
}

.form-group {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-bottom: 6px;
  font-family: 'Space Mono', monospace;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
  transition: all 0.3s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group input[type="range"] {
  padding: 5px 0;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
}

.buttons-row {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
  margin-top: 20px;
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s;
  font-family: 'Noto Serif SC', serif;
  letter-spacing: 1px;
}

.btn-small {
  padding: 4px 10px;
  font-size: 0.7rem;
  width: auto;
}

.btn-primary {
  background: linear-gradient(135deg, var(--accent-gold), #d97706);
  color: #fff;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(245, 158, 11, 0.3);
}

.btn-secondary {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-secondary:hover {
  border-color: var(--accent-blue);
}

@media (max-width: 768px) {
  .params-row {
    flex-direction: column;
    align-items: stretch;
  }
  .params-row .form-group {
    max-width: none;
  }
  .pair-selection-row {
    flex-direction: column;
  }
  .buttons-row {
    flex-wrap: wrap;
  }
  .buttons-row .btn {
    flex: 1;
    min-width: 120px;
  }
}
</style>
