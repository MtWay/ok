import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webuiDir = path.join(root, 'freqtrade-webui')
const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
const node = process.execPath

const services = [
  spawn(yarn, ['dev'], { cwd: webuiDir, stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(node, [path.join(root, 'scripts/start-futures-dryrun.mjs')], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }),
]

let stopping = false
function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  console.log('\n正在停止所有服务...')
  services.forEach((service) => {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(service.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      service.kill('SIGTERM')
    }
  })
  setTimeout(() => process.exit(exitCode), 500)
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

services.forEach((service) => {
  service.on('error', (error) => {
    console.error(`Failed to start development service: ${error.message}`)
    stop(1)
  })
  service.on('exit', (code, signal) => {
    if (!stopping) {
      console.log(`服务退出 (code: ${code}, signal: ${signal})，正在停止其他服务...`)
      stop(code ?? 1)
    }
  })
})
