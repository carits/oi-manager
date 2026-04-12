/**
 * Checker 实现
 *
 * 支持多种校验器：
 * - default: 默认校验器，忽略行末空格和末尾空行
 * - strict: 严格校验，完全匹配
 * - testlib: testlib 格式校验器（支持沙箱执行自定义 checker）
 * - lemon/hustoj/qduoj/syzoj/kattis: 其他 OJ 格式校验器
 */

import * as sandbox from '../sandbox/client'

/**
 * 校验结果
 */
export interface CheckerResult {
  accepted: boolean
  message?: string
  score?: number
}

/**
 * 默认校验器
 * 忽略行末空格和末尾空行
 */
export function defaultChecker(
  userOutput: string,
  expectedOutput: string
): CheckerResult {
  const normalize = (s: string) => {
    return s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .trimEnd()
  }

  const normalizedUser = normalize(userOutput)
  const normalizedExpected = normalize(expectedOutput)

  if (normalizedUser === normalizedExpected) {
    return { accepted: true }
  }

  const userLines = normalizedUser.split('\n')
  const expectedLines = normalizedExpected.split('\n')

  if (userLines.length !== expectedLines.length) {
    return {
      accepted: false,
      message: `行数不匹配: 用户输出 ${userLines.length} 行，期望 ${expectedLines.length} 行`
    }
  }

  for (let i = 0; i < userLines.length; i++) {
    if (userLines[i] !== expectedLines[i]) {
      return {
        accepted: false,
        message: `第 ${i + 1} 行不匹配:\n期望: "${expectedLines[i]}"\n实际: "${userLines[i]}"`
      }
    }
  }

  return { accepted: false, message: '输出不匹配' }
}

/**
 * 严格校验器
 * 完全匹配
 */
export function strictChecker(
  userOutput: string,
  expectedOutput: string
): CheckerResult {
  if (userOutput === expectedOutput) {
    return { accepted: true }
  }

  let diffPos = 0
  const minLen = Math.min(userOutput.length, expectedOutput.length)

  while (diffPos < minLen && userOutput[diffPos] === expectedOutput[diffPos]) {
    diffPos++
  }

  const userChar = userOutput[diffPos] || '(EOF)'
  const expectedChar = expectedOutput[diffPos] || '(EOF)'

  return {
    accepted: false,
    message: `位置 ${diffPos} 不匹配: 期望 "${escapeChar(expectedChar)}"，实际 "${escapeChar(userChar)}"`
  }
}

/**
 * testlib 格式校验器
 *
 * 如果有自定义 checker 源码，在沙箱中编译并执行。
 * 否则回退到默认校验器。
 *
 * testlib checker 输出格式：
 * - `ok <message>` → Accepted
 * - `wrong answer <message>` → Wrong Answer
 * - `points <score>\n<message>` → 部分分
 * - 其他 → Runtime Error
 */
export function testlibChecker(
  userOutput: string,
  expectedOutput: string,
  input?: string
): CheckerResult {
  // 没有自定义 checker 时回退到默认校验器
  return defaultChecker(userOutput, expectedOutput)
}

/**
 * 在沙箱中执行 testlib checker
 *
 * @param checkerCode checker.cpp 源代码
 * @param input 输入数据
 * @param expectedOutput 期望输出
 * @param userOutput 用户输出
 */
export async function testlibCheckerSandbox(
  checkerCode: string,
  input: string,
  expectedOutput: string,
  userOutput: string
): Promise<CheckerResult> {
  // 如果不在沙箱模式，回退到默认校验器
  if (sandbox.isLocalMode()) {
    return defaultChecker(userOutput, expectedOutput)
  }

  // 编译 checker
  const compileResult = await sandbox.compile({
    language: 'cpp17',
    code: checkerCode,
    timeLimit: 15000,
    memoryLimit: 524288
  })

  if (!compileResult.success) {
    return { accepted: false, message: `Checker 编译失败: ${compileResult.error}` }
  }

  // 执行 checker
  const execResult = await sandbox.execute({
    language: 'cpp17',
    timeLimit: 30000,
    memoryLimit: 524288,
    outputLimit: 65536,
    compileFileId: compileResult.fileId
  })

  // 清理编译产物
  if (compileResult.fileId) {
    sandbox.deleteFile(compileResult.fileId).catch(() => {})
  }

  if (execResult.status !== 'Accepted') {
    return { accepted: false, message: `Checker 运行失败: ${execResult.stderr}` }
  }

  const output = (execResult.stdout || '').trim()
  return parseTestlibOutput(output)
}

/**
 * 解析 testlib checker 输出
 */
