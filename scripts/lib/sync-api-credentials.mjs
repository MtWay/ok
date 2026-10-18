import { readFile, rename, writeFile } from 'node:fs/promises'

/**
 * 启动时把 notify-service/.env 的 Freqtrade API 凭证同步进本次加载的 config，
 * 避免 dryrun/live 切换后 notify-service 调用 Freqtrade API 401。
 * 与 start-futures-*.sh 内嵌的 python 实现保持同一映射。
 * 只同步非空值；日志只打印字段名，绝不打印值。
 */
export async function syncApiCredentials(configFile, dotenvFile) {
  const MAPPING = {
    FREQTRADE_API_USER: 'username',
    FREQTRADE_API_PASSWORD: 'password',
    FREQTRADE_JWT_SECRET_KEY: 'jwt_secret_key',
    FREQTRADE_WS_TOKEN: 'ws_token',
  }
  let envText
  try { envText = await readFile(dotenvFile, 'utf8') } catch { return }
  const env = {}
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const idx = line.indexOf('=')
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
  }
  const parsed = JSON.parse(await readFile(configFile, 'utf8'))
  const api = parsed.api_server ??= {}
  const changed = []
  for (const [envKey, confKey] of Object.entries(MAPPING)) {
    const value = env[envKey]
    if (value && api[confKey] !== value) {
      api[confKey] = value
      changed.push(confKey)
    }
  }
  if (changed.length === 0) return
  await writeFile(`${configFile}.tmp`, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  await rename(`${configFile}.tmp`, configFile)
  console.log(`Synced api_server fields from .env: ${changed.join(', ')}`)
}
