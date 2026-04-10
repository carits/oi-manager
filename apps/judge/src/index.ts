/**
 * OI Manager Judge Service
 *
 * 评测机服务，连接后端接收评测任务，执行本地评测
 */

import { config } from './config'
import { client } from './client'
import * as sandbox from './sandbox/client'

console.log('========================================')
console.log('OI Manager Judge Service')
console.log('========================================')
console.log(`Judge ID: ${config.judgeId}`)
console.log(`Backend URL: ${config.backendUrl}`)
console.log(`Sandbox Host: ${config.sandboxHost}`)
console.log(`Testdata Dir: ${config.testdataDir}`)
console.log(`Max Concurrent: ${config.maxConcurrent}`)
console.log('========================================')

// 检查沙箱服务
async function checkSandbox() {
  console.log('[Judge] Checking sandbox service...')
  const healthy = await sandbox.healthCheck()
  if (healthy) {
    console.log('[Judge] Sandbox service is available')
  } else {
    console.warn('[Judge] WARNING: Sandbox service is not available!')
    console.warn('[Judge] Please start go-judge before running judge service')
    console.warn('[Judge] Download: https://github.com/criyle/go-judge/releases')
  }
  return healthy
}

// 启动服务
async function start() {
  // 检查沙箱
  await checkSandbox()

  // 连接后端
  client.connect()

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[Judge] Shutting down...')
    client.disconnect()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('\n[Judge] Shutting down...')
    client.disconnect()
    process.exit(0)
  })
}

start().catch(err => {
  console.error('[Judge] Failed to start:', err)
  process.exit(1)
})