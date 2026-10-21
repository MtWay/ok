// 远程服务器优先，本地开发时服务器不可达自动降级到 localhost
// const PRIMARY = 'http://localhost:3031/api/notify'
const PRIMARY = 'https://okex.mtol.online/api/notify'
const LOCAL = 'http://localhost:3031/api/notify'

export const API_BASE: string = import.meta.env.VITE_NOTIFY_API_BASE || PRIMARY
export const API_BASE_FALLBACK: string | null =
  import.meta.env.VITE_NOTIFY_API_BASE ? null : LOCAL

// 网络错误（TypeError / AbortError）时自动降级到本地
export async function fetchWithFallback(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (API_BASE_FALLBACK && err instanceof TypeError) {
      const localUrl = url.replace(API_BASE, API_BASE_FALLBACK)
      console.warn(`[api] 远程不可达，降级到 ${API_BASE_FALLBACK}`)
      return fetch(localUrl, init)
    }
    throw err
  }
}
