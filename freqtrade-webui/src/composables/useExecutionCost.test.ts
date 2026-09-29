import { describe, expect, test } from 'vitest'
import { resolveCost, fillFee, fundingAccrual, barMsFromDates, DEFAULT_COST } from './useExecutionCost'

const HOUR = 3_600_000

describe('resolveCost', () => {
  test('现货 pair 判定为非永续', () => {
    expect(resolveCost('BTC-USDT').isPerp).toBe(false)
  })

  test('SWAP 后缀 pair 判定为永续', () => {
    expect(resolveCost('BTC-USDT-SWAP').isPerp).toBe(true)
  })

  test('override 可覆盖默认费率', () => {
    const c = resolveCost('BTC-USDT', { takerFeeRate: 0.001 })
    expect(c.takerFeeRate).toBe(0.001)
    expect(c.fundingRate8h).toBe(DEFAULT_COST.fundingRate8h)
  })

  test('override 可强制关闭永续判定', () => {
    expect(resolveCost('BTC-USDT-SWAP', { isPerp: false }).isPerp).toBe(false)
  })
})

describe('fillFee', () => {
  test('按名义价值乘 taker 费率', () => {
    const c = resolveCost('BTC-USDT-SWAP')
    expect(fillFee(10_000, c)).toBeCloseTo(5, 10)
  })

  test('现货与永续的手续费口径一致', () => {
    const spot = resolveCost('BTC-USDT')
    const perp = resolveCost('BTC-USDT-SWAP')
    expect(fillFee(2000, spot)).toBe(fillFee(2000, perp))
  })

  test('零名义价值不产生费用', () => {
    expect(fillFee(0, resolveCost('BTC-USDT'))).toBe(0)
  })
})

describe('fundingAccrual', () => {
  test('现货恒为 0', () => {
    expect(fundingAccrual(10_000, 24, 1, HOUR, resolveCost('BTC-USDT'))).toBe(0)
  })

  test('多头为正（付出），空头为负（收取）且绝对值相等', () => {
    const c = resolveCost('BTC-USDT-SWAP')
    const long = fundingAccrual(10_000, 8, 1, HOUR, c)
    const short = fundingAccrual(10_000, 8, -1, HOUR, c)
    expect(long).toBeGreaterThan(0)
    expect(long).toBeCloseTo(-short, 10)
  })

  test('1h 图 8 根 bar 恰等于一个 8h 结算周期的费用', () => {
    const c = resolveCost('BTC-USDT-SWAP')
    expect(fundingAccrual(10_000, 8, 1, HOUR, c)).toBeCloseTo(1, 10)
  })

  test('不足一个结算周期按 0 计，下一周期才计提', () => {
    const c = resolveCost('BTC-USDT-SWAP')
    expect(fundingAccrual(10_000, 7, 1, HOUR, c)).toBe(0)
    expect(fundingAccrual(10_000, 16, 1, HOUR, c)).toBeCloseTo(2, 10)
  })

  test('日线图每根 bar 跨 24h，含 3 个 8h 结算周期', () => {
    const c = resolveCost('BTC-USDT-SWAP')
    expect(fundingAccrual(10_000, 3, 1, 24 * HOUR, c)).toBeCloseTo(9, 10)
  })

  test('结算间隔改变时每点费用按比例缩放', () => {
    const c = resolveCost('BTC-USDT-SWAP', { fundingIntervalHours: 4 })
    // 每点 = 10000 × 0.0001 × (4/8)，1h 图 4 根 bar 满一个周期
    expect(fundingAccrual(10_000, 4, 1, HOUR, c)).toBeCloseTo(0.5, 10)
  })
})

describe('barMsFromDates', () => {
  test('从 UTC 时间戳推导 1h bar 周期', () => {
    const dates = ['2026-01-01 00:00:00', '2026-01-01 01:00:00', '2026-01-01 02:00:00']
    expect(barMsFromDates(dates)).toBe(HOUR)
  })

  test('从 UTC 时间戳推导日线周期', () => {
    const dates = ['2026-01-01 00:00:00', '2026-01-02 00:00:00']
    expect(barMsFromDates(dates)).toBe(24 * HOUR)
  })

  test('时间戳重复或缺失时回退到 1h', () => {
    expect(barMsFromDates(['2026-01-01 00:00:00', '2026-01-01 00:00:00'])).toBe(HOUR)
    expect(barMsFromDates([])).toBe(HOUR)
  })

  test('跳过时间戳不可解析的前缀，取首个有效间隔', () => {
    const dates = ['bad', '2026-01-01 00:00:00', '2026-01-01 04:00:00']
    expect(barMsFromDates(dates)).toBe(4 * HOUR)
  })
})
