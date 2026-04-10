/**
 * 评测核心逻辑
 *
 * 处理评测任务：
 * 1. 解析评测配置
 * 2. 编译代码（如果需要）
 * 3. 执行测试点
 * 4. 校验输出
 * 5. 计算分数
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { config } from './config'
import * as sandbox from './sandbox/client'
import { getChecker } from './checker'
import type {
  ProblemConfig,
  JudgeRequest,
  JudgeTaskResult,
  JudgeCaseResult,
  JudgeResult,
  TestCaseConfig,
  SubtaskConfig
} from './types'

/**
 * 执行评测任务
 */
export async function judge(request: JudgeRequest): Promise<JudgeTaskResult> {
  const { submissionId, code, language, config: problemConfig, testdataPath } = request

  console.log(`[Judge] === Starting judge task ===`)
  console.log(`[Judge] submissionId: ${submissionId}`)
  console.log(`[Judge] language: ${language}`)
  console.log(`[Judge] testdataPath: ${testdataPath}`)
  console.log(`[Judge] code length: ${code?.length || 0}`)

  // 解析评测配置
  const cfg = problemConfig || {}
  const timeLimit = parseTime(cfg.time || '1s')
  const memoryLimit = parseMemory(cfg.memory || '256MB')
  const checkerType = cfg.checker_type || 'default'

  console.log(`[Judge] timeLimit: ${timeLimit}ms, memoryLimit: ${memoryLimit}KB`)
  console.log(`[Judge] checkerType: ${checkerType}`)

  // 创建工作目录（编译和执行共用）
  const os = require('os')
  const path = require('path')
  const workDir = path.join(os.tmpdir(), `judge_${submissionId}_${Date.now()}`)
  require('fs').mkdirSync(workDir, { recursive: true })
  console.log(`[Judge] Created work directory: ${workDir}`)

  // 结果
  const cases: JudgeCaseResult[] = []
  let totalTime = 0
  let maxMemory = 0
  let totalScore = 0

  try {
    // 获取测试用例
    console.log(`[Judge] Calling loadTestCases with testdataPath: ${testdataPath}`)
    const testCases = await loadTestCases(testdataPath, cfg)
    console.log(`[Judge] loadTestCases returned ${testCases.length} test cases`)

    if (testCases.length === 0) {
      return {
        submissionId,
        result: 'System Error',
        time: 0,
        memory: 0,
        score: 0,
        cases: [],
        message: '没有找到测试数据'
      }
    }

    // 先编译代码一次
    console.log(`[Judge] Compiling code...`)
    const compileResult = await sandbox.compile({
      language,
      code,
      timeLimit: 15000, // 编译时间限制 15 秒
      memoryLimit: 524288, // 512MB
      workDir
    })

    if (!compileResult.success) {
      console.log(`[Judge] Compilation failed: ${compileResult.error}`)
      return {
        submissionId,
        result: 'Compilation Error',
        time: 0,
        memory: 0,
        score: 0,
        cases: [],
        message: compileResult.error
      }
    }

    console.log(`[Judge] Compilation successful`)

    // 执行每个测试用例
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i]
      const caseTimeLimit = testCase.time ? parseTime(testCase.time) : timeLimit
      const caseMemoryLimit = testCase.memory ? parseMemory(testCase.memory) : memoryLimit
      const caseScore = testCase.score || 0

      console.log(`[Judge] Running case ${i + 1}/${testCases.length}: ${testCase.input}`)

      const caseResult = await runTestCase(
        code,
        language,
        testCase,
        caseTimeLimit,
        caseMemoryLimit,
        checkerType,
        testdataPath,
        workDir
      )

      console.log(`[Judge] Case ${i + 1} result: ${caseResult.result}, time=${caseResult.time}ms, mem=${caseResult.memory}KB`)

      cases.push(caseResult)
      totalTime += caseResult.time
      maxMemory = Math.max(maxMemory, caseResult.memory)

      if (caseResult.result === 'Accepted') {
        totalScore += caseScore
      }

      // 如果不是 Accepted，后续可能需要特殊处理（如子任务）
    }

    console.log(`[Judge] Total: ${cases.length} cases, time=${totalTime}ms, result=${calculateFinalResult(cases)}`)

    // 计算最终结果
    const finalResult = calculateFinalResult(cases)

    return {
      submissionId,
      result: finalResult,
      time: totalTime,
      memory: maxMemory,
      score: totalScore,
      cases
    }
  } catch (e: any) {
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: e.message
    }
  } finally {
    // 清理工作目录
    try {
      require('fs').rmSync(workDir, { recursive: true, force: true })
      console.log(`[Judge] Cleaned up work directory: ${workDir}`)
    } catch {
      // ignore
    }
  }
}

/**
 * 执行单个测试用例
 */
