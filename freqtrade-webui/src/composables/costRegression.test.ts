import { describe, expect, test } from 'vitest'
import { useBacktest } from './useBacktest'

const { runBacktestWithParams } = useBacktest()

// 手工构造的 1h K 线：先跌 12 根（MA 预热后快线在慢线下方），
// 再涨 18 根触发金叉，最后跌 10 根触发死叉平仓
function buildCandles(): { dates: string[]; data: string[][] } {
  const dates: string[] = []
  const data: string[][] = []
  const base = Date.UTC(2026, 0, 1, 0, 0, 0)
  let price = 100
  for (let i = 0; i < 40; i++) {
    dates.push(new Date(base + i * 3_600_000).toISOString().slice(0, 19).replace('T', ' '))
    const open = price
    if (i < 12) price = 100 - i
    else if (i < 30) price = 88 + (i - 12)
    else price = 106 - (i - 30)
    const close = price
    data.push([
      open.toFixed(8),
      close.toFixed(8),
      Math.min(open, close).toFixed(8),
      Math.max(open, close).toFixed(8),
      '1000',
    ])
  }
  return { dates, data }
}

const STAKE = 1000

describe('成本回归：手算核对', () => {
  const { dates, data } = buildCandles()

  const spot = runBacktestWithParams(dates, data, 3, 8, 0.5, 0.5, 10000, STAKE, false, false, null, 0, 'BTC-USDT')
  const perp = runBacktestWithParams(dates, data, 3, 8, 0.5, 0.5, 10000, STAKE, false, false, null, 0, 'BTC-USDT-SWAP')

  test('现货不计资金费', () => {
    expect(spot.totalFunding).toBe(0)
    expect(spot.isPerp).toBe(false)
  })

  test('永续的资金费为正（多头付出）', () => {
    expect(perp.isPerp).toBe(true)
    expect(perp.totalFunding!).toBeGreaterThan(0)
  })

  test('永续收益低于现货，差额恰为资金费', () => {
    const gap = spot.totalReturn - perp.totalReturn
    expect(gap).toBeCloseTo(perp.totalFunding! / 10000, 10)
  })

  test('手续费 = 成交笔数 × 单边名义 × 费率，且与现货/永续一致', () => {
    const fills = spot.tradesList.length * 2
    expect(fills).toBeGreaterThan(0)
    expect(spot.totalFee!).toBeCloseTo(fills * STAKE * 0.0005, 8)
    expect(perp.totalFee!).toBeCloseTo(spot.totalFee!, 10)
  })

  test('totalReturn 与 equityCurve 末值自洽', () => {
    const finalEquity = spot.equityCurve[spot.equityCurve.length - 1]
    expect(spot.totalReturn).toBeCloseTo((finalEquity - 10000) / 10000, 10)
  })

  test('曲线末值 = 初始资金 + 已实现盈亏 - 手续费 - 资金费（独立推算）', () => {
    const expectFinal = (r: typeof spot) => {
      const realized = r.tradesList.reduce((s, t) => s + t.pnl * STAKE, 0)
      return 10000 + realized - r.totalFee! - r.totalFunding!
    }
    const spotFinal = spot.equityCurve[spot.equityCurve.length - 1]
    const perpFinal = perp.equityCurve[perp.equityCurve.length - 1]
    expect(spotFinal).toBeCloseTo(expectFinal(spot), 6)
    expect(perpFinal).toBeCloseTo(expectFinal(perp), 6)
  })

  test('成本确实拉低了终值（净额 < 毛额）', () => {
    const spotFinal = spot.equityCurve[spot.equityCurve.length - 1]
    const perpFinal = perp.equityCurve[perp.equityCurve.length - 1]
    expect(spotFinal).toBeGreaterThan(perpFinal)
  })
})