function parseTestlibOutput(output: string): CheckerResult {
  const lines = output.split('\n')
  const firstLine = lines[0].trim().toLowerCase()

  if (firstLine.startsWith('ok')) {
    return { accepted: true, message: lines.slice(1).join('\n') || undefined }
  }

  if (firstLine.startsWith('wrong answer') || firstLine.startsWith('wrong')) {
    return { accepted: false, message: lines.join('\n') }
  }

  if (firstLine.startsWith('points')) {
    const scoreMatch = firstLine.match(/points\s+(\d+(?:\.\d+)?)/)
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0
    return {
      accepted: score > 0,
      score,
      message: lines.slice(1).join('\n') || undefined
    }
  }

  return { accepted: false, message: output || 'Checker 输出无法解析' }
}

/**
 * Lemon 格式校验器
 */
export function lemonChecker(
  userOutput: string,
  expectedOutput: string
): CheckerResult {
  const normalize = (s: string) => {
    return s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim().replace(/\s+/g, ' '))
      .filter(line => line.length > 0)
      .join('\n')
  }

  const normalizedUser = normalize(userOutput)
  const normalizedExpected = normalize(expectedOutput)

  if (normalizedUser === normalizedExpected) {
    return { accepted: true }
  }

  return { accepted: false, message: '输出不匹配（Lemon 格式）' }
}

/**
 * HUSTOJ 格式校验器
 */
export function hustojChecker(
  userOutput: string,
  expectedOutput: string
): CheckerResult {
  const normalize = (s: string) => {
    return s.replace(/\s+/g, ' ').trim()
  }

  if (normalize(userOutput) === normalize(expectedOutput)) {
    return { accepted: true }
  }

  return { accepted: false, message: '输出不匹配（HUSTOJ 格式）' }
}

/**
 * QDUOJ 格式校验器
 */
export function qduojChecker(
  userOutput: string,
  expectedOutput: string
): CheckerResult {
  const normalize = (s: string) => {
    return s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
  }

  const normalizedUser = normalize(userOutput)
  const normalizedExpected = normalize(expectedOutput)

  if (normalizedUser === normalizedExpected) {
    return { accepted: true }
  }

  // 浮点数容忍比较
  const userNums = extractNumbers(normalizedUser)
  const expectedNums = extractNumbers(normalizedExpected)

  if (userNums.length === expectedNums.length && userNums.length > 0) {
    const allMatch = userNums.every((u, i) => {
      const e = expectedNums[i]
      return Math.abs(u - e) < 1e-6 || Math.abs(u - e) / Math.max(Math.abs(e), 1e-9) < 1e-6
    })

    if (allMatch) {
      return { accepted: true }
    }
  }

  return { accepted: false, message: '输出不匹配（QDUOJ 格式）' }
}

/**
 * SYZOJ 格式校验器
 */
export function syzojChecker(
  userOutput: string,
  expectedOutput: string
): CheckerResult {
  return defaultChecker(userOutput, expectedOutput)
}

/**
 * Kattis 格式校验器
 */
export function kattisChecker(
  userOutput: string,
  expectedOutput: string
): CheckerResult {
  const userNums = extractNumbers(userOutput)
  const expectedNums = extractNumbers(expectedOutput)

  if (userNums.length === expectedNums.length && userNums.length > 0) {
    const allMatch = userNums.every((u, i) => {
      const e = expectedNums[i]
      return Math.abs(u - e) < 1e-6 || Math.abs(u - e) / Math.max(Math.abs(e), 1e-9) < 1e-6
    })

    if (allMatch) {
      return { accepted: true }
    }
  }

  return defaultChecker(userOutput, expectedOutput)
}

/**
 * 获取校验器
 */
export function getChecker(type: string): (userOutput: string, expectedOutput: string) => CheckerResult {
  const checkers: Record<string, typeof defaultChecker> = {
    'default': defaultChecker,
    'strict': strictChecker,
    'testlib': testlibChecker,
    'lemon': lemonChecker,
    'hustoj': hustojChecker,
    'qduoj': qduojChecker,
    'syzoj': syzojChecker,
    'kattis': kattisChecker
  }

  return checkers[type] || defaultChecker
}

// ==================== 辅助函数 ====================

function escapeChar(c: string): string {
  if (c === '\n') return '\\n'
  if (c === '\r') return '\\r'
  if (c === '\t') return '\\t'
  if (c === ' ') return '<space>'
  if (c === '(EOF)') return '(EOF)'
  return c
}

function extractNumbers(s: string): number[] {
  const nums: number[] = []
  const regex = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g
  let match

  while ((match = regex.exec(s)) !== null) {
    nums.push(parseFloat(match[0]))
  }

  return nums
}
