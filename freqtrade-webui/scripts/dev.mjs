import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const webuiDir = fileURLToPath(new URL('..', import.meta.url))
const notifyDir = fileURLToPath(new URL('../notify-service', import.meta.url))

// Windows 上 spawn .cmd 需要 shell:true；用完整命令串让 PowerShell/cmd 处理引号
// *nix 直接 spawn 可执行文件
function start(cmd, args, cwd) {
  if (process.platform === 'win32') {
    const quoted = [cmd, ...args].map(a => `"${a}"`).join(' ')
    return spawn(quoted, [], { cwd, stdio: 'inherit', shell: true })
  }
  return spawn(cmd, args, { cwd, stdio: 'inherit' })
}

const services = [
  start('yarn', ['vite'], webuiDir),
  start('yarn', ['dev'], notifyDir),
]

let stopping = false
function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  services.forEach((service) => service.kill())
  process.exit(exitCode)
}

services.forEach((service) => {
  service.on('error', (error) => {
    console.error(`Failed to start development service: ${error.message}`)
    stop(1)
  })
  service.on('exit', (code) => stop(code ?? 1))
})

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
