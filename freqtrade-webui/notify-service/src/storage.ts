import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import type { NotifyTask } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TASKS_FILE = path.join(__dirname, '../data/tasks.json')

export async function loadTasks(): Promise<NotifyTask[]> {
  try {
    const data = await fs.readFile(TASKS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, return empty array
      return []
    }
    throw err
  }
}

export async function saveTasks(tasks: NotifyTask[]): Promise<void> {
  // Ensure data directory exists
  const dataDir = path.dirname(TASKS_FILE)
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8')
}

export async function getTask(id: string): Promise<NotifyTask | undefined> {
  const tasks = await loadTasks()
  return tasks.find(t => t.id === id)
}

export async function createTask(task: Omit<NotifyTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotifyTask> {
  const tasks = await loadTasks()
  const newTask: NotifyTask = {
    ...task,
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  tasks.push(newTask)
  await saveTasks(tasks)
  return newTask
}

export async function updateTask(id: string, updates: Partial<NotifyTask>): Promise<NotifyTask | null> {
  const tasks = await loadTasks()
  const index = tasks.findIndex(t => t.id === id)
  if (index === -1) return null

  tasks[index] = {
    ...tasks[index],
    ...updates,
    id: tasks[index].id, // prevent id change
    createdAt: tasks[index].createdAt, // prevent createdAt change
    updatedAt: Date.now()
  }
  await saveTasks(tasks)
  return tasks[index]
}

export async function deleteTask(id: string): Promise<boolean> {
  const tasks = await loadTasks()
  const index = tasks.findIndex(t => t.id === id)
  if (index === -1) return false

  tasks.splice(index, 1)
  await saveTasks(tasks)
  return true
}
