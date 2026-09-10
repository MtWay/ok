#!/usr/bin/env tsx
/**
 * 对比回测：新旧信号逻辑的系统化验证
 *
 * 用法：
 *   npx tsx src/run-comparison-backtest.ts
 *
 * 输出：
 *   - data/backtest-comparison-YYYYMMDD-HHmmss.json（详细结果）
 *   - 控制台表格（汇总对比）
 */

import { loadTasks } from './storage.js'
import { runTaskBacktest } from './backtest.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface ComparisonResult {
  taskId: string
  taskName: string
  baseline: {
    totalPnl: number
    returnPct: number
    tradeCount: number
    winRate: number
    profitFactor: number
    maxDrawdown: number
  }
  pullback: {
    totalPnl: number
    returnPct: number
    tradeCount: number
    winRate: number
    profitFactor: number
    maxDrawdown: number
  }
  diff: {
    tradeCount: number
    winRate: number
    profitFactor: number
    returnPct: number
  }
}

async function runComparisonBacktest() {
  const tasks = await loadTasks()
  const targetTask = tasks.find(t => t.enabled && t.timeframes.includes('4H'))

  if (!targetTask) {
    console.error('未找到启用的 4H 任务，请先创建一个测试任务')
    process.exit(1)
  }

  const startMs = new Date('2026-01-01').getTime()
  const endMs = new Date('2026-08-31').getTime()

  console.log(`\n[对比回测] 任务: ${targetTask.name}`)
  console.log(`[对比回测] 区间: 2026-01-01 至 2026-08-31\n`)

  // === 基线：旧逻辑（multiTimeframe.enabled=false） ===
  console.log('▶ 运行基线回测（旧逻辑：小周期同向 reversal）...')
  const baselineTask = {
    ...targetTask,
    filters: {
      ...targetTask.filters,
      multiTimeframe: {
        ...targetTask.filters.multiTimeframe,
        enabled: false,
      },
    },
  }
  const baselineResult = await runTaskBacktest(baselineTask, startMs, endMs)
  console.log(`  ✓ 完成: ${baselineResult.summary.tradeCount} 笔交易, 胜率 ${baselineResult.summary.winRate.toFixed(1)}%, 收益 ${baselineResult.summary.returnPct.toFixed(2)}%\n`)

  // === 新方案：顺大势逆小势（pullback entry） ===
  console.log('▶ 运行新方案回测（4H 趋势质量 + 1H 回调入场）...')
  const pullbackTask = {
    ...targetTask,
    filters: {
      ...targetTask.filters,
      multiTimeframe: {
        enabled: true,
        higherTimeframe: '4H',
        lowerTimeframe: '1H',
        minHigherTrendScore: 60,
        minHigherTrendQuality: 60,
        pullbackAtrMin: 0.8,
        useChandelierStop: true,
        chandelierMultiplier: 3.0,
      },
    },
  }
  const pullbackResult = await runTaskBacktest(pullbackTask, startMs, endMs)
  console.log(`  ✓ 完成: ${pullbackResult.summary.tradeCount} 笔交易, 胜率 ${pullbackResult.summary.winRate.toFixed(1)}%, 收益 ${pullbackResult.summary.returnPct.toFixed(2)}%\n`)

  // === 对比分析 ===
  const comparison: ComparisonResult = {
    taskId: targetTask.id,
    taskName: targetTask.name,
    baseline: {
      totalPnl: baselineResult.summary.totalPnl,
      returnPct: baselineResult.summary.returnPct,
      tradeCount: baselineResult.summary.tradeCount,
      winRate: baselineResult.summary.winRate,
      profitFactor: baselineResult.summary.profitFactor,
      maxDrawdown: baselineResult.summary.maxDrawdown,
    },
    pullback: {
      totalPnl: pullbackResult.summary.totalPnl,
      returnPct: pullbackResult.summary.returnPct,
      tradeCount: pullbackResult.summary.tradeCount,
      winRate: pullbackResult.summary.winRate,
      profitFactor: pullbackResult.summary.profitFactor,
      maxDrawdown: pullbackResult.summary.maxDrawdown,
    },
    diff: {
      tradeCount: pullbackResult.summary.tradeCount - baselineResult.summary.tradeCount,
      winRate: pullbackResult.summary.winRate - baselineResult.summary.winRate,
      profitFactor: pullbackResult.summary.profitFactor - baselineResult.summary.profitFactor,
      returnPct: pullbackResult.summary.returnPct - baselineResult.summary.returnPct,
    },
  }

  // === 输出表格 ===
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('                    对比结果汇总')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`指标          │  基线（旧逻辑）│  新方案（回调入场）│  差异`)
  console.log('──────────────┼────────────────┼──────────────────┼──────────')
  console.log(`交易笔数      │  ${String(comparison.baseline.tradeCount).padStart(14)} │  ${String(comparison.pullback.tradeCount).padStart(16)} │  ${comparison.diff.tradeCount >= 0 ? '+' : ''}${comparison.diff.tradeCount}`)
  console.log(`胜率 (%)      │  ${comparison.baseline.winRate.toFixed(1).padStart(14)} │  ${comparison.pullback.winRate.toFixed(1).padStart(16)} │  ${comparison.diff.winRate >= 0 ? '+' : ''}${comparison.diff.winRate.toFixed(1)}`)
  console.log(`盈亏比        │  ${comparison.baseline.profitFactor.toFixed(2).padStart(14)} │  ${comparison.pullback.profitFactor.toFixed(2).padStart(16)} │  ${comparison.diff.profitFactor >= 0 ? '+' : ''}${comparison.diff.profitFactor.toFixed(2)}`)
  console.log(`收益率 (%)    │  ${comparison.baseline.returnPct.toFixed(2).padStart(14)} │  ${comparison.pullback.returnPct.toFixed(2).padStart(16)} │  ${comparison.diff.returnPct >= 0 ? '+' : ''}${comparison.diff.returnPct.toFixed(2)}`)
  console.log(`最大回撤 ($)  │  ${comparison.baseline.maxDrawdown.toFixed(2).padStart(14)} │  ${comparison.pullback.maxDrawdown.toFixed(2).padStart(16)} │  ${(comparison.pullback.maxDrawdown - comparison.baseline.maxDrawdown).toFixed(2)}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // === 结论 ===
  const improved = comparison.diff.winRate > 0 || comparison.diff.profitFactor > 0 || comparison.diff.returnPct > 0
  if (improved) {
    console.log('✓ 新方案优于基线')
    if (comparison.diff.tradeCount < 0) {
      console.log(`  - 信号减少 ${Math.abs(comparison.diff.tradeCount)} 笔（${((comparison.diff.tradeCount / comparison.baseline.tradeCount) * 100).toFixed(1)}%），过滤了低质量信号`)
    }
    if (comparison.diff.winRate > 0) {
      console.log(`  - 胜率提升 ${comparison.diff.winRate.toFixed(1)}%`)
    }
    if (comparison.diff.profitFactor > 0) {
      console.log(`  - 盈亏比提升 ${comparison.diff.profitFactor.toFixed(2)}`)
    }
  } else {
    console.log('✗ 新方案未超越基线，需要调参或重新审视逻辑')
  }

  // === 保存详细结果 ===
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputPath = path.join(__dirname, '../data', `backtest-comparison-${timestamp}.json`)
  await fs.writeFile(outputPath, JSON.stringify({
    comparison,
    baselineResult,
    pullbackResult,
  }, null, 2))
  console.log(`\n详细结果已保存: ${outputPath}\n`)
}

runComparisonBacktest().catch(err => {
  console.error('[对比回测] 失败:', err)
  process.exit(1)
})
