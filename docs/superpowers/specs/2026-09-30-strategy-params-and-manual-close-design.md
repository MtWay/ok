# 建仓任务卡：策略参数显示 + 手动平仓 设计文档

日期：2026-09-30
范围：`freqtrade-webui/notify-service/`（Express 后端）、`freqtrade-webui/src/`（Vue 3 前端）

## 背景与动机

建仓任务卡（`PositionTaskPanel.vue`）目前只显示状态、层位、已实现收益、浮动盈亏和一张交易记录表。用户要照着这套系统在 OKX 上手动实盘下单，但看不到策略这一轮到底是**用什么数触发的**——网格的下界上界从哪来、下一层挂在哪、止盈价多少，全是黑的。只能反过来去读后端代码自己推。

同时任务卡没有任何人工干预出口。策略开仓失败（截图里那条「执行失败」）或行情走坏时，唯一能做的是「暂停」——那只是停止后续开仓，已经建下的仓还在跑。

本次做两件事：

1. 把五种策略当次运行的**指标快照**暴露到卡上，供实盘人工下单参考。
2. 加「手动平仓」，支持对手价（预填可改）与市价两种方式。

## 目标

- 卡片上能看到五种策略各自的实时指标值，且这些值**就是**触发逻辑用的那批数，不存在第二套算法。
- 一键平掉某任务的全部持仓，或只平选中的层。
- 平仓走 freqtrade `forceexit`，方式可选对手价 limit 或市价 market。
- 平仓是逐层独立的，部分失败不阻断、不误改状态。

## 非目标

- 不做 WebSocket 实时推送。快照按调度周期（5m/15m/1H/4H）更新，卡片上标注取自 `task.lastRun`。
- 不做部分减仓（fractional exit）。要减就减整层。
- 不直连 OKX 交易所下单。平仓统一经 freqtrade，与策略建仓走同一条链路、同一套持仓记账。
- 不做挂单撤单管理、也不追踪 limit 平仓单是否成交（交给 freqtrade 与既有的 `syncPlanPositions`）。
- 不动 Python 侧（`freqtrade_userdir/`）。

---

## 决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| 参数快照怎么产出 | 抽出 `position-indicators.ts`，`detect*` 复用其计算 | 避免第二套算法与触发逻辑漂移 |
| 快照何时算 | 每次调度运行时算一次并落盘 | 卡片已有 30s 轮询，无需每次拉 300 根 K 线 |
| 平仓打到哪一层 | freqtrade `/api/v1/forceexit`（经 notify-service） | 与建仓同链路，持仓记账一致 |
| 对手价定价 | 手动输入委托价，预填对手价 | 看到挂不上时能手动追价 |
| 平仓粒度 | 默认全平，可勾选只平某层 | 常见诉求是全平，但偶尔只想拆掉一层 |
| 影子单 | 跳过下单，但内部标记平仓 | 影子单本就没有真实持仓 |
| 参数显示范围 | 五种策略全做 | 卡片支持五种策略，只做网格会让其余四种的用户困惑 |

---

## 第 1 部分：策略参数快照

### 后端：`position-indicators.ts`（新增）

```ts
export function computeIndicators(
  task: PositionTask,
  candles: string[][],
  state: PositionState,
): PositionIndicators
```

按 `task.strategy` 分派到五个纯函数。每个函数把该策略检测器里已有的数值计算搬进来，同时返回结构化快照；`detect*` 改为调用同一函数取数，判定逻辑一字不动。

`PositionIndicators` 是可判别联合，前端按 `kind` 分支渲染：

```ts
export type PositionIndicators =
  | { kind: 'ma_cross';    ... }
  | { kind: 'turtle';      ... }
  | { kind: 'bollinger';   ... }
  | { kind: 'grid';        ... }
  | { kind: 'pivot';       ... }
```

各策略字段：

