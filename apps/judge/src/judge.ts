/**
 * 评测核心逻辑
 *
 * 处理评测任务：
 * 1. 解析评测配置
 * 2. 编译代码（如果需要）
 * 3. 执行测试点（按子任务分组）
 * 4. 校验输出
 * 5. 计算分数（支持子任务 min/max/sum）
 */

import * as fs from 'fs'
import * as path from 'path'
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
  SubtaskConfig,
  SubtaskResult,
  SubtaskType
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

  // 编译代码
  console.log(`[Judge] Compiling code...`)

  // 本地模式需要 workDir
  let workDir: string | undefined
  if (sandbox.isLocalMode()) {
    workDir = path.join(require('os').tmpdir(), `judge_${submissionId}_${Date.now()}`)
    fs.mkdirSync(workDir, { recursive: true })
  }

  const compileResult = await sandbox.compile({
    language,
    code,
    timeLimit: 15000,
    memoryLimit: 524288,
    workDir
  })

  if (!compileResult.success) {
    console.log(`[Judge] Compilation failed: ${compileResult.error}`)
    cleanupWorkDir(workDir)
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

  console.log(`[Judge] Compilation successful, fileId: ${compileResult.fileId || 'local'}`)

  // 加载测试用例
  const { cases: allCases, subtasks } = loadTestCases(testdataPath, cfg)

  if (allCases.length === 0) {
    cleanupWorkDir(workDir)
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

  console.log(`[Judge] Loaded ${allCases.length} test cases, ${subtasks.length} subtasks`)

  // 结果
  const caseResults: JudgeCaseResult[] = []
  let totalTime = 0
  let maxMemory = 0

  try {
    if (subtasks.length > 0) {
      // 有子任务：按子任务分组评测
      const subtaskResults: SubtaskResult[] = []
      const failedSubtasks: Record<number, boolean> = {}
      let caseIndex = 0

      for (const subtask of subtasks) {
        // 检查子任务依赖：如果依赖的子任务失败，跳过当前子任务
        const deps = subtask.if || []
        const depsFailed = deps.some((depId: number) => failedSubtasks[depId])

        if (depsFailed) {
          // 依赖未通过，跳过此子任务（所有测试点标记为跳过）
          console.log(`[Judge] Subtask ${subtask.id}: skipped (dependency failed)`)
          const subtaskCases = subtask.cases || []
          const skippedResults: JudgeCaseResult[] = subtaskCases.map((_, i) => ({
            caseId: caseIndex + i,
            subtaskId: subtask.id,
            result: 'System Error' as JudgeResult,
            time: 0,
            memory: 0,
            message: '跳过：依赖子任务未通过',
          }))
          caseResults.push(...skippedResults)
          caseIndex += subtaskCases.length
          failedSubtasks[subtask.id || 0] = true
          subtaskResults.push({
            id: subtask.id || 0,
            type: subtask.type || 'min',
            score: 0,
            cases: skippedResults,
          })
          continue
        }

        const subtaskCases = subtask.cases || []
        const subtaskCaseResults: JudgeCaseResult[] = []

        for (let i = 0; i < subtaskCases.length; i++) {
          const testCase = subtaskCases[i]
          const caseTimeLimit = testCase.time ? parseTime(testCase.time) : timeLimit
          const caseMemoryLimit = testCase.memory ? parseMemory(testCase.memory) : memoryLimit

          const caseResult = await runTestCase(
            language,
            testCase,
            caseTimeLimit,
            caseMemoryLimit,
            checkerType,
            testdataPath,
            compileResult.fileId,
            workDir
          )

          caseResult.caseId = caseIndex
          caseResult.subtaskId = subtask.id
          subtaskCaseResults.push(caseResult)
          caseResults.push(caseResult)

          totalTime += caseResult.time
          maxMemory = Math.max(maxMemory, caseResult.memory)

          caseIndex++
        }

        // 计算子任务分数
        const subtaskScore = calculateSubtaskScore(subtaskCaseResults, subtask.type || 'min', subtask.score || 0)
        subtaskResults.push({
          id: subtask.id || 0,
          type: subtask.type || 'min',
          score: subtaskScore,
          cases: subtaskCaseResults
        })

        // 如果子任务未获得满分（对于 min 类型），标记为失败
        if (subtaskScore < (subtask.score || 0)) {
          failedSubtasks[subtask.id || 0] = true
        }

        console.log(`[Judge] Subtask ${subtask.id}: score=${subtaskScore}, type=${subtask.type || 'min'}`)
      }

      // 总分 = 各子任务分数之和
      const totalScore = subtaskResults.reduce((sum, st) => sum + st.score, 0)
      const finalResult = calculateFinalResult(caseResults)

      console.log(`[Judge] Total: ${caseResults.length} cases, time=${totalTime}ms, score=${totalScore}, result=${finalResult}`)

      cleanupWorkDir(workDir)
      // 清理 go-judge 中的编译产物
      if (compileResult.fileId) {
        sandbox.deleteFile(compileResult.fileId).catch(() => {})
      }

      return {
        submissionId,
        result: finalResult,
        time: totalTime,
        memory: maxMemory,
        score: totalScore,
        cases: caseResults,
        subtasks: subtaskResults
      }
    } else {
      // 无子任务：直接逐个评测
      for (let i = 0; i < allCases.length; i++) {
        const testCase = allCases[i]
        const caseTimeLimit = testCase.time ? parseTime(testCase.time) : timeLimit
        const caseMemoryLimit = testCase.memory ? parseMemory(testCase.memory) : memoryLimit
        const caseScore = testCase.score || 0

        const caseResult = await runTestCase(
          language,
          testCase,
          caseTimeLimit,
          caseMemoryLimit,
          checkerType,
          testdataPath,
          compileResult.fileId,
          workDir
        )

        caseResult.caseId = i
        if (caseResult.result === 'Accepted') {
          caseResult.score = caseScore
        }

        caseResults.push(caseResult)
        totalTime += caseResult.time
        maxMemory = Math.max(maxMemory, caseResult.memory)
      }

      // 无子任务时：总分 = Accepted 用例的分数之和
      const totalScore = caseResults.reduce((sum, c) => sum + (c.score || 0), 0)
      const finalResult = calculateFinalResult(caseResults)

      console.log(`[Judge] Total: ${caseResults.length} cases, time=${totalTime}ms, score=${totalScore}, result=${finalResult}`)

      cleanupWorkDir(workDir)
      if (compileResult.fileId) {
        sandbox.deleteFile(compileResult.fileId).catch(() => {})
      }

      return {
        submissionId,
        result: finalResult,
        time: totalTime,
        memory: maxMemory,
        score: totalScore,
        cases: caseResults
      }
    }
  } catch (e: any) {
    cleanupWorkDir(workDir)
    if (compileResult.fileId) {
      sandbox.deleteFile(compileResult.fileId).catch(() => {})
    }
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: caseResults,
      message: e.message
    }
  }
}

