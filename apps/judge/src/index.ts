/**
 * OI Manager Judge Service
 *
 * 评测机服务，连接后端接收评测任务，执行本地评测
 */

import { config } from './config'
import { client } from './client'
import * as sandbox from './sandbox/client'
import { disposeHackCompileCache, getHackCompileCacheStats } from './compiled-program-cache'

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
  const healthy = await sandbox.initializeSandbox()
  if (healthy) {
    console.log('[Judge] Sandbox service is available')
  } else {
    console.warn('[Judge] WARNING: Sandbox service is not available; using explicit local fallback')
  }
  return healthy
}

// 启动服务
async function start() {
  // 检查沙箱
  await checkSandbox()

  // 连接后端
  client.connect()

  const cacheMetricsTimer = setInterval(() => {
    console.log('[JudgeMetrics] hack_compile_cache', getHackCompileCacheStats())
  }, 5 * 60_000)
  cacheMetricsTimer.unref()

  // 优雅关闭
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(cacheMetricsTimer)
    console.log('\n[Judge] Shutting down...')
    client.disconnect()
    await disposeHackCompileCache()
    console.log('[Judge] Hack compile cache disposed:', getHackCompileCacheStats())
    process.exit(0)
  }
  process.on('SIGINT', () => { shutdown().catch(error => { console.error(error); process.exit(1) }) })
  process.on('SIGTERM', () => { shutdown().catch(error => { console.error(error); process.exit(1) }) })
}

start().catch(err => {
  console.error('[Judge] Failed to start:', err)
  process.exit(1)
})
