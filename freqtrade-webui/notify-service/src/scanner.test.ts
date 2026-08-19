import assert from 'node:assert/strict'
import { resolveMultiTimeframeConfig } from './scanner.js'

const legacy = resolveMultiTimeframeConfig({ filters: {} as any })
assert.equal(legacy.enabled, false)
assert.equal(legacy.higherTimeframe, '4H')

const explicit = resolveMultiTimeframeConfig({
  filters: { multiTimeframe: { enabled: true, higherTimeframe: '1D', lowerTimeframe: '1H', minHigherTrendScore: 70 } } as any,
})
assert.deepEqual(explicit, { enabled: true, higherTimeframe: '1D', lowerTimeframe: '1H', minHigherTrendScore: 70 })

console.log('scanner config regression tests passed')