async function runTestCase(
  code: string,
  language: string,
  testCase: TestCaseConfig,
  timeLimit: number,
  memoryLimit: number,
  checkerType: string,
  testdataPath: string,
  workDir: string
): Promise<JudgeCaseResult> {
  console.log(`[Judge] runTestCase: input=${testCase.input}, output=${testCase.output}`)

  // 读取输入
  const inputPath = path.join(testdataPath, testCase.input)
  const outputPath = path.join(testdataPath, testCase.output)

  console.log(`[Judge] Reading input from: ${inputPath}`)
  console.log(`[Judge] Reading output from: ${outputPath}`)

  let input = ''
  let expectedOutput = ''

  try {
    input = fs.readFileSync(inputPath, 'utf-8')
    expectedOutput = fs.readFileSync(outputPath, 'utf-8')
  } catch (e: any) {
    return {
      caseId: 0,
      result: 'System Error',
      time: 0,
      memory: 0,
      message: `无法读取测试数据: ${e.message}`
    }
  }

  // 执行程序
  console.log(`[Judge] Calling sandbox.execute with timeLimit=${timeLimit}ms, memoryLimit=${memoryLimit}KB`)
  const execResult = await sandbox.execute({
    language,
    code,
    stdin: input,
    timeLimit,
    memoryLimit,
    outputLimit: 65536,
    skipCompile: true, // 已在外层编译
    workDir
  })

  console.log(`[Judge] sandbox.execute returned: status=${execResult.status}, time=${execResult.time}ms, memory=${execResult.memory}KB`)

  if (execResult.status !== 'Accepted') {
    return {
      caseId: 0,
      result: execResult.status as JudgeResult,
      time: execResult.time,
      memory: execResult.memory,
      message: execResult.stderr
    }
  }

  // 校验输出
  console.log(`[Judge] Checking output with checker: ${checkerType}`)
  const checker = getChecker(checkerType)
  const checkResult = checker(execResult.stdout || '', expectedOutput)

  console.log(`[Judge] Checker result: accepted=${checkResult.accepted}, message=${checkResult.message}`)

  if (checkResult.accepted) {
    return {
      caseId: 0,
      result: 'Accepted',
      time: execResult.time,
      memory: execResult.memory,
      score: testCase.score
    }
  }

  return {
    caseId: 0,
    result: 'Wrong Answer',
    time: execResult.time,
    memory: execResult.memory,
    message: checkResult.message
  }
}

/**
 * 加载测试用例
 */
async function loadTestCases(
  testdataPath: string,
  config: ProblemConfig
): Promise<TestCaseConfig[]> {
  const cases: TestCaseConfig[] = []

  console.log(`[Judge] Loading test cases from: ${testdataPath}`)

  // 如果配置中有 cases，直接使用
  if (config.cases && config.cases.length > 0) {
    console.log(`[Judge] Using config.cases: ${config.cases.length} cases`)
    return config.cases
  }

  // 如果配置中有 subtasks，展开为 cases
  if (config.subtasks && config.subtasks.length > 0) {
    for (const subtask of config.subtasks) {
      if (subtask.cases) {
        cases.push(...subtask.cases)
      }
    }
    console.log(`[Judge] Using config.subtasks: ${cases.length} cases`)
    return cases
  }

  // 自动扫描测试数据目录
  try {
    console.log(`[Judge] Scanning directory: ${testdataPath}`)
    const files = fs.readdirSync(testdataPath)
    console.log(`[Judge] Found ${files.length} files in directory`)
    const inputFiles = files.filter(f => f.endsWith('.in')).sort()
    console.log(`[Judge] Found ${inputFiles.length} .in files`)

    for (const inputFile of inputFiles) {
      const baseName = inputFile.slice(0, -3) // 去掉 .in
      const outputFile = `${baseName}.out`
      const altOutputFile = `${baseName}.ans`

      // 检查是否存在对应的输出文件
      if (files.includes(outputFile)) {
        cases.push({ input: inputFile, output: outputFile })
      } else if (files.includes(altOutputFile)) {
        cases.push({ input: inputFile, output: altOutputFile })
      }
    }
    console.log(`[Judge] Loaded ${cases.length} test cases`)
  } catch (e: any) {
    console.error(`[Judge] Error scanning directory: ${e.message}`)
  }

  return cases
}

/**
 * 计算最终结果
 */
function calculateFinalResult(cases: JudgeCaseResult[]): JudgeResult {
  if (cases.length === 0) {
    return 'System Error'
  }

  // 检查是否有非 Accepted 的结果
  const results = cases.map(c => c.result)

  // 优先级：Compilation Error > System Error > Runtime Error > Time Limit Exceeded > Memory Limit Exceeded > Wrong Answer > Accepted
  if (results.includes('Compilation Error')) return 'Compilation Error'
  if (results.includes('System Error')) return 'System Error'
  if (results.includes('Runtime Error')) return 'Runtime Error'
  if (results.includes('Time Limit Exceeded')) return 'Time Limit Exceeded'
  if (results.includes('Memory Limit Exceeded')) return 'Memory Limit Exceeded'
  if (results.includes('Output Limit Exceeded')) return 'Output Limit Exceeded'
  if (results.includes('Wrong Answer')) return 'Wrong Answer'
  if (results.includes('Presentation Error')) return 'Presentation Error'

  return 'Accepted'
}

/**
 * 解析时间限制
 * 支持 "1s", "1000ms", "1000000us"
 */
function parseTime(timeStr: string): number {
  const match = timeStr.match(/^(\d+(?:\.\d+)?)(ms|s|us)?$/i)
  if (!match) return 1000

  const value = parseFloat(match[1])
  const unit = (match[2] || 'ms').toLowerCase()

  switch (unit) {
    case 's': return value * 1000
    case 'ms': return value
    case 'us': return value / 1000
    default: return value
  }
}

/**
 * 解析内存限制
 * 支持 "256MB", "1GB", "262144KB"
 */
function parseMemory(memStr: string): number {
  const match = memStr.match(/^(\d+(?:\.\d+)?)(KB|MB|GB)?$/i)
  if (!match) return 262144 // 256MB

  const value = parseFloat(match[1])
  const unit = (match[2] || 'KB').toUpperCase()

  switch (unit) {
    case 'KB': return value
    case 'MB': return value * 1024
    case 'GB': return value * 1024 * 1024
    default: return value
  }
}