- **`ma_cross`** — `fast` / `slow`（快慢线当前值）、`fastPrev` / `slowPrev`（上一根值，用于判断交叉）、`cross`（`golden` | `dead` | `none`）、`adx` 与 `adxThreshold`、`atr`、`close`、`stopPrice`、`takeProfit1`、`takeProfit2`
- **`turtle`** — `entryHigh` / `entryLow`（入场通道）、`exitHigh` / `exitLow`（离场通道）、`atr`、`lastUnitPrice`、`unitStep`（`unitStepAtr × atr`）、`nextAddPrice`（下一加仓触发价）、`unitsUsed` / `maxUnits`、`stopPrice`
- **`bollinger`** — `upper` / `middle` / `lower`、`close`、`bandwidth`（`(upper - lower) / middle`）、`atr`、`stopPrice`（配了 `stopLossPct` 时）、`entryTrigger`（下轨）
- **`grid`** — `lookback`、`gridCount`、`lower`（20% 分位）、`upper`（80% 分位）、`step`、`close`、`prevClose`、`nextLevel`（下一未占用层的层号）、`nextLevelPrice`（该层触发价）、`levels[]`（每层的 `level` / `price` / `tpPrice`）
- **`pivot`** — `pp` / `s1` / `s2` / `r1` / `r2`、`thresholdPct`、`stopPct`、`stopPrice`（当前持仓）、`takeProfitPrice`（当前持仓）

### 数据流

1. `position-scheduler.executePositionTask` 拉完 K 线后调 `computeIndicators(task, candles, state)`。
2. 快照写入 `state.indicators`，随 `savePositionState` 一起落盘。
3. `GET /api/notify/position-tasks/:id/state` 原样返回，`PositionState` 类型加可选 `indicators?: PositionIndicators`。

`PositionState` 落盘结构变了，老记录没有该字段，前端按可选处理。

### 前端

新增 `freqtrade-webui/src/components/StrategyParamsPanel.vue`，接收 `indicators` 与 `lastRun`，按 `kind` 渲染字段表（标签 + 值），价格类用等宽字体。任务卡在「交易记录」旁加一个「策略参数」折叠按钮，默认收起，两者互不干扰。快照区顶部标注 `取自 <lastRun 时间>`，让用户知道这个数有多旧（15m 任务最旧 15 分钟）。

---

## 第 2 部分：手动平仓

### 新端点 1：取盘口与持仓层

`GET /api/notify/position-tasks/:id/close-quote`

返回：

```ts
{
  bid: number
  ask: number
  last: number
  levels: Array<{
    level: number
    side: 'long' | 'short'
    price: number        // 该层成交价
    tpPrice?: number     // 该层止盈价
    planId: string
    kind: 'live' | 'shadow' | 'no_trade'   // live=有 tradeId；shadow=影子单；no_trade=实仓但尚无 tradeId
  }>
}
```

`levels[]` 的来源按策略分：

- `grid` 取 `state.gridLevels`，`level` 即网格层号（1..gridCount）
- `turtle` 取 `state.units`，`level` 为该单位在数组中的下标（0 起）
- `ma_cross` / `bollinger` / `pivot` 只有 `state.planId` 一层，`level` 记为 `0`

`kind` 由对应 plan 的 `shadow` 与 `tradeId` 推出：`shadow` 为真 → `shadow`；否则有 `tradeId` → `live`；否则 `no_trade`。`state` 中引用了 planId 但该 plan 在 `loadPlans()` 里查不到时，同样归为 `no_trade`。

### 新端点 2：执行平仓

`POST /api/notify/position-tasks/:id/manual-close`

```ts
{ levels: number[] | null, mode: 'counter' | 'market', price?: number }
```

`levels` 为 `null` 表示全平。返回：

```ts
{
  degraded?: boolean      // 对手价不可用、已降级为市价
  closed: Array<{ level: number; price: number }>
  skipped: Array<{ level: number; reason: string }>
  failed:  Array<{ level: number; error: string }>
}
```

流程：

