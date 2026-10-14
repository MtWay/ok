import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import type { NotifyTask, ScanHistoryEntry } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TASKS_FILE = path.join(__dirname, '../data/tasks.json')
const SCAN_HISTORY_FILE = path.join(__dirname, '../data/scan-history.json')

/**
 * 扫描历史按实例分文件：dryrun/live 多实例共享 data 目录时，若共用同一
 * 历史文件，整点批量扫描的并发 read-modify-write 会互相覆盖（后写者用
 * 旧快照整体回写），导致"隔几个小时丢一批记录"。每个实例只写自己的文件，
 * 读取时合并目录下全部 scan-history*.json（含旧版共享文件，向后兼容）。
 */
const INSTANCE_ID = (process.env.SCAN_HISTORY_INSTANCE ?? 'default').replace(/[^\w.-]/g, '_')
const INSTANCE_SCAN_HISTORY_FILE = path.join(__dirname, `../data/scan-history.${INSTANCE_ID}.json`)

const writeQueues = new Map<string, Promise<void>>()

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const queue = writeQueues.get(filePath) ?? Promise.resolve()
  const task = queue.then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmpFile = `${filePath}.tmp`
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmpFile, filePath)
  })
  const queued = task.catch(() => {}).finally(() => {
    if (writeQueues.get(filePath) === queued) writeQueues.delete(filePath)
  })
  writeQueues.set(filePath, queued)
  await task
}

/**
 * 串行化"读-改-写"全过程。atomicWriteJson 只串行写，读发生在队列外：
 * 整点多个任务并发 saveScanHistory 时，所有读都拿到同一旧快照再各自追加，
 * 只有最后一个写入生效，其余条目全部丢失（观察到的"隔几小时丢一批"）。
 * 把读也放进队列后，同一进程内对同一文件的修改严格串行，不再丢条目。
 */
async function mutateJsonFile<T>(filePath: string, mutate: (current: T) => T | Promise<T>, fallback: T): Promise<void> {
  const queue = writeQueues.get(filePath) ?? Promise.resolve()
  const task = queue.then(async () => {
    let current = fallback
    try { current = JSON.parse(await fs.readFile(filePath, 'utf-8')) as T } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
    const next = await mutate(current)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmpFile = `${filePath}.tmp`
    await fs.writeFile(tmpFile, JSON.stringify(next, null, 2), 'utf-8')
    await fs.rename(tmpFile, filePath)
  })
  const queued = task.catch(() => {}).finally(() => {
    if (writeQueues.get(filePath) === queued) writeQueues.delete(filePath)
  })
  writeQueues.set(filePath, queued)
  await task
}

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
  await atomicWriteJson(TASKS_FILE, tasks)
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

export async function loadScanHistory(taskId: string, limit = 30): Promise<ScanHistoryEntry[]> {
  const dir = path.dirname(SCAN_HISTORY_FILE)
  let files: string[] = []
  try {
    files = (await fs.readdir(dir)).filter(f => f.startsWith('scan-history') && f.endsWith('.json'))
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }
  const history: ScanHistoryEntry[] = []
  for (const file of files) {
    try {
      history.push(...JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8')) as ScanHistoryEntry[])
    } catch (err: any) {
      // 某个实例的文件损坏不应拖垮全部历史读取
      if (err.code !== 'ENOENT') console.error(`[Storage] Skipping corrupt scan history file ${file}:`, err.message)
    }
  }
  return history.filter(entry => entry.taskId === taskId).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
}

export async function saveScanHistory(entry: ScanHistoryEntry): Promise<void> {
  await mutateJsonFile<ScanHistoryEntry[]>(INSTANCE_SCAN_HISTORY_FILE, history => [...history, entry].slice(-500), [])
}
