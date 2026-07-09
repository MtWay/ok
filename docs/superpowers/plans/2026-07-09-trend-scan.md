# Trend Scan + Dynamic Pair Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trend-quality scanning board (0-100 score, direction, swing-based stop-loss/take-profit) that ranks user-selected symbols by "how clean/stable is the current trend" without any historical-return parameter optimization, plus a general-purpose dynamic hot/new-pair discovery entry usable from any tab.

**Architecture:** Two independent composables sit alongside the existing `useBacktest.ts`/`useDataFetch.ts`: `useTrendScore.ts` (pure scoring functions, borrows only `calculateMA`/`calculateADX` from `useBacktest.ts`, never touches `runBacktestWithParams`) and `useDynamicPairs.ts` (pure OKX ticker/instrument fetch + sort, no scoring). A new `TrendScanTab.vue` is cloned from the existing `ScanTab.vue` layout/sort/filter framework but renders `TrendScanResult[]` instead of `ScanResult[]` — the existing "多品种扫描" button/tab/`ScanTab.vue`/`ScanResult` type are left completely untouched so no existing functionality regresses. `ParamsPanel.vue` gains two additions: a "🔥 发现热门/新币" panel (usable regardless of which scan/backtest button is eventually clicked) and a "📈 趋势扫描" button next to the existing "📊 多品种扫描" button.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, TypeScript, native `fetch` against OKX public REST API, no new dependencies.

## Global Constraints

- No historical-return parameter optimization anywhere in the new code path — `useTrendScore.ts` must never import `runBacktestWithParams` (spec: 关键边界).
- OHLCV row format is `[open, close, low, high, volume]` as strings — index 1 is close, index 2 is low, index 3 is high (per `CLAUDE.md` gotcha). All new indicator math must follow this indexing.
- No new "历史收益/胜率/回撤" fields anywhere in `TrendScanResult` or `TrendScanTab.vue` — these must not be faked or left blank, they must simply not exist on the type (spec: 范围, UI 改动).
- Minimum 100 candles required to compute a trend score; below that, mark the result as insufficient data rather than emitting an unreliable score (spec: 错误处理).
- Dynamic pair discovery has no mock-data fallback — on fetch failure, show "获取失败，请重试" in the panel only, and must not affect any other tab (spec: 动态品种发现, 刷新方式).
- No test framework is configured in this repo (`package.json` has no vitest/jest) — introducing one is out of scope. Verification in this plan uses `npx vue-tsc --noEmit` for type-safety checks after each task plus manual `yarn dev` smoke checks, matching the spec's own "测试策略" section.
- All new UI copy must avoid "历史胜率" phrasing (spec: 趋势质量评分算法).

---

## Part A: Dynamic Pair Discovery (general-purpose, do first — no dependency on Part B)

### Task 1: Add hot-pair types

**Files:**
- Modify: `freqtrade-webui/src/types/index.ts`

**Interfaces:**
- Produces: `HotPairInfo`, `HotPairsResult` types consumed by Task 2 (`useDynamicPairs.ts`) and Task 3 (`ParamsPanel.vue`).

- [ ] **Step 1: Append the new types to `types/index.ts`**

Add at the end of the file:

```ts
export interface HotPairInfo {
  instId: string
  last: number
  open24h: number
  change24h: number
  volCcy24h: number
  listTime: number
}

export interface HotPairsResult {
  byVolume: HotPairInfo[]
  byChange: HotPairInfo[]
  byListTime: HotPairInfo[]
}
```

- [ ] **Step 2: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors (existing baseline errors, if any, are unaffected by an additive type-only change — if the command fails before this task, run it once before Task 1 to record the baseline).

- [ ] **Step 3: Commit**

```bash
git add freqtrade-webui/src/types/index.ts
git commit -m "feat: add HotPairInfo/HotPairsResult types for dynamic pair discovery"
```

---

### Task 2: `useDynamicPairs.ts` composable

**Files:**
- Create: `freqtrade-webui/src/composables/useDynamicPairs.ts`

**Interfaces:**
- Consumes: `HotPairInfo`, `HotPairsResult` from `@/types` (Task 1).
- Produces: `useDynamicPairs()` returning `{ loading: Ref<boolean>, error: Ref<string>, fetchHotPairs(instType: 'SPOT' | 'SWAP', topN?: number): Promise<HotPairsResult> }` — consumed by Task 3 (`ParamsPanel.vue`).

- [ ] **Step 1: Write the composable**

```ts
import { ref } from 'vue'
import type { HotPairInfo, HotPairsResult } from '@/types'

const OKX_API_BASE = 'https://www.okx.com/api/v5'

export function useDynamicPairs() {
  const loading = ref(false)
  const error = ref('')

  async function fetchHotPairs(instType: 'SPOT' | 'SWAP', topN = 20): Promise<HotPairsResult> {
    loading.value = true
    error.value = ''
    try {
      const [tickersRes, instrumentsRes] = await Promise.all([
        fetch(`${OKX_API_BASE}/market/tickers?instType=${instType}`),
        fetch(`${OKX_API_BASE}/public/instruments?instType=${instType}`)
      ])
      if (!tickersRes.ok || !instrumentsRes.ok) {
        throw new Error(`HTTP ${tickersRes.status}/${instrumentsRes.status}`)
      }
      const tickersJson = await tickersRes.json()
      const instrumentsJson = await instrumentsRes.json()
      if (tickersJson.code !== '0') throw new Error(tickersJson.msg || 'tickers 接口失败')
      if (instrumentsJson.code !== '0') throw new Error(instrumentsJson.msg || 'instruments 接口失败')

      const listTimeMap = new Map<string, number>()
      for (const inst of instrumentsJson.data as Array<{ instId: string; listTime: string }>) {
        listTimeMap.set(inst.instId, parseInt(inst.listTime))
      }

      const merged: HotPairInfo[] = (tickersJson.data as Array<{
        instId: string
        last: string
        open24h: string
        volCcy24h: string
      }>)
        .filter(t => listTimeMap.has(t.instId))
        .map(t => {
          const last = parseFloat(t.last)
          const open24h = parseFloat(t.open24h)
          return {
            instId: t.instId,
            last,
            open24h,
            change24h: open24h > 0 ? (last - open24h) / open24h : 0,
            volCcy24h: parseFloat(t.volCcy24h),
            listTime: listTimeMap.get(t.instId)!
          }
        })

      const byVolume = [...merged].sort((a, b) => b.volCcy24h - a.volCcy24h).slice(0, topN)
      const byChange = [...merged].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, topN)
      const byListTime = [...merged].sort((a, b) => b.listTime - a.listTime).slice(0, topN)

      return { byVolume, byChange, byListTime }
    } catch (err) {
      error.value = '获取失败，请重试'
      throw err
    } finally {
      loading.value = false
    }
  }

  return { loading, error, fetchHotPairs }
}
```

