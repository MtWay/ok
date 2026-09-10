import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'
import { atomicWriteJson } from './storage.js'

/**
 * 实盘信号新鲜度状态（freshness.risingEdge）：
 * 记录每 taskId:pair:tf 上次扫描是否命中，用于上升沿检测
 * （评分达标是"状态"不是"事件"，NIGHT 30 天 15 连亏的根源）。
 *
 * 持久化到 data/signal-state.json，重启服务后状态不丢失。
 * 止损冷却（cooldownAfterStopHours）不在这里——直接从交易计划的
 * closeReason/closedAt 推导，见 scheduler.ts。
 */

interface SignalStateFile {
  matched: Record<string, { prevMatched: boolean; updatedAt: number }>  // key: taskId:pair:tf
}

const __filename = fileURLToPath(import.meta.url)
const STATE_FILE = path.join(path.dirname(__filename), '../data/signal-state.json')

async function loadState(): Promise<SignalStateFile['matched']> {
  try {
    const raw = JSON.parse(await fs.readFile(STATE_FILE, 'utf-8')) as Partial<SignalStateFile>
    return raw.matched ?? {}
  } catch {
    return {}
  }
}

/** 上次是否命中（无记录视为 false——首次命中即上升沿） */
export async function getPrevMatched(taskId: string, pair: string, tf: string): Promise<boolean> {
  const matched = await loadState()
  return matched[`${taskId}:${pair}:${tf}`]?.prevMatched ?? false
}

/** 批量更新本次扫描的命中状态 */
export async function setMatchedBatch(entries: Array<{ taskId: string; pair: string; tf: string; matched: boolean }>): Promise<void> {
  if (entries.length === 0) return
  const matched = await loadState()
  const now = Date.now()
  for (const e of entries) {
    matched[`${e.taskId}:${e.pair}:${e.tf}`] = { prevMatched: e.matched, updatedAt: now }
  }
  await atomicWriteJson(STATE_FILE, { matched })
}
