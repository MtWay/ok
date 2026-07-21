import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userdir = path.join(root, 'freqtrade_userdir')
const configPath = path.join(userdir, 'config_okx_futures_dryrun.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))

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

const command = process.platform === 'win32' ? 'freqtrade.exe' : 'freqtrade'
const child = spawn(command, [
  'trade', '--config', configPath, '--strategy', 'OkxFuturesMaCross',
  '--strategy-path', path.join(userdir, 'strategies'),
], { cwd: userdir, stdio: 'inherit', shell: process.platform === 'win32' })

child.on('error', (error) => {
  console.error(`Unable to start Freqtrade: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