/**
 * 执行单个测试用例
 */
async function runTestCase(
  language: string,
  testCase: TestCaseConfig,
  timeLimit: number,
  memoryLimit: number,
  checkerType: string,
  testdataPath: string,
  compileFileId?: string,
  workDir?: string
): Promise<JudgeCaseResult> {
  // 读取输入
  const inputPath = path.join(testdataPath, testCase.input)
  const outputPath = path.join(testdataPath, testCase.output)

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
  const execResult = await sandbox.execute({
    language,
    stdin: input,
    timeLimit,
    memoryLimit,
    outputLimit: 65536,
    compileFileId,
    workDir
  })

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
  const checker = getChecker(checkerType)
  const checkResult = checker(execResult.stdout || '', expectedOutput)

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
 * 加载测试用例（保留子任务分组结构）
 */
function loadTestCases(
  testdataPath: string,
  config: ProblemConfig
): { cases: TestCaseConfig[]; subtasks: (SubtaskConfig & { id: number })[] } {
  const allCases: TestCaseConfig[] = []
  const subtasks: (SubtaskConfig & { id: number })[] = []

  // 如果配置中有 subtasks
  if (config.subtasks && config.subtasks.length > 0) {
    config.subtasks.forEach((st, idx) => {
      const cases = st.cases || []
      const subtask = { ...st, id: st.id || idx + 1, cases }
      subtasks.push(subtask)
      allCases.push(...cases)
    })
    return { cases: allCases, subtasks }
  }

  // 如果配置中有 cases（无子任务分组）
  if (config.cases && config.cases.length > 0) {
    return { cases: config.cases, subtasks: [] }
  }

  // 自动扫描测试数据目录
  try {
    const files = fs.readdirSync(testdataPath)
    const inputFiles = files.filter(f => f.endsWith('.in')).sort()

    for (const inputFile of inputFiles) {
      const baseName = inputFile.slice(0, -3)
      const outputFile = `${baseName}.out`
      const altOutputFile = `${baseName}.ans`

      if (files.includes(outputFile)) {
        allCases.push({ input: inputFile, output: outputFile })
      } else if (files.includes(altOutputFile)) {
        allCases.push({ input: inputFile, output: altOutputFile })
      }
    }
  } catch (e: any) {
    console.error(`[Judge] Error scanning directory: ${e.message}`)
  }

  return { cases: allCases, subtasks: [] }
}

/**
 * 计算子任务分数
 */
function calculateSubtaskScore(
  caseResults: JudgeCaseResult[],
  type: SubtaskType,
  maxScore: number
): number {
  if (caseResults.length === 0) return 0

  switch (type) {
    case 'min': {
      // 取子任务内最小分数（任一用例失败则整个子任务 0 分）
      const allAccepted = caseResults.every(c => c.result === 'Accepted')
      return allAccepted ? maxScore : 0
    }
    case 'max': {
      // 取子任务内最大分数（任一用例通过即得分）
      const anyAccepted = caseResults.some(c => c.result === 'Accepted')
      return anyAccepted ? maxScore : 0
    }
    case 'sum': {
      // 按比例求和
      const totalPossible = caseResults.length
      const acceptedCount = caseResults.filter(c => c.result === 'Accepted').length
      return Math.round(maxScore * acceptedCount / totalPossible)
    }
    default:
      return 0
  }
}

/**
 * 计算最终结果
 */
function calculateFinalResult(cases: JudgeCaseResult[]): JudgeResult {
  if (cases.length === 0) {
    return 'System Error'
  }

  const results = cases.map(c => c.result)

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
 * 清理工作目录
 */
function cleanupWorkDir(workDir?: string) {
  if (!workDir) return
  try {
    fs.rmSync(workDir, { recursive: true, force: true })
    console.log(`[Judge] Cleaned up work directory: ${workDir}`)
  } catch {
    // ignore
  }
}

/**
 * 解析时间限制
 */
function parseTime(timeStr: string | number): number {
  if (typeof timeStr === 'number') return timeStr
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
 */
function parseMemory(memStr: string | number): number {
  if (typeof memStr === 'number') return memStr
  const match = memStr.match(/^(\d+(?:\.\d+)?)(KB|MB|GB)?$/i)
  if (!match) return 262144

  const value = parseFloat(match[1])
  const unit = (match[2] || 'KB').toUpperCase()

  switch (unit) {
    case 'KB': return value
    case 'MB': return value * 1024
    case 'GB': return value * 1024 * 1024
    default: return value
  }
}
