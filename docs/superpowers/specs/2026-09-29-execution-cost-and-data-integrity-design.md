# 回测执行成本建模 + 数据层诚信 设计文档

日期：2026-09-29
范围：`freqtrade-webui/`（Vue 3 + TS）

## 背景与动机

对现有交易系统做分层盘点后，结论是信号层与评估层投入过重，而执行层与数据可信度存在缺口。本次只处理两块：

1. **数据层不诚信**——`useDataFetch.loadData` 在 OKX 请求失败时静默回落到 `generateMockData()` 的伪随机游走，仅置 `isRealData = false`。回测与参数优化可能因此跑在假数据上。
2. **执行成本未建模**——WebUI 侧 5 个策略引擎（maCross / turtle / bollinger / grid / pivot）不扣手续费，也不计永续合约资金费，导致全部历史回测结论偏乐观。

同仓库的 `notify-service/src/backtest.ts:40` 与 `turtleBacktest.ts:26` 已设 `FEE_RATE = 0.0005`（taker 单边），`turtle.ts:295` 也实际扣减。本次是让 WebUI 侧与之对齐，并补上两边都缺的**资金费**。

已评估但本次**不做**的：账户级风控、仓位管理、实盘对账。`notify-service/src/circuit-breaker.ts` 已实现完整的 active→tripped→probe 熔断状态机，`trading.ts` 已有退避重试、孤儿仓位清扫与 `/status` 轮询，第 4/6 层并非空白。

## 目标

- OKX 拉数失败时硬失败，绝不返回伪造数据。
- WebUI 5 个引擎的回测收益为**扣除手续费与资金费后的净值**，且 `totalReturn`、`maxDrawdown`、`equityCurve` 三者自洽。
- 现货只扣手续费；`*-USDT-SWAP` 额外计资金费，多头付出、空头收取。
- 回测结果页显式展示成本金额。

## 非目标

- 不引入滑点模型（成交价假设的跳空处理保持各引擎现状）。
- 不重构 5 个引擎的权益计算结构为统一的 `Account` 抽象。
- 不修改 Python 侧（`freqtrade_userdir/`）与 notify-service 的现有回测逻辑。

---

## 一、数据层：移除 mock 回退

### 改动

**`src/composables/useDataFetch.ts`**

- 删除 `generateMockData`（137-180 行）及其 `basePrices` 常量表。
- `loadData` 的 catch 分支改为：调用 `showError(...)` 后**重新抛出**原异常，不再返回替代数据。
- 删除 `isRealData` ref 及其在 return 对象中的导出。

**连带清理**（仅删除因上述改动而失效的代码）

- `src/types/index.ts:226` `TrendScanEntry.isRealData` 字段
- `src/composables/useTrendScore.ts:413,454` `scoreSymbol` 的 `isRealData` 入参与透出
- `src/App.vue:146` 解构中的 `isRealData`
- `src/tabs/TrendScanTab.vue:90` 的「⚠模拟数据」徽章

### 顺序修正

`App.vue:227-231` 目前在调用 `loadData` **之前**执行 `clearCache()` 与 `strategyResults.value.clear()`。若拉数失败，上一次的结果已被清空，违背「失败时保留上一次结果」的要求。

改为：先 `loadData`，成功后再 `clearCache()` 并清理 `strategyResults`。涉及 `handleRunBacktest`、`handleOptimize`、`handleScan`、`handleValidate` 四条路径。

### 批量场景

`loadMultipleData` 保留现有的逐 pair `try/catch`：单个交易对失败时跳过该 pair、继续其余，并在返回前汇总失败清单，由调用方提示用户。硬失败只作用于单 pair 的 `loadData`。

### 需逐一核查的调用点

`loadData` 改为抛错后，以下调用方必须有 catch，否则会产生未处理的 Promise 拒绝：

- `App.vue:232, 320, 390, 494, 531, 620`（六处，外层 handler 已有 try/catch）
- `src/tabs/PositionsTab.vue:129, 151`
- `src/tabs/ScanTab.vue:245`

## 二、成本模块

### 新增 `src/composables/useExecutionCost.ts`

纯函数模块，不依赖 Vue 运行时，便于单测。

```ts
export interface CostParams {
  takerFeeRate: number          // 默认 0.0005（OKX taker 单边）
  fundingRate8h: number         // 默认 0.0001（0.01% / 8h）
  fundingIntervalHours: number  // 默认 8
  isPerp: boolean
}

export const DEFAULT_COST: CostParams

/** 按 instrumentId 后缀 '-SWAP' 判定永续；override 可覆盖任一字段 */
export function resolveCost(pair: string, override?: Partial<CostParams>): CostParams

/** 单次成交的手续费 */
export function fillFee(notional: number, c: CostParams): number

/**
 * 持仓 barsHeld 根 bar 期间累计的资金费。
 * dir = 1（多头）返回正数表示付出，dir = -1 返回负数表示收取。
 * 现货（isPerp = false）恒返回 0。
 */
export function fundingAccrual(
  notional: number, barsHeld: number, dir: 1 | -1, barMs: number, c: CostParams
): number
```

