import nodemailer from 'nodemailer'
import type { ScanResult } from './types.js'
import { buildAutoPlanPrices } from './trading.js'

interface TakeProfitTarget { label: string; price: number; pct: string }

/**
 * 建议止盈位列表：与实际挂单一致（buildAutoPlanPrices 会把 TP1 抬到 ≥2R）。
 * 每项含目标价 + 相对现价的幅度，如 "0.2150 (+3.20%)"。中性方向或数据不全时为空。
 */
export function takeProfitTargets(r: ScanResult): TakeProfitTarget[] {
  if (r.direction === 'neutral' || !r.takeProfit || !r.currentPrice || !r.stopLossTight) return []
  try {
    const prices = buildAutoPlanPrices(r.direction, r.currentPrice, r.stopLossTight, r.takeProfit)
    const fmt = (price: number) => ((price - r.currentPrice) / r.currentPrice * 100)
    return [
      { label: '止盈1', price: prices.takeProfit1, pct: `${fmt(prices.takeProfit1) >= 0 ? '+' : ''}${fmt(prices.takeProfit1).toFixed(2)}%` },
      { label: '止盈2', price: prices.takeProfit2, pct: `${fmt(prices.takeProfit2) >= 0 ? '+' : ''}${fmt(prices.takeProfit2).toFixed(2)}%` },
    ]
  } catch {
    return []
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const DIRECTION_LABEL = { long: '做多', short: '做空', neutral: '中性' } as const
const DIRECTION_COLOR = { long: '#16a34a', short: '#dc2626', neutral: '#6b7280' } as const

function scoreColor(score: number): string {
  if (score >= 75) return '#16a34a'
  if (score >= 60) return '#ca8a04'
  return '#6b7280'
}

function resultCard(r: ScanResult): string {
  const checks = r.ruleChecks || []
  const passed = checks.filter(c => c.passed).length
  const checkRow = (c: (typeof checks)[number]) =>
    `<div style="margin-top:4px"><span style="color:${c.passed ? '#16a34a' : '#dc2626'}">${c.passed ? '✓' : '✗'}</span> ${escapeHtml(c.label)}：${escapeHtml(c.detail)}</div>`
  const checksHtml = checks.length === 0 ? '' : `
      <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e5e7eb;font-size:12px;color:#6b7280">
        规则命中 <b style="color:#374151">${passed}/${checks.length}</b>
        ${checks.map(checkRow).join('')}
      </div>`

  const targets = takeProfitTargets(r)
  const targetsHtml = targets.length === 0
    ? '-'
    : targets.map(t => `${t.label} ${t.price} (<b>${t.pct}</b>)`).join('<br>')

  return `
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <div>
        <span style="font-size:16px;font-weight:700;color:#111827">${escapeHtml(r.pair)}</span>
        <span style="margin-left:8px;font-size:12px;color:#6b7280;background:#f3f4f6;border-radius:4px;padding:2px 6px">${escapeHtml(r.timeframe)}</span>
      </div>
      <span style="font-size:13px;font-weight:600;color:#ffffff;background:${DIRECTION_COLOR[r.direction]};border-radius:12px;padding:3px 12px">${DIRECTION_LABEL[r.direction]}</span>
    </div>
    <table style="width:100%;margin-top:10px;border-collapse:collapse;font-size:13px">
      <tr>
        <td style="padding:4px 0;color:#6b7280;vertical-align:top">趋势评分</td>
        <td style="padding:4px 0;font-weight:700;color:${scoreColor(r.trendScore)};vertical-align:top">${r.trendScore}</td>
        <td style="padding:4px 0;color:#6b7280;vertical-align:top">建议止盈</td>
        <td style="padding:4px 0;font-weight:700;color:#7c3aed;vertical-align:top">${targetsHtml}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#6b7280">盈亏比</td>
        <td style="padding:4px 0;font-weight:600;color:#111827">${r.riskRewardTight.toFixed(2)}</td>
        <td style="padding:4px 0;color:#6b7280">移动止损</td>
        <td style="padding:4px 0;font-weight:600;color:#111827">${r.trailingStopPercent.toFixed(2)}%</td>
      </tr>
    </table>
    ${checksHtml}
  </div>`
}

export function buildHtml(taskName: string, results: ScanResult[], scanTime: string): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="margin-bottom:16px">
      <div style="font-size:20px;font-weight:700;color:#111827">🔥 ${escapeHtml(taskName)}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px">发现 <b style="color:#dc2626">${results.length}</b> 个高分品种 · ${scanTime}</div>
    </div>
    ${results.map(resultCard).join('')}
    <div style="font-size:12px;color:#9ca3af;text-align:center;margin-top:8px">此邮件由自动扫描任务发送，仅供参考，不构成投资建议</div>
  </div>
</body></html>`
}

export async function sendEmail(
  to: string,
  taskName: string,
  results: ScanResult[]
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.example.com',
    port: parseInt(process.env.EMAIL_PORT || '465'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  })

  const rows = results.map(r =>
    `${r.pair.padEnd(12)} ${r.timeframe.padEnd(4)} - 评分:${String(r.trendScore).padStart(3)} 盈亏比:${r.riskRewardTight.toFixed(2)} 止损:${r.trailingStopPercent.toFixed(2)}% 方向:${DIRECTION_LABEL[r.direction]}\n` +
    (takeProfitTargets(r).map(t => `  ${t.label}: ${t.price} (${t.pct})`).join('\n') || '  建议止盈: -') + '\n' +
    (r.ruleChecks || []).map(check => `  ${check.passed ? '✓' : '✗'} ${check.label}: ${check.detail}`).join('\n')
  ).join('\n')

  const scanTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const subject = `🔥 [${taskName}] 发现 ${results.length} 个高分品种`
  const text = `任务「${taskName}」扫描完成，以下品种满足条件：\n\n${rows}\n\n---\n扫描时间: ${scanTime}`
  const html = buildHtml(taskName, results, scanTime)

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
      html
    })
    console.log(`[Notifier] Email sent to ${to}`)
  } catch (err) {
    console.error('[Notifier] Failed to send email:', err)
    throw err
  }
}
