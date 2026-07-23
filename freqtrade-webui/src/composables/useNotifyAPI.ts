import type { NotifyTask, ScanHistoryEntry, TradePlan } from '../types'

const API_BASE = import.meta.env.VITE_NOTIFY_API_BASE || 'http://localhost:3031/api/notify'

export function useNotifyAPI() {
  async function getTasks(): Promise<NotifyTask[]> {
    const res = await fetch(`${API_BASE}/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return res.json()
  }

  async function createTask(task: Omit<NotifyTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotifyTask> {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    })
    if (!res.ok) throw new Error('Failed to create task')
    return res.json()
  }

  async function updateTask(id: string, updates: Partial<NotifyTask>): Promise<NotifyTask> {
    const res = await fetch(`${API_BASE}/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    if (!res.ok) throw new Error('Failed to update task')
    return res.json()
  }

  async function deleteTask(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/${id}`, {
      method: 'DELETE'
    })
    if (!res.ok) throw new Error('Failed to delete task')
  }

  async function toggleTask(id: string): Promise<NotifyTask> {
    const res = await fetch(`${API_BASE}/tasks/${id}/toggle`, {
      method: 'POST'
    })
    if (!res.ok) throw new Error('Failed to toggle task')
    return res.json()
  }

  async function triggerTask(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/${id}/trigger`, {
      method: 'POST'
    })
    if (!res.ok) throw new Error('Failed to trigger task')
  }

  async function getScanHistory(taskId: string): Promise<ScanHistoryEntry[]> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/history`)
    if (!res.ok) throw new Error('Failed to fetch scan history')
    return res.json()
  }

  async function getTradePlans(): Promise<TradePlan[]> {
    const res = await fetch(`${API_BASE}/trading/plans`)
    if (!res.ok) throw new Error('Failed to fetch trade plans')
    return res.json()
  }

  async function createTradePlan(input: Omit<TradePlan, 'id' | 'status' | 'executionEnabled' | 'createdAt' | 'updatedAt' | 'notional' | 'margin' | 'maxLoss'>): Promise<TradePlan> {
    const res = await fetch(`${API_BASE}/trading/plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to create trade plan')
    return res.json()
  }

  async function setTradePlanStatus(id: string, status: 'approve' | 'reject'): Promise<TradePlan> {
    const res = await fetch(`${API_BASE}/trading/plans/${id}/${status}`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to update trade plan')
    return res.json()
  }

  async function getTradingStatus(): Promise<unknown> {
    const res = await fetch(`${API_BASE}/trading/status`)
    if (!res.ok) throw new Error('Failed to fetch trading status')
    return res.json()
  }

  async function getTradingSnapshot(): Promise<unknown> {
    const res = await fetch(`${API_BASE}/trading/snapshot`)
    if (!res.ok) throw new Error('Failed to fetch trading snapshot')
    return res.json()
  }

  async function getTradingPositions(): Promise<TradePlan[]> {
    const res = await fetch(`${API_BASE}/trading/positions`)
    if (!res.ok) throw new Error('Failed to fetch trading positions')
    return res.json()
  }

  return {
    getTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask,
    getScanHistory,
    getTradePlans,
    createTradePlan,
    setTradePlanStatus,
    getTradingStatus,
    getTradingSnapshot,
    getTradingPositions
  }
}
