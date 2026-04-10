/**
 * 评测服务本地测试
 *
 * 测试流程：
 * 1. 创建测试代码
 * 2. 执行评测
 * 3. 验证结果
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { judge } from './judge'
import { detectSandboxMode } from './sandbox/client'

async function test() {
  console.log('========================================')
  console.log('评测服务本地测试')
  console.log('========================================')

  // 检测沙箱模式
  await detectSandboxMode()

  // 测试代码：A+B 问题
  const testCode = `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}`

  // 测试数据目录
  const testdataPath = path.join(__dirname, '../../server/testdata/TEST_PROBLEM')

  // 检查测试数据是否存在
  if (!fs.existsSync(testdataPath)) {
    console.error('测试数据目录不存在:', testdataPath)
    process.exit(1)
  }

  console.log('测试数据目录:', testdataPath)
  console.log('测试代码:')
  console.log(testCode)
  console.log('----------------------------------------')

  // 执行评测
  try {
    const result = await judge({
      submissionId: 'test-001',
      problemId: 'TEST_PROBLEM',
      code: testCode,
      language: 'cpp17',
      config: {
        time: '1s',
        memory: '256MB'
      },
      testdataPath
    })

    console.log('评测结果:')
    console.log('  最终结果:', result.result)
    console.log('  总耗时:', result.time, 'ms')
    console.log('  最大内存:', result.memory, 'KB')
    console.log('  得分:', result.score)
    console.log('  测试点详情:')
    for (const c of result.cases) {
      console.log(`    - ${c.result} (${c.time}ms)`)
    }

    if (result.result === 'Accepted') {
      console.log('\n✅ 测试通过！')
    } else {
      console.log('\n❌ 测试失败！')
      if (result.message) {
        console.log('错误信息:', result.message)
      }
    }
  } catch (e: any) {
    console.error('评测执行失败:', e.message)
    process.exit(1)
  }
}

test().catch(console.error)