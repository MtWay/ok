import type { NotifyTask } from '../types'

const API_BASE = 'http://localhost:3031/api/notify'

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

  return {
    getTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask
  }
}
