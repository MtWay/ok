import assert from 'node:assert/strict'
import { deriveHigherTimeframe, resolveMultiTimeframeConfig } from './scanner.js'

const legacy = resolveMultiTimeframeConfig({ filters: {} as any })
assert.equal(legacy.enabled, false)
assert.equal(legacy.higherTimeframe, '4H')

// The stored higher timeframe is ignored — it always derives from the lower one.
const explicit = resolveMultiTimeframeConfig({
  filters: { multiTimeframe: { enabled: true, higherTimeframe: '1D', lowerTimeframe: '1H', minHigherTrendScore: 70 } } as any,
})
assert.deepEqual(explicit, { enabled: true, higherTimeframe: '4H', lowerTimeframe: '1H', minHigherTrendScore: 70 })

assert.equal(deriveHigherTimeframe('5m'), '15m')
assert.equal(deriveHigherTimeframe('15m'), '1H')
assert.equal(deriveHigherTimeframe('1H'), '4H')
assert.equal(deriveHigherTimeframe('4H'), '1D')
assert.equal(deriveHigherTimeframe('1D'), '1W')
assert.equal(deriveHigherTimeframe('2h'), '4H')

console.log('scanner config regression tests passed')
