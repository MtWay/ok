import { ref } from 'vue'
import type { HotPairsResult } from '../types'

const API_BASE = import.meta.env.VITE_NOTIFY_API_BASE
  || (import.meta.env.DEV ? 'http://localhost:3031/api/notify' : '/api/notify')

export function useDynamicPairs() {
  const loading = ref(false)
  const error = ref('')

  async function fetchHotPairs(instType: 'SPOT' | 'SWAP', topN = 20): Promise<HotPairsResult> {
    loading.value = true
    error.value = ''
    try {
      const url = `${API_BASE}/pairs/discovery?instType=${instType}&topN=${topN}`
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const result = await res.json() as HotPairsResult
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取失败，请重试'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function searchPairs(keyword: string, instType: 'SPOT' | 'SWAP'): Promise<string[]> {
    const url = `${API_BASE}/pairs/search?keyword=${encodeURIComponent(keyword)}&instType=${instType}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    const data = await res.json() as { results: string[] }
    return data.results
  }

  return { loading, error, fetchHotPairs, searchPairs }
}
