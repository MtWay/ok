import nodemailer from 'nodemailer'
import type { ScanResult } from './types.js'

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
    `${r.pair.padEnd(12)} ${r.timeframe.padEnd(4)} - 评分:${String(r.trendScore).padStart(3)} 盈亏比:${r.riskRewardTight.toFixed(2)} 止损:${r.trailingStopPercent.toFixed(2)}% 方向:${r.direction === 'long' ? '做多' : r.direction === 'short' ? '做空' : '中性'}`
  ).join('\n')

  const subject = `🔥 [${taskName}] 发现 ${results.length} 个高分品种`
  const text = `任务「${taskName}」扫描完成，以下品种满足条件：\n\n${rows}\n\n---\n扫描时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text
    })
    console.log(`[Notifier] Email sent to ${to}`)
  } catch (err) {
    console.error('[Notifier] Failed to send email:', err)
    throw err
  }
}
