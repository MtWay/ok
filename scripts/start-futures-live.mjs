import { spawn, spawnSync } from 'node:child_process'
import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userdir = path.join(root, 'freqtrade_userdir')
const configPath = path.join(userdir, 'config_okx_futures_live.json')
const venvDir = process.env.FREQTRADE_VENV_DIR || path.join(process.env.HOME || '', 'freqtrade-venv')
const freqtradeBin = path.join(venvDir, 'bin', 'freqtrade')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const logDir = path.join(root, 'logs')
const logPath = path.join(logDir, 'freqtrade-live.log')

const checks = {
  dry_run_false: config.dry_run === false,
  trading_mode: config.trading_mode === 'futures',
  margin_mode: config.margin_mode === 'isolated',
  api_listen_localhost: config.api_server?.listen_ip_address === '127.0.0.1',
  has_okx_key: Boolean(config.exchange?.key),
  has_okx_secret: Boolean(config.exchange?.secret),
  has_okx_passphrase: Boolean(config.exchange?.password),
}
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
if (failed.length) {
  console.error(`Refusing to start live bot — missing safety check(s): ${failed.join(', ')}`)
  process.exit(1)
}

try { await access(freqtradeBin) } catch {
  console.error(`Freqtrade virtual environment not found: ${freqtradeBin}`)
  console.error('Run ./install-freqtrade.sh first.')
  process.exit(1)
}

try { await access(path.join(userdir, 'user_data')) } catch {
  await mkdir(path.join(userdir, 'user_data'), { recursive: true })
  const init = spawnSync(commandForPlatform(freqtradeBin), ['create-userdir', '--userdir', userdir], { cwd: userdir, stdio: 'inherit', shell: process.platform === 'win32' })
  if (init.status !== 0) process.exit(init.status || 1)
}

const command = commandForPlatform(freqtradeBin)
const child = spawn(command, [
  'trade', '--userdir', userdir, '--config', configPath, '--strategy', 'OkxFuturesMaCross',
  '--strategy-path', path.join(userdir, 'strategies'),
], {
  cwd: userdir,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    HTTP_PROXY: process.env.HTTP_PROXY || 'http://127.0.0.1:7890',
    HTTPS_PROXY: process.env.HTTPS_PROXY || 'http://127.0.0.1:7890',
    ALL_PROXY: process.env.ALL_PROXY || 'http://127.0.0.1:7890',
    NO_PROXY: process.env.NO_PROXY || '127.0.0.1,localhost',
  },
})

await mkdir(logDir, { recursive: true })
const writeLog = async (chunk) => appendFile(logPath, chunk)
await writeLog(`\n[${new Date().toISOString()}] Starting Freqtrade LIVE — REAL MONEY\n`)
child.stdout.on('data', (chunk) => { process.stdout.write(chunk); void writeLog(chunk) })
child.stderr.on('data', (chunk) => { process.stderr.write(chunk); void writeLog(chunk) })

child.on('error', (error) => {
  console.error(`Unable to start Freqtrade: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  void writeLog(`[${new Date().toISOString()}] Freqtrade live stopped: code=${code} signal=${signal}\n`)
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

function commandForPlatform(binary) {
  return process.platform === 'win32' ? 'freqtrade.exe' : binary
}
