import assert from 'node:assert/strict'
import { resolveMultiTimeframeConfig } from './scanner.js'

const legacy = resolveMultiTimeframeConfig({ filters: {} as any })
assert.equal(legacy.enabled, false)
assert.equal(legacy.higherTimeframe, '4H')
assert.equal(legacy.lowerTimeframe, '1H')

// The config passes through as stored; the higher timeframe comes from the
// task's checked 时间周期 at scan time, not from this config.
const explicit = resolveMultiTimeframeConfig({
  filters: { multiTimeframe: { enabled: true, higherTimeframe: '1D', lowerTimeframe: '5m', minHigherTrendScore: 70 } } as any,
})
assert.deepEqual(explicit, { enabled: true, higherTimeframe: '1D', lowerTimeframe: '5m', minHigherTrendScore: 70 })

console.log('scanner config regression tests passed')
