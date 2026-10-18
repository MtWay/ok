import { describe, expect, test } from 'vitest'
import { runGridBacktest } from './useStrategyEngines'

// 窄幅震荡的 1h K 线：20/80 分位 = 100/100.2，step = 0.05，
// 单格步长 0.05% 盖不住往返手续费+滑点（默认下限 0.3%），不应开仓。
// 与实盘 detectGrid 的 GRID_MIN_STEP_PERCENT 校验保持一致。
function buildTinyStepCandles(): { dates: string[]; data: string[][] } {
  const dates: string[] = []
  const data: string[][] = []
  const base = Date.UTC(2026, 0, 1, 0, 0, 0)
  for (let i = 0; i < 30; i++) {
    dates.push(new Date(base + i * 3_600_000).toISOString().slice(0, 19).replace('T', ' '))
    const close = i % 2 === 0 ? 100 : 100.2
    data.push([
      (close * 1.001).toFixed(8),
      close.toFixed(8),
      (close * 0.99).toFixed(8),
      (close * 1.01).toFixed(8),
      '1000',
    ])
  }
  return { dates, data }
}

describe('网格回测：单格步长预期收益校验', () => {
  const { dates, data } = buildTinyStepCandles()
  const baseOpts = {
    initialCapital: 10000,
    stakeAmount: 1000,
    gridCount: 4,
    lookbackBars: 20,
    trendFilter: false,
    pair: 'BTC-USDT-SWAP',
  }

  test('步长盖不住成本时跳过不开仓', () => {
    const result = runGridBacktest(dates, data, baseOpts)
    expect(result.trades).toBe(0)
  })

  test('显式关掉下限（0）后恢复入场，证明挡单的就是这道校验', () => {
    const result = runGridBacktest(dates, data, { ...baseOpts, minStepPercent: 0 })
    expect(result.trades).toBeGreaterThan(0)
  })
})

// 与实盘对齐后的单持仓语义 + 止损成交价回归测试。
// 场景K线（1h）：前 18 根恒定 100（bounds 步长为 0，不会触发），
// 18/19 根收 100.2 确立 bounds（100~100.2, step 0.05，格位
// L1=100.05 L2=100.10 L3=100.15 L4=100.20），第 20 根低点跌破触发入场。
function buildScenarioCandles(crashBar: number[] | null): { dates: string[]; data: string[][] } {
  const dates: string[] = []
  const data: string[][] = []
  const base = Date.UTC(2026, 0, 1, 0, 0, 0)
  const push = (i: number, row: number[]) => {
    dates.push(new Date(base + i * 3_600_000).toISOString().slice(0, 19).replace('T', ' '))
    data.push(row.map(v => v.toFixed(8)).concat('1000'))
  }
  for (let i = 0; i < 18; i++) push(i, [100, 100, 100, 100])
  push(18, [100.2, 100.2, 100.2, 100.2])
  push(19, [100.2, 100.2, 100.2, 100.2])
  // bar20：prevClose(100.2) > L3(100.15)，低点触及 → 只开 L3 一层（入场 100.15）
  // 高点 100.19 < TP 100.20，当根不平仓
  push(20, [100.2, 100.15, 100.0, 100.19])
  if (crashBar) {
    // bar21：高开后崩盘（开盘价 100.5 高于入场价），跌破止损线 98.147
    push(21, crashBar)
  } else {
    // bar21：prevClose(100.15) > L2(100.10) 且低点触及 L2 —— 持仓未平，不应再开新层
    push(21, [100.15, 100.15, 100.08, 100.18])
    // bar22：高点触及 L3 止盈位 100.20，平仓
    push(22, [100.15, 100.22, 100.15, 100.25])
  }
  return { dates, data }
}

const scenarioOpts = {
  initialCapital: 10000,
  stakeAmount: 1000,
  gridCount: 4,
  lookbackBars: 10,
  trendFilter: false,
  minStepPercent: 0,
  pair: 'BTC-USDT-SWAP',
}

describe('网格回测：单持仓语义与止损成交价（与实盘对齐）', () => {
  test('持仓未平时触及其他格位不再开新层（freqtrade 同品种仅一个持仓）', () => {
    const { dates, data } = buildScenarioCandles(null)
    const result = runGridBacktest(dates, data, scenarioOpts)
    // bar23 触发了 L2，但 bar20 的 L3 仍持有 → 整段只允许 1 笔交易（L3 止盈出场）
    expect(result.trades).toBe(1)
    expect(result.tradesList[0].closeReason).toBe('grid_tp')
  })

  test('高开后崩盘的止损成交于bar低点，不再出现"盈利止损"', () => {
    const { dates, data } = buildScenarioCandles([100.5, 97.2, 97.0, 100.6])
    const result = runGridBacktest(dates, data, scenarioOpts)
    expect(result.trades).toBe(1)
    const t = result.tradesList[0]
    expect(t.closeReason).toBe('grid_stop')
    // 旧实现成交于开盘价 100.5（高于入场价 100.15，不可能成交）；
    // 新实现成交于 bar 低点 97.0
    expect(t.exitPrice).toBeCloseTo(97.0, 6)
    expect(t.pnl).toBeLessThan(0)
  })
})