- [ ] **Step 2: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run: `cd freqtrade-webui && yarn dev`, then in the browser devtools console on the app page run:

```js
import('/src/composables/useDynamicPairs.ts').then(async (m) => {
  const { fetchHotPairs } = m.useDynamicPairs()
  const result = await fetchHotPairs('SPOT', 5)
  console.log(result)
})
```

Expected: logs an object with `byVolume`/`byChange`/`byListTime`, each an array of 5 objects with `instId`, `last`, `change24h`, `volCcy24h`, `listTime` populated with real numbers (not NaN).

- [ ] **Step 4: Commit**

```bash
git add freqtrade-webui/src/composables/useDynamicPairs.ts
git commit -m "feat: add useDynamicPairs composable for hot/new pair discovery"
```

---

### Task 3: Wire "🔥 发现热门/新币" into `ParamsPanel.vue`

**Files:**
- Modify: `freqtrade-webui/src/components/ParamsPanel.vue`

**Interfaces:**
- Consumes: `useDynamicPairs()` from Task 2, `HotPairInfo` from Task 1.
- Produces: extends the existing `selectedPairs` ref (already consumed by `getConfig()` and all four existing emit handlers) with dynamically-discovered `instId` strings, so no other file needs to change to support dynamic pairs in backtest/optimize/scan/validate.

- [ ] **Step 1: Add discovery panel state and logic to the `<script setup>` block**

Insert after the existing `const enableShort = ref(true)` / `const multiTimeframe = ref(false)` block (around line 223):

```ts
import { useDynamicPairs } from '@/composables/useDynamicPairs'
import type { HotPairInfo } from '@/types'

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
```

- [ ] **Step 2: Merge `dynamicPairs` into the existing `filteredPairs` computed**

Replace the existing `filteredPairs` computed (around line 226-232):

```ts
const filteredPairs = computed(() => {
  return [...defaultPairs, ...dynamicPairs.value].filter(pair => {
    if (pair.type !== contractType.value) return false
    if (!pairSearch.value) return true
    return pair.name.toLowerCase().includes(pairSearch.value.toLowerCase())
  })
})
```

- [ ] **Step 3: Add the discovery button next to the "选择交易对" label**

In the template, inside `.pair-actions` (around line 24-27), add the new button:

```html
<span class="pair-actions">
  <button class="btn btn-small" @click="openDiscoveryPanel">🔥 发现热门/新币</button>
  <button class="btn btn-small" @click="selectAllPairs">全选</button>
  <button class="btn btn-small" @click="deselectAllPairs">清空</button>
</span>
```

- [ ] **Step 4: Add the discovery panel markup**

Insert right after the closing `</div>` of `.pair-tags-container` (after line 49, still inside the `form-group`):

```html
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
```

- [ ] **Step 5: Add minimal styles for the discovery panel**

Append to the `<style scoped>` block, after `.new-badge` rule (around line 477):

```css
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
```

- [ ] **Step 6: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

Run: `cd freqtrade-webui && yarn dev`, open the app in a browser.
1. Click "🔥 发现热门/新币" — panel opens, three columns populate with real OKX pairs within a couple seconds.
2. Check two or three boxes across different columns, click "加入选择" — panel closes, the checked pairs now appear as active tags in the pair-tag cloud alongside the fixed list.
3. Click "▶ 运行回测" with one of the newly-added pairs selected — backtest runs successfully against that pair (proves `selectedPairs`/`getConfig()` integration needs no further changes).
4. Turn off wifi or block `www.okx.com` via devtools network throttling to "Offline", click "🔥 发现热门/新币" again — panel shows "获取失败，请重试" and does not crash the rest of the UI.

- [ ] **Step 8: Commit**

```bash
git add freqtrade-webui/src/components/ParamsPanel.vue
git commit -m "feat: add dynamic hot/new pair discovery panel to ParamsPanel"
```

---

## Part B: Trend Quality Scan Engine

### Task 4: Add `TrendScanResult` type

**Files:**
- Modify: `freqtrade-webui/src/types/index.ts`

**Interfaces:**
- Produces: `TrendScanResult`, `TrendScanInsufficientData` consumed by Task 7 (`useTrendScore.ts`), Task 8 (`TrendScanTab.vue`), Task 9 (`App.vue`).

- [ ] **Step 1: Append to `types/index.ts`**

```ts
export interface TrendScanResult {
  pair: string
  timeframe: string
  trendScore: number
  direction: 'long' | 'short' | 'neutral'
  level: 'strong' | 'moderate' | 'weak' | 'neutral'
  action: string
  adx: number
  efficiencyRatio: number
  volatilityState: 'normal' | 'elevated'
  stopLossTight: number
  stopLossWide: number
  takeProfit: number
  closeConfirmPrice: number
  riskRewardTight: number
  riskRewardWide: number
  isSwingBased: boolean
  isRealData: boolean
  insufficientData: false
}

export interface TrendScanInsufficientData {
  pair: string
  timeframe: string
  insufficientData: true
}

export type TrendScanEntry = TrendScanResult | TrendScanInsufficientData
```