1. 按 `levels` 收集目标层。
2. 逐层独立处理：
   - `shadow` → 调 `markPlanClosed(plan, 'manual')` 只改内部记账，**不下单**，计入 `closed`。
   - `no_trade`（实仓但无 `tradeId`）→ **不下单，也不从 state 移除该层**，计入 `skipped`，理由写明「尚无 tradeId，可能仍在重试，稍后重试」。
   - `live` → 按 `mode` 调 `forceexit`：`counter` 传 `ordertype: 'limit'` + `price`，`market` 传 `ordertype: 'market'`。成功则 `closeTradePlan(planId, 'manual', opts)` 并计入 `closed`；抛错则计入 `failed`。
3. `counter` 模式下，提交时重新拉一次盘口；提交价偏离对手价超过 1% 则整个请求拒绝（`400`），返回当前对手价让前端提示重新取价。
4. 全部处理完后，**只移除真正平掉的层**：从 `state.gridLevels`（或 `state.units`）中删去对应项；若 `gridLevels` / `units` 清空且无 `state.planId`，则 `status` 回 `'flat'`，清 `entryPrice` / `entryTime` / `planId`。若一个都没平掉，`state` 不写回。

### 改动点：`trading.ts`

- `closeTradePlan(planId, reason, opts?: { orderType?: 'market' | 'limit'; price?: number })`。默认 `market`，现有调用点（`position-scheduler` 的 `exit` / `grid_exit`）行为不变。
- `closePlan` 内部把硬编码的 `ordertype: 'market'` 改为取 `opts`。
- 新增 `markPlanClosed(plan, reason)`：与 `closeTradePlan` 相同的状态写入，但跳过 freqtrade 调用，专供影子单。

### 前端：`ManualCloseDialog.vue`（新增）

任务卡 header 上，「暂停」按钮右边加红色「手动平仓」按钮；`state.status === 'flat'` 或无持仓层时禁用。

对话框内容：

- **持仓层列表** — 每层一行 checkbox，默认全选；行内显示层号、方向徽章、成交价、止盈价、`kind` 徽章（实仓 / 影子 / 无 tradeId）。
- **平仓方式** — 下拉，默认「对手价」。选市价时隐藏价格区。
- **委托价** — 对手价模式下展示后端返回的对手价预填值（平多用 `ask`，平空用 `bid`），可手改；旁边「重新取价」按钮。取价失败时保留已填价格不变，只提示取价失败。
- **确认** — 底部红色「确认平仓 N 层」。提交后按 `closed` / `skipped` / `failed` 逐条回显，不弹笼统的成功/失败提示。若 `degraded` 为真，额外提示「对手价不可用，已按市价执行」。

`PositionTaskPanel.vue` 只负责按钮、开关对话框和结果转发，不内联对话框实现——该文件已 832 行。

---

## 错误处理

- 平仓**部分失败不阻断**：每层独立 try/catch，三类结果分开返回。
- `state` 只在确有层被平掉时写回，避免平仓失败却清了状态。
- `close-quote` 取价失败 → 对话框不打开，提示重试。
- 盘口偏离超 1% → `400` 拒绝，前端展示最新对手价要求重新确认。
- `forceexit` 的 `ordertype: 'limit'` + `price` 需服务端 freqtrade 版本支持。venv 在服务器上，本地无法预先验证；实现时先探测，不支持则降级为市价并置 `degraded: true`。

## 测试

`notify-service` 现有测试用 `node:test`（无 npm script，直接 `npx tsx --test`）。

- **`position-indicators.test.ts`** — 构造 K 线断言五种策略快照的关键值；重点断言**快照值与 `detect*` 判定用的是同一批数**（如网格快照的 `nextLevelPrice` 等于 `detectGrid` 实际触发出 `grid_entry` 的那层价格）。这是方案 A 的核心价值所在，必须覆盖。
- **`manual-close.test.ts`** — mock forceexit，断言：选层平仓、全平、影子单不下单只内部标记、无 tradeId 跳过且 state 未被改动、部分失败时 state 只移除成功平掉的层、偏离超 1% 被拒。
- 前端无测试运行器（`package.json` 未配置），靠 `yarn build` 的 `vue-tsc` 类型检查 + 手动点。
