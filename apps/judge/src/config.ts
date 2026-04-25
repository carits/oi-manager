/**
 * 评测机配置
 */

import * as path from 'path'
import * as fs from 'fs'

// 加载 .env 文件
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      const value = match[2].trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  })
}

export const config = {
  // 后端连接
  backendUrl: process.env.BACKEND_URL || 'ws://localhost:3002',

  // 认证 Token（生产环境必须配置）
  judgeToken: process.env.JUDGE_TOKEN || '',

  // 沙箱配置
  sandboxHost: process.env.SANDBOX_HOST || 'http://localhost:5050',

  // 评测机标识
  judgeId: process.env.JUDGE_ID || 'judge-1',

  // 并发配置
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '2', 10),

  // 测试数据目录
  testdataDir: process.env.TESTDATA_DIR || path.join(process.cwd(), '../server/testdata'),

  // 评测超时
  judgeTimeout: parseInt(process.env.JUDGE_TIMEOUT || '60000', 10), // 60s

  // 日志级别
  logLevel: process.env.LOG_LEVEL || 'info'
}