- [ ] **Step 2: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add freqtrade-webui/src/types/index.ts
git commit -m "feat: add TrendScanResult/TrendScanEntry types"
```

---

### Task 5: `useTrendScore.ts` — indicators (ATR, efficiency ratio, MA alignment)

**Files:**
- Create: `freqtrade-webui/src/composables/useTrendScore.ts`

**Interfaces:**
- Consumes: `calculateMA`, `calculateADX` from `useBacktest()` (Task 5 imports `useBacktest` from `@/composables/useBacktest`).
- Produces: internal helpers `calculateATR(data, period): number[]`, `calculateEfficiencyRatio(data, period): number`, `calculateMAAlignment(data): { direction: 'long' | 'short' | 'neutral'; strength: number }`, `calculateVolatilityState(atrSeries): 'normal' | 'elevated'` — consumed by Task 6 (`calculateTrendQuality`) in this same file.

- [ ] **Step 1: Write the file with indicator helpers**

```ts
import { useBacktest } from '@/composables/useBacktest'

const { calculateMA, calculateADX } = useBacktest()

// ATR(period)，Wilder 平滑
function calculateATR(data: string[][], period = 14): number[] {
  const atr: number[] = []
  const trueRanges: number[] = []

  for (let i = 0; i < data.length; i++) {
    const high = parseFloat(data[i][3])
    const low = parseFloat(data[i][2])
    if (i === 0) {
      trueRanges.push(high - low)
      atr.push(trueRanges[0])
      continue
    }
    const prevClose = parseFloat(data[i - 1][1])
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trueRanges.push(tr)

    if (i < period) {
      const sum = trueRanges.slice(0, i + 1).reduce((a, b) => a + b, 0)
      atr.push(sum / (i + 1))
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period)
    }
  }

  return atr
}

// Kaufman 效率比：|close[i]-close[i-period]| / sum(|close[j]-close[j-1]|)
function calculateEfficiencyRatio(data: string[][], period = 20): number {
  const i = data.length - 1
  if (i < period) return 0

  const closeNow = parseFloat(data[i][1])
  const closeStart = parseFloat(data[i - period][1])
  const netChange = Math.abs(closeNow - closeStart)

  let pathSum = 0
  for (let j = i - period + 1; j <= i; j++) {
    pathSum += Math.abs(parseFloat(data[j][1]) - parseFloat(data[j - 1][1]))
  }

  return pathSum > 0 ? netChange / pathSum : 0
}

// MA5/10/20/50 排列方向与强度（strength: 0~1，完全排列为 1）
function calculateMAAlignment(data: string[][]): { direction: 'long' | 'short' | 'neutral'; strength: number } {
  const ma5 = calculateMA(data, 5)
  const ma10 = calculateMA(data, 10)
  const ma20 = calculateMA(data, 20)
  const ma50 = calculateMA(data, 50)
  const i = data.length - 1

  const v5 = parseFloat(ma5[i])
  const v10 = parseFloat(ma10[i])
  const v20 = parseFloat(ma20[i])
  const v50 = parseFloat(ma50[i])

  if ([v5, v10, v20, v50].some(v => isNaN(v))) {
    return { direction: 'neutral', strength: 0 }
  }

  const bullPairs = [v5 > v10, v10 > v20, v20 > v50].filter(Boolean).length
  const bearPairs = [v5 < v10, v10 < v20, v20 < v50].filter(Boolean).length

  if (bullPairs === 0 && bearPairs === 0) return { direction: 'neutral', strength: 0 }
  if (bullPairs >= bearPairs) return { direction: 'long', strength: bullPairs / 3 }
  return { direction: 'short', strength: bearPairs / 3 }
}

// ATR 相对自身历史分位数，>=90 分位视为异常偏高
function calculateVolatilityState(atrSeries: number[]): 'normal' | 'elevated' {
  const current = atrSeries[atrSeries.length - 1]
  const history = atrSeries.slice(0, -1)
  if (history.length < 20) return 'normal'

  const sorted = [...history].sort((a, b) => a - b)
  const rank = sorted.filter(v => v <= current).length
  const percentile = rank / sorted.length

  return percentile >= 0.9 ? 'elevated' : 'normal'
}
```

- [ ] **Step 2: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors (unused-helper warnings are expected at this stage since nothing calls these yet — they'll be consumed in Task 6; if `noUnusedLocals` is enabled and fails the build, proceed to Task 6 immediately in the same session before considering this a blocker).

- [ ] **Step 3: Commit**

```bash
git add freqtrade-webui/src/composables/useTrendScore.ts
git commit -m "feat: add trend indicator helpers (ATR, efficiency ratio, MA alignment)"
```

---

### Task 6: `useTrendScore.ts` — `calculateTrendQuality`

**Files:**
- Modify: `freqtrade-webui/src/composables/useTrendScore.ts`

**Interfaces:**
- Consumes: `calculateMAAlignment`, `calculateADX`, `calculateEfficiencyRatio`, `calculateATR`, `calculateVolatilityState` (Task 5, same file).
- Produces: `export function calculateTrendQuality(data: string[][]): TrendQualityResult` where `TrendQualityResult = { score: number; direction: 'long'|'short'|'neutral'; level: 'strong'|'moderate'|'weak'|'neutral'; action: string; adx: number; efficiencyRatio: number; volatilityState: 'normal'|'elevated' }` — consumed by Task 7 (`scoreSymbol`).

- [ ] **Step 1: Append the type and function to `useTrendScore.ts`**

```ts
export interface TrendQualityResult {
  score: number
  direction: 'long' | 'short' | 'neutral'
  level: 'strong' | 'moderate' | 'weak' | 'neutral'
  action: string
  adx: number
  efficiencyRatio: number
  volatilityState: 'normal' | 'elevated'
}

