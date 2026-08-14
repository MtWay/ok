import type { NotifyTask, ScanHistoryEntry, TradePlan, ScanDebugEntry, ClearPlansResult } from '../types'

const API_BASE = import.meta.env.VITE_NOTIFY_API_BASE
  || (import.meta.env.DEV ? 'http://localhost:3031/api/notify' : '/api/notify')
const REQUEST_TIMEOUT_MS = 5_000
const MAX_READ_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function isRetryableError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')
}

async function request(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const isRead = (init.method || 'GET').toUpperCase() === 'GET'
  let lastError: unknown

  for (let attempt = 1; attempt <= (isRead ? MAX_READ_ATTEMPTS : 1); attempt++) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (!isRead || response.ok || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_READ_ATTEMPTS) {
        return response
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      if (!isRead || !isRetryableError(error) || attempt === MAX_READ_ATTEMPTS) throw error
    } finally {
      window.clearTimeout(timeout)
    }
    await wait(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed')
}

export function useNotifyAPI() {
  async function getTasks(): Promise<NotifyTask[]> {
    const res = await request(`${API_BASE}/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return res.json()
  }

  async function createTask(task: Omit<NotifyTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotifyTask> {
    const res = await request(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    })
    if (!res.ok) throw new Error('Failed to create task')
    return res.json()
  }

  async function updateTask(id: string, updates: Partial<NotifyTask>): Promise<NotifyTask> {
    const res = await request(`${API_BASE}/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    if (!res.ok) throw new Error('Failed to update task')
    return res.json()
  }

  async function deleteTask(id: string): Promise<void> {
    const res = await request(`${API_BASE}/tasks/${id}`, {
      method: 'DELETE'
    })
    if (!res.ok) throw new Error('Failed to delete task')
  }

  async function toggleTask(id: string): Promise<NotifyTask> {
    const res = await request(`${API_BASE}/tasks/${id}/toggle`, {
      method: 'POST'
    })
    if (!res.ok) throw new Error('Failed to toggle task')
    return res.json()
  }

  async function triggerTask(id: string): Promise<void> {
    const res = await request(`${API_BASE}/tasks/${id}/trigger`, {
      method: 'POST'
    })
    if (!res.ok) throw new Error('Failed to trigger task')
  }

  async function debugScanTask(id: string): Promise<ScanDebugEntry[]> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 300_000)
    try {
      const res = await fetch(`${API_BASE}/tasks/${id}/debug-scan`, {
        method: 'POST',
        signal: controller.signal
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || 'Failed to debug scan task')
      }
      const json = await res.json() as { success: boolean; results: ScanDebugEntry[] }
      return json.results
    } finally {
      window.clearTimeout(timeout)
    }
  }

  async function getScanHistory(taskId: string): Promise<ScanHistoryEntry[]> {
    const res = await request(`${API_BASE}/tasks/${taskId}/history`)
    if (!res.ok) throw new Error('Failed to fetch scan history')
    return res.json()
  }

  async function getTradePlans(): Promise<TradePlan[]> {
    const res = await request(`${API_BASE}/trading/plans`)
    if (!res.ok) throw new Error('Failed to fetch trade plans')
    return res.json()
  }

  async function createTradePlan(input: Omit<TradePlan, 'id' | 'status' | 'executionEnabled' | 'createdAt' | 'updatedAt' | 'notional' | 'margin' | 'maxLoss'>): Promise<TradePlan> {
    const res = await request(`${API_BASE}/trading/plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to create trade plan')
    return res.json()
  }

  async function setTradePlanStatus(id: string, status: 'approve' | 'reject'): Promise<TradePlan> {
    const res = await request(`${API_BASE}/trading/plans/${id}/${status}`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to update trade plan')
    return res.json()
  }

  async function retryTradePlan(id: string): Promise<TradePlan> {
    const res = await request(`${API_BASE}/trading/plans/${id}/retry`, { method: 'POST' })
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to retry trade plan')
    return res.json()
  }

  async function clearTradePlans(): Promise<ClearPlansResult> {
    // Closing open positions server-side can take a while (one forceexit per
    // position), so give this request a longer window than the default 5s.
    const res = await request(`${API_BASE}/trading/plans`, { method: 'DELETE' }, 30_000)
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to clear trade plans')
    return res.json()
  }

  async function getTradingStatus(): Promise<unknown> {
    const res = await request(`${API_BASE}/trading/status`)
    if (!res.ok) throw new Error('Failed to fetch trading status')
    return res.json()
  }

  async function getTradingSnapshot(): Promise<unknown> {
    const res = await request(`${API_BASE}/trading/snapshot`)
    if (!res.ok) throw new Error('Failed to fetch trading snapshot')
    return res.json()
  }

  async function getTradingPositions(): Promise<TradePlan[]> {
    const res = await request(`${API_BASE}/trading/positions`)
    if (!res.ok) throw new Error('Failed to fetch trading positions')
    return res.json()
  }

  async function getTradingHistory(): Promise<TradePlan[]> {
    const res = await request(`${API_BASE}/trading/history`)
    if (!res.ok) throw new Error('Failed to fetch trading history')
    return res.json()
  }

  async function exportTradingDiagnostics(): Promise<Blob> {
    const res = await request(`${API_BASE}/trading/export`)
    if (!res.ok) throw new Error('Failed to export trading diagnostics')
    return res.blob()
  }

  async function getHistoricalDataDownloadStatus(): Promise<{ enabled: boolean; status: string; message?: string }> {
    const res = await request(`${API_BASE}/backtest-data/status`)
    if (!res.ok) throw new Error('Failed to fetch historical-data status')
    return res.json()
  }

  async function downloadHistoricalData(timerange: string): Promise<void> {
    const res = await request(`${API_BASE}/backtest-data/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timerange })
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to start historical-data download')
  }

  return {
    getTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask,
    debugScanTask,
    getScanHistory,
    getTradePlans,
    createTradePlan,
    setTradePlanStatus,
    retryTradePlan,
    clearTradePlans,
    getTradingStatus,
    getTradingSnapshot,
    getTradingPositions,
    getTradingHistory,
    exportTradingDiagnostics
    , getHistoricalDataDownloadStatus,
    downloadHistoricalData
  }
}
