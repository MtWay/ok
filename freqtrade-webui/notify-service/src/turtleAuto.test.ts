import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectTurtleWhitelist, diffTurtleAutoTasks, type TurtleWhitelistEntry } from './turtleAutoCore.js'

function e(pair: string, returnPct: number, trades: number): TurtleWhitelistEntry {
  return { pair, returnPct, trades }
}

describe('selectTurtleWhitelist', () => {
  it('交易数过滤 + 收益降序 + topN 截断', () => {
    const entries = [
      e('A', 30, 5), e('B', 50, 2),  // B 交易数不足被过滤
      e('C', 20, 4), e('D', 40, 6), e('E', 10, 3),
    ]
    assert.deepEqual(
      selectTurtleWhitelist(entries, { minTrades: 3, topN: 3 }),
      ['D', 'A', 'C'],
    )
  })

  it('收益为负不入选', () => {
    const entries = [e('A', -5, 10), e('B', 3, 4), e('C', 0, 8)]
    assert.deepEqual(selectTurtleWhitelist(entries, { minTrades: 3, topN: 10 }), ['B'])
  })

  it('空列表/全部不合格 → 空', () => {
    assert.deepEqual(selectTurtleWhitelist([], { minTrades: 3, topN: 10 }), [])
    assert.deepEqual(selectTurtleWhitelist([e('A', 10, 1)], { minTrades: 3, topN: 10 }), [])
  })
})

describe('diffTurtleAutoTasks', () => {
  const managed = [
    { id: 't1', pair: 'A-USDT-SWAP', enabled: true },
    { id: 't2', pair: 'B-USDT-SWAP', enabled: true },
    { id: 't3', pair: 'C-USDT-SWAP', enabled: false },
  ]

  it('新入选创建、掉出且无持仓停用、掉出但有持仓保留', () => {
    const diff = diffTurtleAutoTasks(
      ['A-USDT-SWAP', 'D-USDT-SWAP'],
      managed,
      new Set(['t2']), // B 有持仓
    )
    assert.deepEqual(diff.toCreate, ['D-USDT-SWAP'])
    assert.deepEqual(diff.toDisable, [])        // C 已停用，不重复处理
    assert.deepEqual(diff.keepRunning, ['B-USDT-SWAP'])
  })

  it('掉出且无持仓且仍启用 → 停用', () => {
    const diff = diffTurtleAutoTasks(['A-USDT-SWAP'], managed, new Set())
    assert.deepEqual(diff.toDisable, ['B-USDT-SWAP'])
  })

  it('白名单内已有任务 → 不重复创建', () => {
    const diff = diffTurtleAutoTasks(['A-USDT-SWAP', 'B-USDT-SWAP', 'C-USDT-SWAP'], managed, new Set())
    assert.deepEqual(diff.toCreate, [])
  })
})
