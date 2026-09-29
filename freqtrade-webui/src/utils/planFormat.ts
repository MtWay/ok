import type { TradePlan } from '../types'

export function numberOrZero(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// 已结算记录里 realizedPnl 可能缺失（Freqtrade 没给 close_profit_abs），
// 用「收益率(含杠杆) × 保证金」兜底推导，保证收益额和收益曲线不断档。
// 注意：后端把实际 stake 写在 margin 字段（trading.ts 同步时 margin = stake_amount），
// stakeAmount 并不会下发，所以兜底必须回退到 margin。
export function effectivePnl(position: TradePlan): number | undefined {
  if (Number.isFinite(Number(position.realizedPnl))) return Number(position.realizedPnl)
  const ratio = Number(position.currentProfit)
  const stake = Number(position.stakeAmount ?? position.margin)
  return Number.isFinite(ratio) && Number.isFinite(stake) ? ratio * stake : undefined
}

export function actualProfit(plan: TradePlan): number | undefined {
  if (plan.status === 'closed') return effectivePnl(plan)
  return plan.currentProfitAbs
}

export function statusLabel(status: TradePlan['status']): string {
  return ({ pending: '待审批', approved: '待执行', submitting: '提交中', open: '持仓中', closed: '已平仓', rejected: '已拒绝', expired: '已过期', submit_failed: '执行失败' })[status]
}

export function profitClass(value?: number): string {
  if (numberOrZero(value) > 0) return 'profit'
  if (numberOrZero(value) < 0) return 'loss'
  return 'neutral'
}

export function formatMoney(value?: number): string {
  return value === undefined || !Number.isFinite(Number(value)) ? '--' : Number(value).toFixed(2)
}

export function formatSignedMoney(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}`
}

export function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  const number = Number(value) * 100
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}

export function formatPrice(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  const number = Number(value)
  return number >= 100 ? number.toFixed(2) : number >= 1 ? number.toFixed(4) : number.toFixed(6)
}

export function formatAmount(value?: number): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '--'
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

export function formatTime(timestamp?: number): string {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

export function formatDuration(start?: number, end?: number): string {
  if (!start || !end || end < start) return '--'
  const minutes = Math.floor((end - start) / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

export function closeReasonLabel(reason?: string): string {
  if (!reason) return '--'
  const labels: Record<string, string> = {
    roi: '达到目标收益',
    stop_loss: '触发止损',
    stoploss_on_exchange: '交易所止损',
    trailing_stop_loss: '移动止损',
    exit_signal: '策略离场',
    force_exit: '手动平仓'
  }
  return labels[reason] ?? reason
}