export function calculateTrendQuality(data: string[][]): TrendQualityResult {
  const alignment = calculateMAAlignment(data)
  const adxSeries = calculateADX(data, 14)
  const adx = adxSeries[adxSeries.length - 1] || 0
  const efficiencyRatio = calculateEfficiencyRatio(data, 20)
  const atrSeries = calculateATR(data, 14)
  const volatilityState = calculateVolatilityState(atrSeries)

  let score = 0
  score += alignment.strength * 35
  score += (Math.min(adx, 50) / 50) * 30
  score += efficiencyRatio * 25

  // 均线排列有方向但效率比很低：趋势不干净，扣分而非报错
  if (alignment.direction !== 'neutral' && efficiencyRatio < 0.3) {
    score -= 15
  }
  if (volatilityState === 'elevated') {
    score -= 10
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let level: 'strong' | 'moderate' | 'weak' | 'neutral'
  let action: string
  if (score >= 70) {
    level = 'strong'
    action = '趋势稳定，适合操作'
  } else if (score >= 50) {
    level = 'moderate'
    action = '趋势尚可，谨慎参与'
  } else if (score >= 30) {
    level = 'weak'
    action = '趋势尚可，谨慎参与'
  } else {
    level = 'neutral'
    action = '趋势不明，观望'
  }

  return { score, direction: alignment.direction, level, action, adx, efficiencyRatio, volatilityState }
}
```

- [ ] **Step 2: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run: `cd freqtrade-webui && yarn dev`, open browser devtools console on the app page:

```js
import('/src/composables/useTrendScore.ts').then(async (m) => {
  const okxData = await fetch('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=300').then(r => r.json())
  const rows = okxData.data.reverse().map(c => [
    parseFloat(c[1]).toFixed(8), parseFloat(c[4]).toFixed(8), parseFloat(c[3]).toFixed(8), parseFloat(c[2]).toFixed(8), c[5]
  ])
  console.log(m.calculateTrendQuality(rows))
})
```

Expected: an object with `score` between 0-100, `direction` one of `long`/`short`/`neutral`, `adx` a positive number, `efficiencyRatio` between 0-1. Spot-check against the live BTC-USDT 1H chart on okx.com — if BTC is clearly trending, score should be on the higher side; if choppy, lower.

- [ ] **Step 4: Commit**

```bash
git add freqtrade-webui/src/composables/useTrendScore.ts
git commit -m "feat: implement calculateTrendQuality scoring function"
```

---

### Task 7: `useTrendScore.ts` — `calculateSwingSLTP` and `scoreSymbol`

**Files:**
- Modify: `freqtrade-webui/src/composables/useTrendScore.ts`

**Interfaces:**
- Consumes: `calculateATR` (Task 5), `calculateTrendQuality` (Task 6), `TrendScanEntry`/`TrendScanResult` from `@/types` (Task 4).
- Produces: `export function calculateSwingSLTP(data: string[][], direction: 'long' | 'short'): SwingSLTPResult`, `export function scoreSymbol(pair: string, timeframe: string, data: string[][], isRealData: boolean): TrendScanEntry` — consumed by Task 9 (`App.vue`'s `handleTrendScan`).

- [ ] **Step 1: Add swing-point detection and pierce-depth helpers**

Append to `useTrendScore.ts`:

```ts
interface SwingPoint {
  index: number
  price: number
  type: 'high' | 'low'
  touchCount: number
}

// 局部极值 + 后续被触碰/受阻次数过滤，过滤掉随手就有的噪声摆动点
function findSwingPoints(data: string[][], lookback: number, fractalWidth = 3): SwingPoint[] {
  const start = Math.max(fractalWidth, data.length - lookback)
  const highs = data.map(d => parseFloat(d[3]))
  const lows = data.map(d => parseFloat(d[2]))
  const candidates: SwingPoint[] = []

  for (let i = start; i < data.length - fractalWidth; i++) {
    const windowHighs = highs.slice(i - fractalWidth, i + fractalWidth + 1)
    const windowLows = lows.slice(i - fractalWidth, i + fractalWidth + 1)
    if (highs[i] === Math.max(...windowHighs)) {
      candidates.push({ index: i, price: highs[i], type: 'high', touchCount: 0 })
    }
    if (lows[i] === Math.min(...windowLows)) {
      candidates.push({ index: i, price: lows[i], type: 'low', touchCount: 0 })
    }
  }

  const tolerance = 0.003
  for (const point of candidates) {
    for (let j = point.index + 1; j < data.length; j++) {
      const high = highs[j]
      const low = lows[j]
      if (point.type === 'high' && high >= point.price * (1 - tolerance) && high < point.price * 1.01) {
        point.touchCount++
      } else if (point.type === 'low' && low <= point.price * (1 + tolerance) && low > point.price * 0.99) {
        point.touchCount++
      }
    }
  }

  return candidates.filter(p => p.touchCount >= 1)
}

// 统计该品种历史上"刺穿摆动点又收回"的插针幅度，取 80 分位作为缓冲依据
function calculatePierceDepth(data: string[][], swingPoints: SwingPoint[]): number {
  const depths: number[] = []

  for (const point of swingPoints) {
    for (let j = point.index + 1; j < data.length; j++) {
      const high = parseFloat(data[j][3])
      const low = parseFloat(data[j][2])
      const close = parseFloat(data[j][1])
      if (point.type === 'high' && high > point.price && close < point.price) {
        depths.push((high - point.price) / point.price)
      } else if (point.type === 'low' && low < point.price && close > point.price) {
        depths.push((point.price - low) / point.price)
      }
    }
  }

  if (depths.length === 0) return 0
  depths.sort((a, b) => a - b)
  const idx = Math.min(Math.floor(depths.length * 0.8), depths.length - 1)
  return depths[idx]
}
```

- [ ] **Step 2: Add `calculateSwingSLTP`**

```ts
export interface SwingSLTPResult {
  stopLossTight: number
  stopLossWide: number
  takeProfit: number
  closeConfirmPrice: number
  riskRewardTight: number
  riskRewardWide: number
  isSwingBased: boolean
}

export function calculateSwingSLTP(data: string[][], direction: 'long' | 'short'): SwingSLTPResult {
  const currentPrice = parseFloat(data[data.length - 1][1])
  const atrSeries = calculateATR(data, 14)
  const currentAtr = atrSeries[atrSeries.length - 1] || currentPrice * 0.02

  const lookback = Math.min(150, data.length - 10)
  const swingPoints = lookback > 10 ? findSwingPoints(data, lookback) : []
  const stopType = direction === 'long' ? 'low' : 'high'
  const targetType = direction === 'long' ? 'high' : 'low'
  const stopCandidates = swingPoints.filter(p => p.type === stopType)
  const targetCandidates = swingPoints.filter(p => p.type === targetType)

  // 离当前价最近的、方向正确一侧的摆动点
  let stopBase: number | null = null
  for (const p of stopCandidates) {
    const isOnCorrectSide = direction === 'long' ? p.price < currentPrice : p.price > currentPrice
    if (!isOnCorrectSide) continue
    if (stopBase === null || Math.abs(p.price - currentPrice) < Math.abs(stopBase - currentPrice)) {
      stopBase = p.price
    }
  }

  const pierceDepthRatio = calculatePierceDepth(data, stopCandidates)
  const minBuffer = currentAtr * 0.3
  const wideBuffer = Math.max(currentAtr * 2.5, pierceDepthRatio * currentPrice)

  let stopLossTight: number
  let stopLossWide: number
  let isSwingBased: boolean

  if (stopBase !== null) {
    isSwingBased = true
    stopLossTight = direction === 'long' ? stopBase - minBuffer : stopBase + minBuffer
    stopLossWide = direction === 'long' ? stopBase - wideBuffer : stopBase + wideBuffer
  } else {
    isSwingBased = false
    stopLossTight = direction === 'long' ? currentPrice - currentAtr * 2 : currentPrice + currentAtr * 2
    stopLossWide = direction === 'long' ? currentPrice - currentAtr * 3 : currentPrice + currentAtr * 3
  }

  let takeProfit: number | null = null
  for (const p of targetCandidates) {
    const isOnCorrectSide = direction === 'long' ? p.price > currentPrice : p.price < currentPrice
    if (!isOnCorrectSide) continue
    if (takeProfit === null || Math.abs(p.price - currentPrice) < Math.abs(takeProfit - currentPrice)) {
      takeProfit = p.price
    }
  }
  if (takeProfit === null) {
    takeProfit = direction === 'long' ? currentPrice + currentAtr * 3 : currentPrice - currentAtr * 3
  }

  const closeConfirmPrice = stopLossWide

  const riskTight = Math.abs(currentPrice - stopLossTight)
  const riskWide = Math.abs(currentPrice - stopLossWide)
  const reward = Math.abs(takeProfit - currentPrice)

  return {
    stopLossTight,
    stopLossWide,
    takeProfit,
    closeConfirmPrice,
    riskRewardTight: riskTight > 0 ? reward / riskTight : 0,
    riskRewardWide: riskWide > 0 ? reward / riskWide : 0,
    isSwingBased
  }
}
```

- [ ] **Step 3: Add `scoreSymbol`**

```ts
import type { TrendScanEntry } from '@/types'

const MIN_CANDLES_REQUIRED = 100

export function scoreSymbol(pair: string, timeframe: string, data: string[][], isRealData: boolean): TrendScanEntry {
  if (data.length < MIN_CANDLES_REQUIRED) {
    return { pair, timeframe, insufficientData: true }
  }

  const quality = calculateTrendQuality(data)
  const sltpDirection = quality.direction === 'neutral' ? 'long' : quality.direction
  const sltp = calculateSwingSLTP(data, sltpDirection)

  return {
    pair,
    timeframe,
    trendScore: quality.score,
    direction: quality.direction,
    level: quality.level,
    action: quality.action,
    adx: quality.adx,
    efficiencyRatio: quality.efficiencyRatio,
    volatilityState: quality.volatilityState,
    stopLossTight: sltp.stopLossTight,
    stopLossWide: sltp.stopLossWide,
    takeProfit: sltp.takeProfit,
    closeConfirmPrice: sltp.closeConfirmPrice,
    riskRewardTight: sltp.riskRewardTight,
    riskRewardWide: sltp.riskRewardWide,
    isSwingBased: sltp.isSwingBased,
    isRealData,
    insufficientData: false
  }
}
```

- [ ] **Step 4: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Run: `cd freqtrade-webui && yarn dev`, browser devtools console:

```js
import('/src/composables/useTrendScore.ts').then(async (m) => {
  const okxData = await fetch('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=300').then(r => r.json())
  const rows = okxData.data.reverse().map(c => [
    parseFloat(c[1]).toFixed(8), parseFloat(c[4]).toFixed(8), parseFloat(c[3]).toFixed(8), parseFloat(c[2]).toFixed(8), c[5]
  ])
  console.log(m.scoreSymbol('BTC-USDT', '1H', rows, true))
})
```

Expected: full `TrendScanResult` object. Manually verify `stopLossTight`/`stopLossWide` sit on the correct side of the current price for the given `direction` (below current price for `long`, above for `short`), and `stopLossWide` is further from current price than `stopLossTight`. Also test with `rows.slice(0, 50)` (fewer than 100 candles) — expect `{ pair, timeframe, insufficientData: true }`.

- [ ] **Step 6: Commit**

```bash
git add freqtrade-webui/src/composables/useTrendScore.ts
git commit -m "feat: implement calculateSwingSLTP and scoreSymbol"
```

---

### Task 8: `TrendScanTab.vue` — new display component

**Files:**
- Create: `freqtrade-webui/src/tabs/TrendScanTab.vue`

**Interfaces:**
- Consumes: `TrendScanEntry`, `TrendScanResult` from `@/types` (Task 4), `ChartPanel.vue` (existing, unchanged).
- Produces: a `results: TrendScanEntry[]` prop, no emits (no "应用" button — this is display-only per spec: 不做自动化下单) — consumed by Task 9 (`App.vue`).

- [ ] **Step 1: Write the component**

```vue
<template>
  <div class="tab-content">
    <div v-if="results.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📈 趋势质量扫描结果</div>
        <div class="summary-text">
          共扫描 {{ results.length }} 个品种，趋势稳定: {{ strongCount }}，趋势尚可: {{ moderateCount }}
        </div>
      </div>
    </div>

    <div v-if="results.length > 0" class="chart-card">
      <div class="chart-header">
        <div class="chart-title">📋 扫描详情</div>
        <div class="filter-buttons">
          <button
            v-for="filter in filters"
            :key="filter.value"
            class="btn btn-small"
            :class="{ active: currentFilter === filter.value }"
            @click="currentFilter = filter.value"
          >
            {{ filter.label }}
          </button>
        </div>
      </div>
      <div class="table-container">
        <table class="trades-table">
          <thead>
            <tr>
              <th class="sortable" @click="handleSort('pair')">交易对 <span class="sort-icon">{{ getSortIcon('pair') }}</span></th>
              <th class="sortable" @click="handleSort('timeframe')">周期 <span class="sort-icon">{{ getSortIcon('timeframe') }}</span></th>
              <th class="sortable" @click="handleSort('direction')">方向 <span class="sort-icon">{{ getSortIcon('direction') }}</span></th>
              <th class="sortable" @click="handleSort('adx')">ADX <span class="sort-icon">{{ getSortIcon('adx') }}</span></th>
              <th class="sortable" @click="handleSort('trendScore')">趋势评分 <span class="sort-icon">{{ getSortIcon('trendScore') }}</span></th>
              <th class="sortable" @click="handleSort('action')">建议操作 <span class="sort-icon">{{ getSortIcon('action') }}</span></th>
              <th>止损（贴近/抗插针）</th>
              <th>止盈</th>
              <th class="sortable" @click="handleSort('riskRewardTight')">盈亏比 <span class="sort-icon">{{ getSortIcon('riskRewardTight') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sortedFilteredResults" :key="`${r.pair}-${r.timeframe}`" :class="!r.insufficientData ? r.level : ''">
              <td>{{ r.pair }}</td>
              <td>{{ r.timeframe }}</td>
              <template v-if="r.insufficientData">
                <td colspan="7" class="insufficient-cell">数据不足，无法评分</td>
              </template>
              <template v-else>
                <td :class="r.direction">{{ r.direction === 'long' ? '做多' : r.direction === 'short' ? '做空' : '中性' }}</td>
                <td>{{ r.adx.toFixed(1) }}</td>
                <td :class="getScoreClass(r.trendScore)">{{ r.trendScore }}</td>
                <td :class="r.level">
                  {{ r.action }}
                  <span v-if="!r.isRealData" class="warn-badge" title="模拟数据，仅供界面预览">⚠模拟数据</span>
                </td>
                <td>
                  {{ r.stopLossTight.toFixed(4) }} / {{ r.stopLossWide.toFixed(4) }}
                  <span v-if="!r.isSwingBased" class="warn-badge" title="未找到明显摆动点，按波动率估算">⚠按波动率估算</span>
                </td>
                <td>{{ r.takeProfit.toFixed(4) }}</td>
                <td :class="{ 'low-attraction': r.riskRewardTight < 1.2 }">
                  {{ r.riskRewardTight.toFixed(2) }} / {{ r.riskRewardWide.toFixed(2) }}
                  <span v-if="r.riskRewardTight < 1.2" class="warn-badge" title="盈亏比偏低">低吸引力</span>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="results.length === 0" class="empty-state">
      <p>点击「趋势扫描」查看结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TrendScanEntry, TrendScanResult } from '@/types'

const props = defineProps<{
  results: TrendScanEntry[]
}>()

function isScored(r: TrendScanEntry): r is TrendScanResult {
  return !r.insufficientData
}

const currentFilter = ref('all')
interface SortState { key: string; order: 'asc' | 'desc' }
const sortState = ref<SortState>({ key: 'trendScore', order: 'desc' })

const filters = [
  { label: '全部', value: 'all' },
  { label: '强烈建议', value: 'strong' },
  { label: '建议', value: 'moderate' },
  { label: '轻仓', value: 'weak' },
  { label: '做多', value: 'long' },
  { label: '做空', value: 'short' }
]

const strongCount = computed(() => props.results.filter(r => isScored(r) && r.level === 'strong').length)
const moderateCount = computed(() => props.results.filter(r => isScored(r) && r.level === 'moderate').length)

function handleSort(key: string) {
  if (sortState.value.key === key) {
    sortState.value.order = sortState.value.order === 'asc' ? 'desc' : 'asc'
  } else {
    sortState.value.key = key
    sortState.value.order = 'desc'
  }
}

function getSortIcon(key: string): string {
  if (sortState.value.key !== key) return '⇅'
  return sortState.value.order === 'asc' ? '↑' : '↓'
}

const filteredResults = computed(() => {
  const list = props.results
  switch (currentFilter.value) {
    case 'strong': return list.filter(r => isScored(r) && r.level === 'strong')
    case 'moderate': return list.filter(r => isScored(r) && r.level === 'moderate')
    case 'weak': return list.filter(r => isScored(r) && r.level === 'weak')
    case 'long': return list.filter(r => isScored(r) && r.direction === 'long')
    case 'short': return list.filter(r => isScored(r) && r.direction === 'short')
    default: return list
  }
})

const sortedFilteredResults = computed(() => {
  const list = [...filteredResults.value]
  const { key, order } = sortState.value

  list.sort((a, b) => {
    // 数据不足的行始终排在最后，不参与排序比较
    const aScored = isScored(a)
    const bScored = isScored(b)
    if (!aScored && !bScored) return 0
    if (!aScored) return 1
    if (!bScored) return -1

    let aVal: number | string
    let bVal: number | string
    switch (key) {
      case 'pair': aVal = a.pair; bVal = b.pair; break
      case 'timeframe': aVal = a.timeframe; bVal = b.timeframe; break
      case 'direction':
        aVal = a.direction === 'long' ? 2 : a.direction === 'short' ? 1 : 0
        bVal = b.direction === 'long' ? 2 : b.direction === 'short' ? 1 : 0
        break
      case 'adx': aVal = a.adx; bVal = b.adx; break
      case 'trendScore': aVal = a.trendScore; bVal = b.trendScore; break
      case 'action': aVal = a.action; bVal = b.action; break
      case 'riskRewardTight': aVal = a.riskRewardTight; bVal = b.riskRewardTight; break
      default: return 0
    }

    if (aVal < bVal) return order === 'asc' ? -1 : 1
    if (aVal > bVal) return order === 'asc' ? 1 : -1
    return 0
  })

  return list
})

function getScoreClass(score: number): string {
  if (score >= 70) return 'strong'
  if (score >= 50) return 'moderate'
  if (score >= 30) return 'weak'
  return 'neutral'
}
</script>

<style scoped>
.tab-content { display: flex; flex-direction: column; gap: 24px; }
.chart-card { background: var(--bg-card); border-radius: 16px; padding: 24px; border: 1px solid var(--border-color); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
.chart-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); }
.summary-text { color: var(--text-secondary); font-size: 0.9rem; }
.filter-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 0.8rem; cursor: pointer; background: var(--bg-secondary); color: var(--text-primary); transition: all 0.3s; }
.btn:hover, .btn.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }
.table-container { overflow-x: auto; max-height: 500px; overflow-y: auto; }
.trades-table { width: 100%; border-collapse: collapse; }
.trades-table th, .trades-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color); font-family: 'Space Mono', monospace; font-size: 0.8rem; }
.trades-table th { color: var(--text-secondary); font-weight: 400; text-transform: uppercase; letter-spacing: 1px; font-size: 0.7rem; position: sticky; top: 0; background: var(--bg-card); }
.trades-table th.sortable { cursor: pointer; user-select: none; transition: color 0.2s; }
.trades-table th.sortable:hover { color: var(--accent-blue); }
.trades-table th .sort-icon { margin-left: 4px; font-size: 0.6rem; opacity: 0.7; }
.trades-table tr:hover { background: rgba(59, 130, 246, 0.05); }
.trades-table tr.strong { background: rgba(16, 185, 129, 0.1); }
.trades-table tr.moderate { background: rgba(59, 130, 246, 0.1); }
.trades-table tr.weak { background: rgba(245, 158, 11, 0.1); }
.long { color: var(--accent-green); }
.short { color: var(--accent-red); }
.neutral { color: var(--text-secondary); }
.strong { color: var(--accent-green); font-weight: bold; }
.moderate { color: var(--accent-blue); }
.weak { color: var(--accent-gold); }
.insufficient-cell { color: var(--text-secondary); font-style: italic; }
.warn-badge { display: inline-block; margin-left: 6px; padding: 1px 5px; background: rgba(245, 158, 11, 0.2); color: var(--accent-gold); border-radius: 4px; font-size: 0.65rem; }
.low-attraction { opacity: 0.7; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
</style>
```

- [ ] **Step 2: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add freqtrade-webui/src/tabs/TrendScanTab.vue
git commit -m "feat: add TrendScanTab display component"
```

---

### Task 9: Wire `handleTrendScan` into `App.vue`

**Files:**
- Modify: `freqtrade-webui/src/App.vue`

**Interfaces:**
- Consumes: `scoreSymbol` from `useTrendScore.ts` (Task 7), `TrendScanEntry` from `@/types` (Task 4), `TrendScanTab.vue` (Task 8), existing `loadData`/`clearCache`/`showLoading`/`hideLoading`/`isRealData` from `useDataFetch()`, existing `BacktestConfig` from `ParamsPanel.vue`.
- Produces: new `trendscan` tab entry, `trendScanResults` ref, `handleTrendScan(config: BacktestConfig)` function wired to a new `@trendScan` emit from `ParamsPanel.vue` (Task 10).

- [ ] **Step 1: Add imports**

At the top of `<script setup>` (after line 81's `import ValidateTab from '@/tabs/ValidateTab.vue'`):

```ts
import TrendScanTab from '@/tabs/TrendScanTab.vue'
import { scoreSymbol } from '@/composables/useTrendScore'
import type { TrendScanEntry } from '@/types'
```

- [ ] **Step 2: Add the new tab entry**

Replace the `tabs` array (lines 83-88):

```ts
const tabs = [
  { name: 'backtest', label: '回测结果', icon: '📈' },
  { name: 'optimize', label: '参数优化', icon: '🔍' },
  { name: 'scan', label: '多品种扫描', icon: '📊' },
  { name: 'trendscan', label: '趋势扫描', icon: '📈' },
  { name: 'validate', label: '滑动窗口验证', icon: '✅' }
]
```

- [ ] **Step 3: Add the results ref**

Add after `const scanResults = ref<ScanResult[]>([])` (line 97):

```ts
const trendScanResults = ref<TrendScanEntry[]>([])
```

- [ ] **Step 4: Add `handleTrendScan`**

Add immediately after the closing `}` of `handleScan` (after line 306, before the `// 滑动窗口验证` comment):

```ts
// 趋势质量扫描：不做参数网格搜索，直接对每个品种打分
async function handleTrendScan(config: BacktestConfig) {
  currentConfig.value = config

  if (config.selectedPairs.length === 0) {
    showError('请至少选择一个交易对')
    return
  }

  const timeframes = config.multiTimeframe ? ['1H', '4H', '1D'] : [config.timeframe]
  const results: TrendScanEntry[] = []

  clearCache()
  lastDataConfig.value = null

  showLoading(`正在扫描 ${config.selectedPairs.length} 个交易对 x ${timeframes.length} 个周期...`)

  let completed = 0
  const total = config.selectedPairs.length * timeframes.length

  for (const pair of config.selectedPairs) {
    for (const timeframe of timeframes) {
      try {
        const data = await loadData(pair, timeframe, config.limit)
        results.push(scoreSymbol(pair, timeframe, data.data, isRealData.value))
        completed++
        loadingText.value = `扫描进度: ${completed}/${total}`
      } catch (err) {
        console.error(`趋势扫描 ${pair} ${timeframe} 失败:`, err)
      }
    }
  }

  trendScanResults.value = results
  activeTab.value = 'trendscan'
  hideLoading()
}
```

- [ ] **Step 5: Wire the template**

Add the `@trendScan` emit to `<ParamsPanel>` (after line 38's `@scan="handleScan"`):

```html
@trendScan="handleTrendScan"
```

Add the `<TrendScanTab>` element after the `<ScanTab>` block (after line 59's closing `/>`):

```html
<TrendScanTab
  v-show="activeTab === 'trendscan'"
  :results="trendScanResults"
/>
```

- [ ] **Step 6: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no new errors. (This will fail until Task 10 adds the `trendScan` emit to `ParamsPanel.vue` — if running standalone, expect a template type error on `@trendScan` referencing an emit that doesn't exist yet; proceed to Task 10 before treating this as a blocker.)

- [ ] **Step 7: Commit**

```bash
git add freqtrade-webui/src/App.vue
git commit -m "feat: wire handleTrendScan and trendscan tab into App.vue"
```

---

### Task 10: Add "📈 趋势扫描" button to `ParamsPanel.vue`

**Files:**
- Modify: `freqtrade-webui/src/components/ParamsPanel.vue`

**Interfaces:**
- Produces: new `trendScan` emit consumed by Task 9 (`App.vue`).

- [ ] **Step 1: Add the emit declaration**

Modify the `defineEmits` block (around line 264-269):

```ts
const emit = defineEmits<{
  runBacktest: [config: BacktestConfig]
  optimize: [config: BacktestConfig]
  scan: [config: BacktestConfig]
  trendScan: [config: BacktestConfig]
  validate: [config: BacktestConfig]
}>()
```

- [ ] **Step 2: Add the emit function**

Add after `emitScan` (after line 332's closing `}`):

```ts
function emitTrendScan() {
  if (selectedPairs.value.length === 0) {
    showError('请至少选择一个交易对')
    return
  }
  emit('trendScan', getConfig())
}
```

- [ ] **Step 3: Add the button and hint text**

Replace the `.buttons-row` block (lines 148-161):

```html
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
  <button class="btn btn-secondary" @click="emitTrendScan">
    📈 趋势扫描
  </button>
  <button class="btn btn-secondary" @click="emitValidate">
    ✅ 滑动窗口验证
  </button>
</div>
<div class="trend-scan-hint">
  💡 趋势扫描使用固定标准参数，不受下方回测参数影响
</div>
```

- [ ] **Step 4: Add the hint style**

Append to `<style scoped>`, after `.buttons-row` rule (after line 553):

```css
.trend-scan-hint {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 8px;
}
```

- [ ] **Step 5: Type-check**

Run: `cd freqtrade-webui && npx vue-tsc --noEmit`
Expected: no errors (this resolves the Task 9 Step 6 blocker).

- [ ] **Step 6: Manual verification**

Run: `cd freqtrade-webui && yarn dev`, open the app.
1. Select 2-3 pairs (mix of ones you believe are trending and ones you believe are choppy from recent chart knowledge), click "📈 趋势扫描".
2. Confirm the app switches to the "趋势扫描" tab and shows a table with 趋势评分/建议操作/止损(贴近/抗插针)/止盈/盈亏比 columns, and no 历史收益/胜率/回撤 columns.
3. Confirm sorting by clicking column headers works, and the level filter buttons (强烈建议/建议/轻仓/做多/做空) filter correctly.
4. Confirm the existing "📊 多品种扫描" button still works exactly as before and shows the old `ScanTab` with 历史收益/胜率/回撤 intact (regression check).
5. Select a pair with a very short `K线数量` (e.g. 300 but effectively pick a brand-new pair added via Task 3's discovery panel that might have <100 candles of history) to confirm the "数据不足，无法评分" row renders instead of a fabricated score.

- [ ] **Step 7: Commit**

```bash
git add freqtrade-webui/src/components/ParamsPanel.vue
git commit -m "feat: add trend scan button and hint text to ParamsPanel"
```

---

## Self-Review Notes

- **Spec coverage:** 背景/范围 → Tasks 1-10 cover both the trend-scan engine and dynamic pair discovery. 架构 (borrow only `calculateMA`/`calculateADX`, never `runBacktestWithParams`) → enforced in Task 5 Step 1 import and Global Constraints. 趋势质量评分算法 (MA alignment, ADX, efficiency ratio, ATR percentile, weighted score, mismatch penalty not error, level/action text) → Task 6. 止盈止损 (swing point strength filter, pierce-depth buffer, dual tight/wide levels with R:R, close-confirm display price, ATR fallback with `isSwingBased=false`) → Task 7. 动态品种发现 (tickers+instruments merge, three rankings, manual refresh, no mock fallback, general-purpose entry usable by all tabs) → Tasks 1-3. UI 改动 (new columns, sort key default, filter buttons kept, no 历史收益/胜率/回撤, ParamsPanel hint text) → Tasks 8, 9, 10. 错误处理 (insufficient data, mock-data warning badge, per-symbol try/catch isolation) → Task 7 Step 3, Task 8 warn badges, Task 9 Step 4's `try/catch` inside the loop.
- **Design ambiguity resolved:** the spec's phrase "汇总成 TrendScanResult[]，交给 ScanTab（改造后）展示" read literally would mean mutating the existing `ScanTab.vue`/`ScanResult`, which conflicts with keeping both "📊 多品种扫描" and "📈 趋势扫描" as separate buttons (spec: ParamsPanel UI section explicitly keeps both). Resolved by cloning a new `TrendScanTab.vue`/`trendscan` tab slot instead of mutating `ScanTab.vue` — this reuses the same layout/sort/filter *framework* (satisfying "复用...UI框架" from 范围/架构) without deleting the existing, working, unrelated "多品种扫描" feature. This is a plan-level implementation-detail decision, not a scope change.
- **Placeholder scan:** no TBD/TODO; all code blocks are complete and runnable as written.
- **Type consistency:** `TrendScanEntry = TrendScanResult | TrendScanInsufficientData` (Task 4) is used identically in Task 7 (`scoreSymbol` return type), Task 8 (`results` prop, `isScored` guard), and Task 9 (`trendScanResults` ref). `HotPairInfo`/`HotPairsResult` (Task 1) used identically in Task 2 (`fetchHotPairs` return) and Task 3 (`hotPairs` ref type). `SwingSLTPResult` fields (`stopLossTight`, `stopLossWide`, `takeProfit`, `closeConfirmPrice`, `riskRewardTight`, `riskRewardWide`, `isSwingBased`) match `TrendScanResult`'s corresponding fields exactly.
