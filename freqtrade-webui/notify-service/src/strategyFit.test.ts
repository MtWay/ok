import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ranks, pearson, spearman, analyzeFit, edgeOf, type FitWindowRecord } from './strategyFit.js'

describe('ranks', () => {
  it('无并列 → 1-based 顺序秩', () => {
    assert.deepEqual(ranks([10, 30, 20]), [1, 3, 2])
  })
  it('并列取平均秩', () => {
    assert.deepEqual(ranks([10, 10, 30]), [1.5, 1.5, 3])
    assert.deepEqual(ranks([5, 5, 5]), [2, 2, 2])
  })
})

describe('pearson', () => {
  it('完全线性 → ±1', () => {
    assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12)
    assert.ok(Math.abs(pearson([1, 2, 3], [6, 4, 2]) + 1) < 1e-12)
  })
  it('零方差 → NaN', () => {
    assert.ok(Number.isNaN(pearson([1, 1, 1], [1, 2, 3])))
  })
})

describe('spearman', () => {
  it('同序 → 1，逆序 → -1', () => {
    assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-12)
    assert.ok(Math.abs(spearman([1, 2, 3, 4], [40, 30, 20, 10]) + 1) < 1e-12)
  })
})

describe('analyzeFit', () => {
  function rec(pair: string, w: number, s2: number, boll: number, osc: number): FitWindowRecord {
    return {
      pair, windowIndex: w, windowStart: w * 1000,
      turtleS1ReturnPct: s2 / 2, turtleS2ReturnPct: s2, turtleTradeCount: 5,
      bollingerReturnPct: boll, bollingerTradeCount: 5,
      oscTotal: osc, oscEr: 0.1, oscAdx: 10, oscAtrPct: 2, oscTouchFreq: 2,
    }
  }

  it('edge = 海龟S2 − 布林', () => {
    assert.equal(edgeOf(rec('A', 0, 5, 2, 50)), 3)
  })

  it('排名跨窗口稳定 + 震荡分负相关 → 两个命题都通过', () => {
    // 3 个品种 × 2 个窗口：edge 排名完全相同（A>B>C），
    // osc 越高 edge 越低（布林相对更优）
    const records = [
      rec('A', 0, 10, 0, 30), rec('B', 0, 5, 3, 60), rec('C', 0, 0, 8, 90),
      rec('A', 1, 8, 1, 30), rec('B', 1, 4, 4, 60), rec('C', 1, -1, 9, 90),
    ]
    const a = analyzeFit(records)
    assert.equal(a.persistenceByWindowPair.length, 1)
    assert.ok(Math.abs(a.persistenceByWindowPair[0].spearman - 1) < 1e-12)
    assert.ok(a.verdict.persistent)
    assert.ok(a.pooledPearson < -0.9, `pooledPearson ${a.pooledPearson}`)
    assert.ok(a.verdict.predictable)
  })

  it('排名跨窗口翻转 → 持久性不通过', () => {
    const records = [
      rec('A', 0, 10, 0, 30), rec('B', 0, 0, 10, 60), rec('C', 0, 5, 5, 90),
      rec('A', 1, 0, 10, 30), rec('B', 1, 10, 0, 60), rec('C', 1, 5, 5, 90),
    ]
    const a = analyzeFit(records)
    assert.ok(a.persistenceByWindowPair[0].spearman < 0)
    assert.ok(!a.verdict.persistent)
  })

  it('osc 与 edge 无关 → 可预测性不通过', () => {
    // osc 与 edge 的配对刻意打乱，使汇总相关非负
    const records = [
      rec('A', 0, 10, 0, 30), rec('B', 0, 5, 5, 90), rec('C', 0, 0, 10, 30),
      rec('A', 1, 10, 0, 90), rec('B', 1, 5, 5, 60), rec('C', 1, 0, 10, 60),
    ]
    const a = analyzeFit(records)
    assert.ok(!a.verdict.predictable, `pooledPearson ${a.pooledPearson}`)
  })
})
