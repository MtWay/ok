export type ErrorStage =
  | 'data-fetch'
  | 'backtest'
  | 'optimize'
  | 'scan'
  | 'validate'
  | 'trend-scan'
  | 'position'
  | 'notify'
  | 'trading'
  | 'grid'
  | 'whitelist'
  | 'strategy'
  | 'system'

export type ErrorLevel = 'info' | 'warning' | 'error' | 'critical'

export interface ErrorRecord {
  id: string
  timestamp: number
  stage: ErrorStage
  level: ErrorLevel
  message: string
  detail?: string
  stack?: string
  context?: Record<string, unknown>
  suggestion: string
  resolved: boolean
}

const STORAGE_KEY = 'error_collector_records'
const MAX_RECORDS = 500

const stageLabels: Record<ErrorStage, string> = {
  'data-fetch': '数据获取',
  'backtest': '回测',
  'optimize': '参数优化',
  'scan': '品种扫描',
  'validate': '滑动窗口验证',
  'trend-scan': '趋势扫描',
  'position': '持仓管理',
  'notify': '通知服务',
  'trading': '交易执行',
  'grid': '网格交易',
  'whitelist': '白名单',
  'strategy': '策略逻辑',
  'system': '系统',
}

const stageSuggestions: Record<ErrorStage, (msg: string) => string> = {
  'data-fetch': (msg) => {
    if (msg.includes('OKX') || msg.includes('429') || msg.includes('rate'))
      return 'OKX API 限流，等待 30 秒后重试，或减少请求频率'
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout'))
      return '网络连接异常，检查代理设置（HTTPS_PROXY）或稍后重试'
    if (msg.includes('parse') || msg.includes('JSON'))
      return '数据解析失败，可能返回格式异常，尝试清除缓存后重试'
    return '检查网络连接和代理配置，确认 OKX API 可访问'
  },
  'backtest': (msg) => {
    if (msg.includes('参数') || msg.includes('param'))
      return '回测参数不合理，检查 maFast/maSlow 范围是否合法'
    if (msg.includes('数据不足') || msg.includes('data'))
      return 'K 线数据不足，增加 limit 或切换更长周期'
    return '检查回测参数和数据完整性，尝试调整参数范围'
  },
  'optimize': (msg) => {
    if (msg.includes('timeout') || msg.includes('超时'))
      return '优化计算超时，缩小参数范围或减少品种数量'
    if (msg.includes('内存') || msg.includes('memory'))
      return '内存不足，减少并行计算数量或刷新页面'
    return '缩小参数网格范围，或分批进行优化'
  },
  'scan': (msg) => {
    if (msg.includes('pair') || msg.includes('品种'))
      return '部分品种数据获取失败，检查品种列表和网络'
    return '检查网络连接，确认所有品种 K 线数据可获取'
  },
  'validate': (msg) => {
    if (msg.includes('窗口') || msg.includes('window'))
      return '验证窗口设置不合理，调整 optimizeWindow/predictWindow 比例'
    return '检查验证参数，确保窗口大小和步长设置正确'
  },
  'trend-scan': (msg) => {
    if (msg.includes('指标') || msg.includes('indicator'))
      return '趋势指标计算异常，检查 ADX/MA 参数'
    return '检查趋势扫描参数和数据质量'
  },
  'position': (msg) => {
    if (msg.includes('API') || msg.includes('freqtrade'))
      return '与 freqtrade API 通信失败，检查 API 服务是否运行（127.0.0.1:8080）'
    if (msg.includes('仓位') || msg.includes('position'))
      return '持仓状态异常，刷新持仓列表或重启 freqtrade'
    return '检查 freqtrade API 连接和持仓状态'
  },
  'notify': (msg) => {
    if (msg.includes('SMTP') || msg.includes('邮件') || msg.includes('email'))
      return '邮件发送失败，检查 SMTP 配置和网络'
    if (msg.includes('API'))
      return '通知服务 API 异常，检查 notify-service 是否运行'
    return '检查通知服务配置和运行状态'
  },
  'trading': (msg) => {
    if (msg.includes('下单') || msg.includes('order'))
      return '下单失败，检查账户余额、交易对状态和 API 权限'
    if (msg.includes('余额') || msg.includes('balance'))
      return '账户余额不足，充值或调整下单金额'
    return '检查交易执行日志，确认 API 权限和账户状态'
  },
  'grid': (msg) => {
    if (msg.includes('网格') || msg.includes('grid'))
      return '网格参数异常，检查网格间距和价格范围'
    return '检查网格交易配置和当前价格状态'
  },
  'whitelist': (msg) => {
    if (msg.includes('同步') || msg.includes('sync'))
      return '白名单同步失败，检查 freqtrade 配置和网络'
    return '检查白名单配置和 freqtrade API 连接'
  },
  'strategy': (msg) => {
    if (msg.includes('信号') || msg.includes('signal'))
      return '策略信号异常，检查指标计算逻辑'
    return '检查策略逻辑和参数配置'
  },
  'system': () => '系统错误，查看详细信息或刷新页面重试',
}

