import assert from 'node:assert/strict'
import { RegimeMachine, ENTER_PERIODS, EXIT_PERIODS, sizeFactorForRegime } from './regime.js'
import type { RegimeSignals } from './regime.js'
import type { NotifyTask } from './types.js'

const up: RegimeSignals = { breakoutUpPct: 0.5, breakoutDownPct: 0, btcBreakout: 'up' }
const none: RegimeSignals = { breakoutUpPct: 0.05, breakoutDownPct: 0.05, btcBreakout: null }
const down: RegimeSignals = { breakoutUpPct: 0, breakoutDownPct: 0.5, btcBreakout: 'down' }

// 1) 连续 ENTER_PERIODS 期才从 range 进入趋势
{
  const m = new RegimeMachine()
  for (let i = 0; i < ENTER_PERIODS - 1; i++) assert.equal(m.update(up), 'range')
  assert.equal(m.update(up), 'trend_up')
}

// 2) 抖动不切换：进趋势途中信号中断，计数清零
{
  const m = new RegimeMachine()
  m.update(up)
  m.update(up)
  m.update(none) // 中断
  for (let i = 0; i < ENTER_PERIODS - 1; i++) assert.equal(m.update(up), 'range')
  assert.equal(m.update(up), 'trend_up')
}

// 3) 趋势中信号持续则保持；连续 EXIT_PERIODS 期消失才退出
{
  const m = new RegimeMachine('trend_up')
  assert.equal(m.update(up), 'trend_up')
  for (let i = 0; i < EXIT_PERIODS - 1; i++) assert.equal(m.update(none), 'trend_up')
  assert.equal(m.update(none), 'range')
}

// 4) 反向信号按退出计数处理，不会直接跳到反向趋势
{
  const m = new RegimeMachine('trend_up')
  for (let i = 0; i < EXIT_PERIODS - 1; i++) assert.equal(m.update(down), 'trend_up')
  assert.equal(m.update(down), 'range')
  // 退出后反向信号重新按 ENTER_PERIODS 计数
  for (let i = 0; i < ENTER_PERIODS - 1; i++) assert.equal(m.update(down), 'range')
  assert.equal(m.update(down), 'trend_down')
}

// 5) 广度或 BTC 任一满足即可触发方向
{
  const m = new RegimeMachine()
  const btcOnly: RegimeSignals = { breakoutUpPct: 0, breakoutDownPct: 0, btcBreakout: 'up' }
  for (let i = 0; i < ENTER_PERIODS - 1; i++) assert.equal(m.update(btcOnly), 'range')
  assert.equal(m.update(btcOnly), 'trend_up')
}

// 6) 仓位调节：range 用 sizeRange（默认 0.5），趋势用 sizeTrend（默认 1.5），可配
{
  assert.equal(sizeFactorForRegime('range'), 0.5)
  assert.equal(sizeFactorForRegime('trend_up'), 1.5)
  assert.equal(sizeFactorForRegime('trend_down'), 1.5)
  const task = {
    id: 't', name: 't', enabled: true, email: '', interval: '1h',
    filters: { minTrendScore: 60, minRiskReward: 1.5, maxTrailingStop: 5 },
    pairs: ['*'], timeframes: ['4H'], createdAt: 0, updatedAt: 0,
    regimeRouting: { enabled: true, sizeRange: 0.3, sizeTrend: 2 },
  } as NotifyTask
  assert.equal(sizeFactorForRegime('range', task), 0.3)
  assert.equal(sizeFactorForRegime('trend_up', task), 2)
}

console.log('regime.test.ts: all assertions passed')
