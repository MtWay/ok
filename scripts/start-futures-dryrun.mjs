import { spawn, spawnSync } from 'node:child_process'
import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userdir = path.join(root, 'freqtrade_userdir')
const configPath = path.join(userdir, 'config_okx_futures_dryrun.json')
const venvDir = process.env.FREQTRADE_VENV_DIR || path.join(process.env.HOME || '', 'freqtrade-venv')
const freqtradeBin = path.join(venvDir, 'bin', 'freqtrade')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const logDir = path.join(root, 'logs')
const logPath = path.join(logDir, 'freqtrade-dryrun.log')

const checks = {
  dry_run: config.dry_run === true,
  trading_mode: config.trading_mode === 'futures',
  margin_mode: config.margin_mode === 'isolated',
  api_listen: config.api_server?.listen_ip_address === '127.0.0.1',
}
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
if (failed.length) {
  console.error(`Refusing to start unsafe futures config: ${failed.join(', ')}`)
  process.exit(1)
}

try { await access(freqtradeBin) } catch {
  console.error(`Freqtrade virtual environment not found: ${freqtradeBin}`)
  console.error('Run ./install-freqtrade.sh first. The global freqtrade command is intentionally not used.')
  process.exit(1)
}

try { await access(path.join(userdir, 'user_data')) } catch {
  const init = spawnSync(commandForPlatform(freqtradeBin), ['create-userdir', '--userdir', userdir], { cwd: userdir, stdio: 'inherit', shell: process.platform === 'win32' })
  if (init.status !== 0) process.exit(init.status || 1)
}

const command = commandForPlatform(freqtradeBin)
const child = spawn(command, [
  'trade', '--config', configPath, '--strategy', 'OkxFuturesMaCross',
  '--strategy-path', path.join(userdir, 'strategies'),
], { cwd: userdir, stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' })

await mkdir(logDir, { recursive: true })
const writeLog = async (chunk) => appendFile(logPath, chunk)
const startedAt = new Date().toISOString()
await writeLog(`\n[${startedAt}] Starting Freqtrade dry-run\n`)
child.stdout.on('data', (chunk) => { process.stdout.write(chunk); void writeLog(chunk) })
child.stderr.on('data', (chunk) => { process.stderr.write(chunk); void writeLog(chunk) })

child.on('error', (error) => {
  console.error(`Unable to start Freqtrade: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  void writeLog(`[${new Date().toISOString()}] Freqtrade stopped: code=${code} signal=${signal}\n`)
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

function commandForPlatform(binary) {
  return process.platform === 'win32' ? 'freqtrade.exe' : binary
}
