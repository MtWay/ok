import { ref } from 'vue'
import type { HotPairInfo, HotPairsResult } from '../types'

const OKX_API_BASE = 'https://www.okx.com/api/v5'

export function useDynamicPairs() {
  const loading = ref(false)
  const error = ref('')

  async function fetchHotPairs(instType: 'SPOT' | 'SWAP', topN = 20): Promise<HotPairsResult> {
    loading.value = true
    error.value = ''
    try {
      const [tickersRes, instrumentsRes] = await Promise.all([
        fetch(`${OKX_API_BASE}/market/tickers?instType=${instType}`),
        fetch(`${OKX_API_BASE}/public/instruments?instType=${instType}`)
      ])
      if (!tickersRes.ok || !instrumentsRes.ok) {
        throw new Error(`HTTP ${tickersRes.status}/${instrumentsRes.status}`)
      }
      const tickersJson = await tickersRes.json()
      const instrumentsJson = await instrumentsRes.json()
      if (tickersJson.code !== '0') throw new Error(tickersJson.msg || 'tickers 接口失败')
      if (instrumentsJson.code !== '0') throw new Error(instrumentsJson.msg || 'instruments 接口失败')

      const listTimeMap = new Map<string, number>()
      for (const inst of instrumentsJson.data as Array<{ instId: string; listTime: string }>) {
        listTimeMap.set(inst.instId, parseInt(inst.listTime))
      }

      const merged: HotPairInfo[] = (tickersJson.data as Array<{
        instId: string
        last: string
        open24h: string
        volCcy24h: string
      }>)
        .filter(t => listTimeMap.has(t.instId))
        .map(t => {
          const last = parseFloat(t.last)
          const open24h = parseFloat(t.open24h)
          return {
            instId: t.instId,
            last,
            open24h,
            change24h: open24h > 0 ? (last - open24h) / open24h : 0,
            volCcy24h: parseFloat(t.volCcy24h),
            listTime: listTimeMap.get(t.instId)!
          }
        })

      const byVolume = [...merged].sort((a, b) => b.volCcy24h - a.volCcy24h).slice(0, topN)
      const byChange = [...merged].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, topN)
      const byListTime = [...merged].sort((a, b) => b.listTime - a.listTime).slice(0, topN)

      return { byVolume, byChange, byListTime }
    } catch (err) {
      error.value = '获取失败，请重试'
      throw err
    } finally {
      loading.value = false
    }
  }

  return { loading, error, fetchHotPairs }
}
