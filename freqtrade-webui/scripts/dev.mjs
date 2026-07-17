import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const webuiDir = fileURLToPath(new URL('..', import.meta.url))
const notifyDir = fileURLToPath(new URL('../notify-service', import.meta.url))
const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'

const services = [
  spawn(yarn, ['vite'], { cwd: webuiDir, stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(yarn, ['dev'], { cwd: notifyDir, stdio: 'inherit', shell: process.platform === 'win32' }),
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
