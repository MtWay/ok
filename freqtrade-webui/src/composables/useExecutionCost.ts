export interface CostParams {
  takerFeeRate: number
  fundingRate8h: number
  fundingIntervalHours: number
  isPerp: boolean
}

export const DEFAULT_COST: CostParams = {
  takerFeeRate: 0.0005,
  fundingRate8h: 0.0001,
  fundingIntervalHours: 8,
  isPerp: false,
}

const HOUR_MS = 3_600_000

export function resolveCost(pair: string, override?: Partial<CostParams>): CostParams {
  return {
    ...DEFAULT_COST,
    isPerp: pair.toUpperCase().endsWith('-SWAP'),
    ...override,
  }
}

export function fillFee(notional: number, c: CostParams): number {
  return Math.abs(notional) * c.takerFeeRate
}

/**
 * 多头返回正数（付出），空头返回负数（收取）。现货恒为 0。
 * 按结算间隔计提：不足一个周期的部分不计，避免高周期图少算。
 */
export function fundingAccrual(
  notional: number,
  barsHeld: number,
  dir: 1 | -1,
  barMs: number,
  c: CostParams
): number {
  if (!c.isPerp || barMs <= 0) return 0
  const periods = Math.floor((barsHeld * barMs) / (c.fundingIntervalHours * HOUR_MS))
  if (periods <= 0) return 0
  const perPeriod = Math.abs(notional) * c.fundingRate8h * (c.fundingIntervalHours / 8)
  return dir === 1 ? perPeriod * periods : -perPeriod * periods
}

const DEFAULT_BAR_MS = 3_600_000

/** dates 为 'YYYY-MM-DD HH:mm:ss' 的 UTC 字符串；取首个有效相邻间隔，无法推导时回退 1h */
export function barMsFromDates(dates: string[]): number {
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(dates[i - 1].replace(' ', 'T') + 'Z')
    const curr = Date.parse(dates[i].replace(' ', 'T') + 'Z')
    if (Number.isFinite(prev) && Number.isFinite(curr) && curr - prev > 0) {
      return curr - prev
    }
  }
  return DEFAULT_BAR_MS
}
