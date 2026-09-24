import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { atomicWriteJson } from './storage.js'
import type { PositionTask, PositionState } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const POSITION_TASKS_FILE = path.join(__dirname, '../data/position-tasks.json')
const POSITION_STATE_FILE = path.join(__dirname, '../data/position-state.json')

// ---- Position Tasks CRUD ----

export async function loadPositionTasks(): Promise<PositionTask[]> {
  try {
    const data = await fs.readFile(POSITION_TASKS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (err: any) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

export async function savePositionTasks(tasks: PositionTask[]): Promise<void> {
  await atomicWriteJson(POSITION_TASKS_FILE, tasks)
}

export async function getPositionTask(id: string): Promise<PositionTask | undefined> {
  const tasks = await loadPositionTasks()
  return tasks.find(t => t.id === id)
}

export async function createPositionTask(
  data: Omit<PositionTask, 'id' | 'createdAt' | 'updatedAt'>
): Promise<PositionTask> {
  const tasks = await loadPositionTasks()
  const newTask: PositionTask = {
    ...data,
    id: `ptask_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  tasks.push(newTask)
  await savePositionTasks(tasks)
  return newTask
}

export async function updatePositionTask(
  id: string,
  updates: Partial<PositionTask>
): Promise<PositionTask | null> {
  const tasks = await loadPositionTasks()
  const index = tasks.findIndex(t => t.id === id)
  if (index === -1) return null

  tasks[index] = {
    ...tasks[index],
    ...updates,
    id: tasks[index].id,
    createdAt: tasks[index].createdAt,
    updatedAt: Date.now()
  }
  await savePositionTasks(tasks)
  return tasks[index]
}

export async function deletePositionTask(id: string): Promise<boolean> {
  const tasks = await loadPositionTasks()
  const index = tasks.findIndex(t => t.id === id)
  if (index === -1) return false

  tasks.splice(index, 1)
  await savePositionTasks(tasks)
  await deletePositionState(id)
  return true
}

// ---- Position State ----

export async function loadPositionState(): Promise<Record<string, PositionState>> {
  try {
    const data = await fs.readFile(POSITION_STATE_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (err: any) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

export async function getPositionState(taskId: string): Promise<PositionState> {
  const all = await loadPositionState()
  return all[taskId] ?? {
    taskId,
    status: 'flat',
    updatedAt: Date.now()
  }
}

export async function savePositionState(taskId: string, state: PositionState): Promise<void> {
  const all = await loadPositionState()
  all[taskId] = { ...state, updatedAt: Date.now() }
  await atomicWriteJson(POSITION_STATE_FILE, all)
}

export async function deletePositionState(taskId: string): Promise<void> {
  const all = await loadPositionState()
  delete all[taskId]
  await atomicWriteJson(POSITION_STATE_FILE, all)
}
