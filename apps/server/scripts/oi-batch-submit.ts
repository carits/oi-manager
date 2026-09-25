/**
 * OI 赛制大规模提交测试脚本
 * 通过 API 批量提交 120 条代码，验证 Hydro-style 队列
 *
 * 用法：npx tsx scripts/oi-batch-submit.ts
 */

import http from 'http'

const API_BASE = 'http://localhost:3002'
const TRAINING_ID = 16
const SUBMIT_COUNT = 120

const STUDENTS = [
  'student9', 'student10', 'student11', 'student12', 'student13',
  'student14', 'student15', 'student16', 'student21', 'student22',
  'student23', 'student24', 'student25',
]

const CORRECT_CODE = `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}`

const WRONG_CODE = `#include <iostream>
using namespace std;
int main() {
    cout << "0" << endl;
    return 0;
}`

function apiRequest(method: string, path: string, token?: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE)
    const data = body ? JSON.stringify(body) : undefined
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = ''
      res.on('data', (c: Buffer) => { buf += c.toString() })
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) }
        catch { reject(new Error(`Invalid JSON: ${buf.substring(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function login(username: string): Promise<string> {
  const res = await apiRequest('POST', '/api/auth/login', undefined, {
    username,
    password: '123456',
    role: 'student',
  })
  if (!res.success) throw new Error(`Login failed for ${username}: ${res.message}`)
  return res.data.token
}

async function getTrainingProblems(token: string): Promise<any[]> {
  const res = await apiRequest('GET', `/api/contests/${TRAINING_ID}/problems`, token)
  if (!res.success) throw new Error(`Get problems failed: ${res.message}`)
  return res.data
}

async function submitCode(token: string, trainingProblemId: string, code: string): Promise<any> {
  return apiRequest('POST', `/api/contests/${TRAINING_ID}/submit`, token, {
    trainingProblemId,
    language: 'cpp',
    code,
    submitMethod: 'batch_test',
  })
}

async function main() {
  console.log('=== OI 赛制批量提交测试 ===')
  console.log(`Training ID: ${TRAINING_ID}, 目标提交数: ${SUBMIT_COUNT}`)

  // 1. 登录所有学生
  console.log('\n[1] 登录学生账号...')
  const tokens: string[] = []
  for (const username of STUDENTS) {
    try {
      const token = await login(username)
      tokens.push(token)
      process.stdout.write('.')
    } catch (e: any) {
      console.log(`\n登录失败: ${username}: ${e.message}`)
    }
  }
  console.log(`\n成功登录 ${tokens.length} 个学生`)

  if (tokens.length === 0) {
    console.error('没有可用的学生账号')
    process.exit(1)
  }

  // 2. 获取训练题目列表（用第一个学生的 token）
  console.log('\n[2] 获取训练题目列表...')
  const problems = await getTrainingProblems(tokens[0])
  console.log(`获取到 ${problems.length} 道题目:`, problems.map((p: any) => p.alias || p.problemId?.substring(0, 8)).join(', '))

  if (problems.length === 0) {
    console.error('训练没有题目')
    process.exit(1)
  }

  // 3. 批量提交
  console.log(`\n[3] 开始批量提交 ${SUBMIT_COUNT} 条...`)
  let success = 0
  let fail = 0

  for (let i = 0; i < SUBMIT_COUNT; i++) {
    const tokenIdx = i % tokens.length
    const probIdx = i % problems.length
    const code = (i % 3 === 0) ? WRONG_CODE : CORRECT_CODE

    try {
      const res = await submitCode(tokens[tokenIdx], problems[probIdx].id, code)
      if (res.success) {
        success++
      } else {
        fail++
        if (fail <= 5) console.log(`  [FAIL] #${i + 1}: ${res.message}`)
      }
    } catch (e: any) {
      fail++
      if (fail <= 5) console.log(`  [ERROR] #${i + 1}: ${e.message}`)
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  进度: ${i + 1}/${SUBMIT_COUNT} (成功: ${success}, 失败: ${fail})`)
    }
  }

  console.log(`\n=== 提交完成 ===`)
  console.log(`成功: ${success}, 失败: ${fail}, 总计: ${SUBMIT_COUNT}`)

  if (fail > 0 && fail <= 5) {
    console.log('提示: 失败可能因为训练未开始（startTime 未到），请等待几分钟后重试')
  }
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
