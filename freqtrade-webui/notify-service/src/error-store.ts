import fs from 'node:fs'
import path from 'node:path'

export interface BackendErrorRecord {
  id: string
  timestamp: number
  stage: string
  level: 'info' | 'warning' | 'error' | 'critical'
  message: string
  detail?: string
  stack?: string
  context?: Record<string, unknown>
}

const ERRORS_FILE = path.join(process.cwd(), 'data', 'backend-errors.json')
const MAX_ERRORS = 200

let cache: BackendErrorRecord[] | null = null

function ensureDir() {
  const dir = path.dirname(ERRORS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function loadErrors(): BackendErrorRecord[] {
  if (cache) return cache
  try {
    if (!fs.existsSync(ERRORS_FILE)) {
      cache = []
      return cache
    }
    const raw = fs.readFileSync(ERRORS_FILE, 'utf-8')
    cache = JSON.parse(raw) as BackendErrorRecord[]
  } catch {
    cache = []
  }
  return cache
}

function saveErrors(errors: BackendErrorRecord[]) {
  ensureDir()
  const trimmed = errors.slice(-MAX_ERRORS)
  fs.writeFileSync(ERRORS_FILE, JSON.stringify(trimmed, null, 2), 'utf-8')
  cache = trimmed
}

export function addBackendError(
  stage: string,
  message: string,
  level: BackendErrorRecord['level'] = 'error',
  detail?: string,
  stack?: string,
  context?: Record<string, unknown>,
): BackendErrorRecord {
  const errors = loadErrors()
  const record: BackendErrorRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    stage,
    level,
    message,
    detail,
    stack,
    context,
  }
  errors.push(record)
  if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS)
  saveErrors(errors)
  return record
}

export function getBackendErrors(limit = 50, stage?: string): BackendErrorRecord[] {
  const errors = loadErrors()
  let filtered = errors
  if (stage) filtered = errors.filter((e) => e.stage === stage)
  return filtered.slice(-limit)
}

export function clearBackendErrors(stage?: string) {
  if (stage) {
    const errors = loadErrors().filter((e) => e.stage !== stage)
    saveErrors(errors)
  } else {
    saveErrors([])
  }
}
