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