`fundingAccrual` 按结算间隔计提，避免按 bar 线性摊薄导致高周期图少算：

```
每点资金费 = notional × fundingRate8h × (fundingIntervalHours / 8)
计提额     = 每点资金费 × floor(barsHeld × barMs / (fundingIntervalHours × 3600_000))
```

默认参数下 1h 图每 8 根 bar 结算一次；日线图每根 bar 跨 24 小时，因此每根含 3 个结算周期（3 根日线 = 9 个周期）。名义价值取该根 bar 的持仓市值（`stakeAmount` 或各单位的入场名义价值），不使用浮动盈亏后的市值，以保持计提额只依赖可从成交记录复现的量。

### 参数传递

5 个引擎目前都拿不到 `pair`，必须补上，否则 SWAP 回测无法识别、仍然不计资金费。

- **bollinger / grid / pivot**：已有 `opts` 对象，新增 `pair: string` 字段。
- **maCross `runBacktestWithParams`**：在现有 13 个参数之后追加可选尾部参数 `pair?: string`。
- **turtle `runTurtleBacktest`**：同样追加可选尾部参数 `pair?: string`。

尾部可选保证既有调用点编译通过，但**所有调用点都要显式传入 `pair`**——共约 16 处（`App.vue` 14 处、`useScoreValidation.ts` 1 处，以及引擎内部自调用）。

## 三、引擎接入

### 成交时扣费

在每个开仓/平仓/加仓动作处扣 `fillFee(notional)`：

- maCross：入场一次、出场一次
- turtle：`open()` 一次、`addUnit()` 每加一个单位一次、`close()` 一次
- bollinger：入场一次、出场一次
- grid：`levelPrice(k)` 每格成交一次（同一根 bar 内多格触发则多次计费）
- pivot：入场一次、出场一次

### 逐根累计资金费

在每个引擎已有的 per-bar 循环内，对当根未平仓的头寸计提资金费，写入累计量并从该根权益中扣除。

### 权益自洽（关键约束）

各引擎当前的收益口径本来就不统一：

- maCross `useBacktest.ts:286` 与 turtle 的 `totalReturn` 取自 `capital`（仅已实现盈亏）
- bollinger / grid / pivot 的 `totalReturn` 取自 `equityCurve` 末值（含浮动）
- 全部引擎的 `maxDrawdown` 从 `equityCurve` 计算

因此成本必须**同时进入已实现账本与逐根浮动曲线**：每根 push 进 `equityCurve` 的值都要减去截至该根已累计的成本。否则 `totalReturn` 与曲线对不上，`maxDrawdown` 完全失真。

这与网格策略的敏感性直接相关：止盈一格的毛利约为「区间振幅 / gridCount」，若 20 格则单格约 0.25%，扣掉双边 taker 约 0.1% 后净剩 0.15%，再被资金费吃掉一部分。修成本模型后，grid 的历史收益结论可能反转。

### 类型

`src/types/index.ts` 的 `BacktestResult` 增加两个字段：

```ts
totalFee: number      // 累计手续费（正数）
totalFunding: number  // 累计资金费（正数表示净支出）
```

## 四、展示

`src/tabs/BacktestTab.vue` 汇总区增加一行，展示：

```
手续费 -X.XX USDT / 资金费 -Y.YY USDT
```

`totalReturn` 标注为扣费后净值。成本参数为默认值时不提供开关（本次决定），但字段始终展示，让用户看到成本的绝对量级。

## 五、测试

`freqtrade-webui/package.json` 当前没有测试运行器。本次引入 **vitest**，仅覆盖纯函数模块 `useExecutionCost.ts`：

- `resolveCost`：`BTC-USDT` → `isPerp = false`；`BTC-USDT-SWAP` → `isPerp = true`；override 优先级
- `fillFee`：名义价值 × 费率；现货与永续一致（资金费不混入手续费）
- `fundingAccrual`：现货恒为 0；多头为正、空头为负且绝对值相等；1h 图 8 根 bar 恰等于一个结算周期的费用；不足一个周期按已跨越结算点计提

引擎本身不写单测（5 个引擎的权益计算是内联的，逐个搭测试夹具成本过高）。改为**手算回归**：构造一组固定 K 线，人工推演 2~3 笔交易的净盈亏，与引擎输出逐项对齐。

`package.json` 增加 `"test": "vitest run"`，vitest 作为 devDependency。

## 风险与影响

- **历史回测结果会变化**：grid 策略可能出现收益反转甚至归零。这是预期内的修正，不是回归。
- **调用点改动面广**：约 16 处 `pair` 传递为机械改动，但漏传会导致 SWAP 回测静默不计资金费。实施时需逐一核对，并在实现后检查是否有引擎对 `-SWAP` pair 跑出 `totalFunding === 0` 的情况。
- **前后端费率口径**：本次采用常量 0.0001/8h，不拉取 OKX 真实资金费率历史。多空不对称的主要效应被建模，费率波动未被建模。
