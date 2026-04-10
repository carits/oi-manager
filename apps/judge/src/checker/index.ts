/**
 * Checker 实现
 *
 * 支持多种校验器：
 * - default: 默认校验器，忽略行末空格和末尾空行
 * - strict: 严格校验，完全匹配
 * - testlib: testlib 格式校验器
 */

/**
 * 默认校验器
 * 忽略行末空格和末尾空行
 */
export function defaultChecker(
  userOutput: string,
  expectedOutput: string
): { accepted: boolean; message?: string } {
  // 标准化输出：去除行末空格、统一换行符、去除末尾空行
  const normalize = (s: string) => {
    return s
      .replace(/\r\n/g, '\n')          // 统一换行符
      .split('\n')                      // 按行分割
      .map(line => line.trimEnd())      // 去除行末空格
      .join('\n')                       // 重新组合
      .trimEnd()                        // 去除末尾空行
  }

  const normalizedUser = normalize(userOutput)
  const normalizedExpected = normalize(expectedOutput)

  if (normalizedUser === normalizedExpected) {
    return { accepted: true }
  }

  // 提供详细的差异信息
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
): { accepted: boolean; message?: string } {
  if (userOutput === expectedOutput) {
    return { accepted: true }
  }

  // 找出第一个不同的位置
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
 * testlib 格式校验器（简化版）
 *
 * testlib 是竞赛中常用的校验器格式，支持复杂输出检查。
 * 这里实现简化版本，完整版本需要编译用户自定义的 checker.cpp
 */
export function testlibChecker(
  userOutput: string,
  expectedOutput: string,
  input?: string
): { accepted: boolean; message?: string; score?: number } {
  // testlib 校验器需要编译并执行 checker 程序
  // 这里只是占位，实际实现需要：
  // 1. 编译 checker.cpp
  // 2. 执行 ./checker input.in user.out expected.out
  // 3. 解析输出

  // 简化实现：使用默认校验器
  return defaultChecker(userOutput, expectedOutput)
}

/**
 * Lemon 格式校验器
 */
export function lemonChecker(
  userOutput: string,
  expectedOutput: string
): { accepted: boolean; message?: string } {
  // Lemon 格式：忽略多个连续空格，只比较内容
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
): { accepted: boolean; message?: string } {
  // HUSTOJ 格式：忽略所有空白字符差异
  const normalize = (s: string) => {
    return s.replace(/\s+/g, ' ').trim()
  }

  const normalizedUser = normalize(userOutput)
  const normalizedExpected = normalize(expectedOutput)

  if (normalizedUser === normalizedExpected) {
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
): { accepted: boolean; message?: string } {
  // QDUOJ 格式：忽略空白差异，浮点数容忍
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

  // 简单比较
  if (normalizedUser === normalizedExpected) {
    return { accepted: true }
  }

  // 尝试浮点数容忍比较
  const userNums = extractNumbers(normalizedUser)
  const expectedNums = extractNumbers(normalizedExpected)

  if (userNums.length === expectedNums.length && userNums.length > 0) {
    const allMatch = userNums.every((u, i) => {
      const e = expectedNums[i]
      // 相对误差 1e-6
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
): { accepted: boolean; message?: string } {
  // SYZOJ 格式：同默认校验器
  return defaultChecker(userOutput, expectedOutput)
}

/**
 * Kattis 格式校验器
 */
export function kattisChecker(
  userOutput: string,
  expectedOutput: string
): { accepted: boolean; message?: string } {
  // Kattis 格式：浮点数容忍
  const userNums = extractNumbers(userOutput)
  const expectedNums = extractNumbers(expectedOutput)

  if (userNums.length === expectedNums.length && userNums.length > 0) {
    const allMatch = userNums.every((u, i) => {
      const e = expectedNums[i]
      // 相对误差 1e-6
      return Math.abs(u - e) < 1e-6 || Math.abs(u - e) / Math.max(Math.abs(e), 1e-9) < 1e-6
    })

    if (allMatch) {
      return { accepted: true }
    }
  }

  // 回退到默认校验
  return defaultChecker(userOutput, expectedOutput)
}

/**
 * 获取校验器
 */
export function getChecker(type: string) {
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