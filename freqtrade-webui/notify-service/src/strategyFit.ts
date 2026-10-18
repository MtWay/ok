/**
 * 品种-策略匹配验证的统计工具（纯函数，可单测）。
 *
 * 两个可证伪命题（见 品种策略匹配讨论记录.md）：
 * 1. 持久性：相邻窗口间"海龟超额收益"排名的 Spearman 相关 > 0.3
 * 2. 可预测性：窗口起点的 oscillation 分数与当窗超额收益负相关
 */

/** 秩次（并列取平均秩），返回与输入同序的秩组 */
export function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const r = new Array<number>(xs.length)
  let j = 0
  while (j < order.length) {
    let k = j
    while (k + 1 < order.length && order[k + 1].v === order[j].v) k++
    const avgRank = (j + k) / 2 + 1 // 1-based 平均秩
    for (let m = j; m <= k; m++) r[order[m].i] = avgRank
    j = k + 1
  }
  return r
}

export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  const denom = Math.sqrt(sxx * syy)
  return denom > 0 ? sxy / denom : NaN
}

/** Spearman 秩相关 = 秩上的 Pearson */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN
  return pearson(ranks(xs), ranks(ys))
}

export interface FitWindowRecord {
  pair: string
  windowIndex: number
  windowStart: number
  turtleS1ReturnPct: number
  turtleS2ReturnPct: number
  turtleTradeCount: number
  bollingerReturnPct: number
  bollingerTradeCount: number
  /** 窗口起点（不含窗口内数据）的 oscillation 评分 */
  oscTotal: number
  oscEr: number
  oscAdx: number
  oscAtrPct: number
  oscTouchFreq: number
}

/** 海龟超额收益：S2（长周期系统，历史回测更优）减布林 */
export function edgeOf(r: FitWindowRecord): number {
  return r.turtleS2ReturnPct - r.bollingerReturnPct
}

export interface FitAnalysis {
  /** 相邻窗口 edge 排名的 Spearman（每对窗口一个值） */
  persistenceByWindowPair: Array<{ windows: [number, number]; spearman: number; pairs: number }>
  meanPersistence: number
  /** 每个窗口内 oscTotal 与 edge 的相关 */
  predictivenessByWindow: Array<{ window: number; pearson: number; spearman: number; pairs: number }>
  /** 全部 品种×窗口 样本汇总 */
  pooledPearson: number
  pooledSpearman: number
  /** osc 各分量与 edge 的汇总相关（找出哪个分量真正有预测力） */
  componentPearson: { er: number; adx: number; atrPct: number; touchFreq: number }
  sampleCount: number
  verdict: { persistent: boolean; predictable: boolean }
}

export const PERSISTENCE_THRESHOLD = 0.3
export const PREDICTABILITY_THRESHOLD = -0.2 // 期望负相关：越震荡布林越优

export function analyzeFit(records: FitWindowRecord[]): FitAnalysis {
  const byWindow = new Map<number, FitWindowRecord[]>()
  for (const r of records) {
    const list = byWindow.get(r.windowIndex) ?? []
    list.push(r)
    byWindow.set(r.windowIndex, list)
  }
  const windowIds = [...byWindow.keys()].sort((a, b) => a - b)

  const persistenceByWindowPair: FitAnalysis['persistenceByWindowPair'] = []
  for (let k = 0; k + 1 < windowIds.length; k++) {
    const a = byWindow.get(windowIds[k])!
    const b = byWindow.get(windowIds[k + 1])!
    const bEdge = new Map(b.map(r => [r.pair, edgeOf(r)]))
    const common = a.filter(r => bEdge.has(r.pair))
    const xs = common.map(r => edgeOf(r))
    const ys = common.map(r => bEdge.get(r.pair)!)
    persistenceByWindowPair.push({
      windows: [windowIds[k], windowIds[k + 1]],
      spearman: spearman(xs, ys),
      pairs: common.length,
    })
  }
  const validP = persistenceByWindowPair.filter(p => Number.isFinite(p.spearman))
  const meanPersistence = validP.length > 0
    ? validP.reduce((s, p) => s + p.spearman, 0) / validP.length
    : NaN

  const predictivenessByWindow: FitAnalysis['predictivenessByWindow'] = windowIds.map(w => {
    const list = byWindow.get(w)!
    return {
      window: w,
      pearson: pearson(list.map(r => r.oscTotal), list.map(edgeOf)),
      spearman: spearman(list.map(r => r.oscTotal), list.map(edgeOf)),
      pairs: list.length,
    }
  })

  const allOsc = records.map(r => r.oscTotal)
  const allEdge = records.map(edgeOf)

  return {
    persistenceByWindowPair,
    meanPersistence,
    predictivenessByWindow,
    pooledPearson: pearson(allOsc, allEdge),
    pooledSpearman: spearman(allOsc, allEdge),
    componentPearson: {
      er: pearson(records.map(r => r.oscEr), allEdge),
      adx: pearson(records.map(r => r.oscAdx), allEdge),
      atrPct: pearson(records.map(r => r.oscAtrPct), allEdge),
      touchFreq: pearson(records.map(r => r.oscTouchFreq), allEdge),
    },
    sampleCount: records.length,
    verdict: {
      persistent: Number.isFinite(meanPersistence) && meanPersistence > PERSISTENCE_THRESHOLD,
      predictable: Number.isFinite(pearson(allOsc, allEdge)) && pearson(allOsc, allEdge) < PREDICTABILITY_THRESHOLD,
    },
  }
}