function generateSuggestion(stage: ErrorStage, message: string): string {
  return stageSuggestions[stage]?.(message) ?? '查看详细信息，根据错误内容排查'
}

function loadRecords(): ErrorRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ErrorRecord[]
  } catch {
    return []
  }
}

function saveRecords(records: ErrorRecord[]): void {
  try {
    const trimmed = records.slice(-MAX_RECORDS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch (e) {
    console.warn('[ErrorCollector] 保存失败:', e)
  }
}

let records: ErrorRecord[] = loadRecords()
let listeners: Array<() => void> = []

function notify() {
  listeners.forEach((fn) => fn())
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useErrorCollector() {
  function addError(
    stage: ErrorStage,
    error: unknown,
    context?: Record<string, unknown>,
    level: ErrorLevel = 'error',
  ): ErrorRecord {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    const record: ErrorRecord = {
      id: generateId(),
      timestamp: Date.now(),
      stage,
      level,
      message,
      detail: error instanceof Error ? error.toString() : undefined,
      stack,
      context,
      suggestion: generateSuggestion(stage, message),
      resolved: false,
    }
    records.push(record)
    if (records.length > MAX_RECORDS) {
      records = records.slice(-MAX_RECORDS)
    }
    saveRecords(records)
    notify()
    return record
  }

  function addInfo(stage: ErrorStage, messageOrError: unknown, context?: Record<string, unknown>) {
    const message = messageOrError instanceof Error ? messageOrError.message : String(messageOrError)
    return addError(stage, message, context, 'info')
  }

  function addWarning(stage: ErrorStage, messageOrError: unknown, context?: Record<string, unknown>) {
    const message = messageOrError instanceof Error ? messageOrError.message : String(messageOrError)
    return addError(stage, message, context, 'warning')
  }

  function addCritical(stage: ErrorStage, error: unknown, context?: Record<string, unknown>) {
    return addError(stage, error, context, 'critical')
  }

  function getErrors(): ErrorRecord[] {
    return [...records]
  }

  function getUnresolvedCount(): number {
    return records.filter((r) => !r.resolved).length
  }

  function markResolved(id: string) {
    const r = records.find((x) => x.id === id)
    if (r) {
      r.resolved = true
      saveRecords(records)
      notify()
    }
  }

  function clearErrors(stage?: ErrorStage) {
    if (stage) {
      records = records.filter((r) => r.stage !== stage)
    } else {
      records = []
    }
    saveRecords(records)
    notify()
  }

  function exportJSON(): string {
    return JSON.stringify(records, null, 2)
  }

  function exportCSV(): string {
    const headers = ['时间', '阶段', '级别', '消息', '建议', '状态']
    const rows = records.map((r) => [
      new Date(r.timestamp).toLocaleString('zh-CN'),
      stageLabels[r.stage] ?? r.stage,
      r.level,
      r.message.replace(/"/g, '""'),
      r.suggestion.replace(/"/g, '""'),
      r.resolved ? '已解决' : '未解决',
    ])
    return [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n')
  }

  function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportAsJSON() {
    downloadFile(exportJSON(), `errors-${Date.now()}.json`, 'application/json')
  }

  function exportAsCSV() {
    downloadFile(exportCSV(), `errors-${Date.now()}.csv`, 'text/csv;charset=utf-8')
  }

  function subscribe(fn: () => void): () => void {
    listeners.push(fn)
    return () => {
      listeners = listeners.filter((l) => l !== fn)
    }
  }

  function getStageLabel(stage: ErrorStage): string {
    return stageLabels[stage] ?? stage
  }

  async function fetchBackendErrors(baseUrl: string): Promise<number> {
    try {
      const res = await fetch(`${baseUrl}/api/notify/errors?limit=50`)
      if (!res.ok) return 0
      const data = await res.json()
      const backendErrors = (data.errors ?? []) as Array<{
        timestamp: number
        stage: string
        level: string
        message: string
        detail?: string
        context?: Record<string, unknown>
      }>
      let count = 0
      for (const e of backendErrors) {
        const stage = (e.stage as ErrorStage) || 'system'
        const exists = records.some(
          (r) => r.message === e.message && Math.abs(r.timestamp - e.timestamp) < 5000,
        )
        if (!exists) {
          addError(stage, e.message, e.context, (e.level as ErrorLevel) || 'error')
          count++
        }
      }
      return count
    } catch {
      return 0
    }
  }

  return {
    addError,
    addInfo,
    addWarning,
    addCritical,
    getErrors,
    getUnresolvedCount,
    markResolved,
    clearErrors,
    exportAsJSON,
    exportAsCSV,
    subscribe,
    getStageLabel,
    fetchBackendErrors,
  }
}
