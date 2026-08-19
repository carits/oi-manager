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
import { runCommand as sandboxRunCommand } from './sandbox/client'
import type {
  ProblemConfig,
  JudgeRequest,
  JudgeTaskResult,
  JudgeCaseResult,
  JudgeResult,
  TestCaseConfig,
  SubtaskConfig,
  SubtaskResult,
  SubtaskType,
  JudgeMode
} from './types'

function readCheckerDependencies(testdataPath: string): Record<string, string> {
  const dependencies: Record<string, string> = {}
  const header = path.join(config.checkerIncludeDir, 'testlib.h')
  if (fs.existsSync(header)) dependencies['testlib.h'] = fs.readFileSync(header, 'utf-8')
  return dependencies
}

/**
 * 执行评测任务
 */

function resolveJudgeMode(input: ProblemConfig): JudgeMode {
  
  if (input.mode === 'oi' || input.mode === 'acm') return input.mode
  return input.subtasks && input.subtasks.length > 0 ? 'oi' : 'acm'
}

function normalizeJudgeConfig(input: ProblemConfig): ProblemConfig {
  const config = { ...input } as ProblemConfig & { subtasks?: SubtaskConfig[] }
  const mode = resolveJudgeMode(config)
  config.mode = mode
  if (mode === 'acm' && !config.cases?.length && config.subtasks?.length) {
    const seen = new Set<string>()
    config.cases = config.subtasks
      .flatMap(subtask => subtask.cases || [])
      .filter(testCase => {
        const key = `${testCase.input}\0${testCase.output}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }
  if (mode === 'acm') {
    delete config.subtasks
    if (config.cases) config.cases = config.cases.map(testCase => ({ ...testCase, score: undefined }))
  }
  return config
}

function acmScore(result: JudgeResult): number {
  return result === 'Accepted' ? 100 : 0
}

export async function judge(request: JudgeRequest): Promise<JudgeTaskResult> {
  const { submissionId, code, language, config: problemConfig, testdataPath } = request

  console.log(`[Judge] === Starting judge task ===`)
  console.log(`[Judge] submissionId: ${submissionId}`)
  console.log(`[Judge] language: ${language}`)
  console.log(`[Judge] testdataPath: ${testdataPath}`)
  console.log(`[Judge] code length: ${code?.length || 0}`)

  const rawConfig = problemConfig || {}
  const cfg = normalizeJudgeConfig(rawConfig)
  const judgeMode = cfg.mode || 'acm'
  const timeLimit = parseTime((cfg as any).time || (cfg as any).timeLimit || '1s')
  const memoryLimit = parseMemory((cfg as any).memory || (cfg as any).memoryLimit || '256MB')
  let checkerType = (cfg as any).checker_type || 'default'
  const filename = (cfg as any).filename || undefined
  const ignoreTrailingSpace = (cfg as any).ignore_trailing_space !== false // 默认 true

  // Lemon 的 score/message 协议用于 OI 部分分；ACM 只接受布尔判定型 checker。
  if (judgeMode === 'acm' && String(checkerType).toLowerCase() === 'lemon') {
    return {
      submissionId, result: 'System Error', time: 0, cpuTime: 0, wallTime: 0, memory: 0, score: 0, cases: [],
      message: 'ACM 赛制不支持 Lemon checker，请使用 testlib 或其他判定型 checker'
    }
  }

  // 如果 checker_type 为 default 且 ignore_trailing_space 为 false，使用 strict checker
  if (checkerType === 'default' && !ignoreTrailingSpace) {
    checkerType = 'strict'
  }

  console.log(`[Judge] timeLimit: ${timeLimit}ms, memoryLimit: ${memoryLimit}KB`)
  console.log(`[Judge] checkerType: ${checkerType}, ignoreTrailingSpace: ${ignoreTrailingSpace}`)
  if (filename) {
    console.log(`[Judge] FileIO mode: ${filename}.in / ${filename}.out`)
  }

  // 语言限制检查
  if (cfg.langs && cfg.langs.length > 0 && !cfg.langs.includes(language)) {
    console.log(`[Judge] Language ${language} not allowed, allowed: ${cfg.langs.join(',')}`)
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      cpuTime: 0,
      wallTime: 0,
      memory: null,
      score: 0,
      cases: [],
      message: `不允许的编程语言: ${language}。允许的语言: ${cfg.langs.join(', ')}`
    }
  }

  // 题目类型分发 — 根据题目类型路由到不同的评测函数
  if (cfg.type === 'interactive') {
    console.log(`[Judge] Routing to interactive problem judge`)
    return await judgeInteractive({ language, code, problemConfig: cfg, testdataPath, submissionId })
  }
  if (cfg.type === 'communication') {
    console.log(`[Judge] Routing to communication problem judge`)
    return await judgeCommunication({ language, code, problemConfig: cfg, testdataPath, submissionId })
  }
  if (cfg.type === 'submit_answer') {
    console.log(`[Judge] Routing to submit answer problem judge`)
    return await judgeSubmitAnswer({ code, problemConfig: cfg, testdataPath, submissionId })
  }

  // default / objective / 未指定：继续使用原有评测流程

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
    timeLimit: 60000,
    memoryLimit: 524288,
    workDir
  })

  if (compileResult.workDir) {
    workDir = compileResult.workDir
  }

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

  // 解析 Checker 配置 — 前端可能传 { file: "checker.cpp", lang: "cpp17" } 或纯文件名字符串
  // 需要从 testdata 目录读取 checker 源码
  let checkerCode: string | undefined
  let checkerLang: string | undefined
  if (cfg.checker) {
    if (typeof cfg.checker === 'string') {
      // 纯文件名字符串
      const checkerPath = path.join(testdataPath, cfg.checker)
      try {
        checkerCode = fs.readFileSync(checkerPath, 'utf-8')
        console.log(`[Judge] Read checker source from ${cfg.checker} (${checkerCode.length} bytes)`)
      } catch (e: any) {
        console.log(`[Judge] Cannot read checker file ${cfg.checker}: ${e.message}`)
      }
    } else if (cfg.checker.file) {
      // { file: "checker.cpp", lang: "cpp17" } 格式
      const checkerPath = path.join(testdataPath, cfg.checker.file)
      try {
        checkerCode = fs.readFileSync(checkerPath, 'utf-8')
        checkerLang = cfg.checker.lang || cfg.checker.language
        console.log(`[Judge] Read checker source from ${cfg.checker.file} (${checkerCode.length} bytes), lang=${checkerLang || 'auto'}`)
      } catch (e: any) {
        console.log(`[Judge] Cannot read checker file ${cfg.checker.file}: ${e.message}`)
      }
    } else if (cfg.checker.code) {
      checkerCode = cfg.checker.code
      checkerLang = cfg.checker.language
    }
  }

  // Configured sandbox checkers are mandatory; never silently fall back.
  if (!['default', 'strict'].includes(checkerType) && !checkerCode) {
    cleanupWorkDir(workDir)
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      cpuTime: 0,
      wallTime: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: 'Checker 配置无效或源码不可读: ' + String((cfg as any).checker || checkerType)
    }
  }

  // 编译自定义 Checker（如果配置了 checker 源码且 checker 类型需要沙箱执行）
  const needsSandboxChecker = !['default', 'strict'].includes(checkerType) && checkerCode
  let checkerCtx: CheckerContext = {
    type: checkerType,
    jsChecker: getChecker(checkerType)
  }
  let checkerWorkDirToCleanup: string | undefined

  if (needsSandboxChecker && checkerCode) {
    console.log(`[Judge] Compiling custom checker (type=${checkerType})...`)
    const checkerCompileResult = await sandbox.compile({
      language: checkerLang || 'cpp17',
      code: checkerCode,
      timeLimit: 60000,
      memoryLimit: 524288,
      extraCopyIn: readCheckerDependencies(testdataPath),
    })

    if (checkerCompileResult.success) {
      console.log(`[Judge] Checker compiled: fileId=${checkerCompileResult.fileId || 'local'}`)
      checkerCtx = {
        type: checkerType,
        checkerFileId: checkerCompileResult.fileId,
        checkerWorkDir: checkerCompileResult.workDir,
      }
      checkerWorkDirToCleanup = checkerCompileResult.workDir
    } else {
      console.log(`[Judge] Checker compilation failed: ${checkerCompileResult.error}`)
      cleanupWorkDir(workDir)
      return {
        submissionId,
        result: 'System Error',
        time: 0,
        cpuTime: 0,
        wallTime: 0,
        memory: 0,
        score: 0,
        cases: [],
        message: `Checker compile failed: ${checkerCompileResult.error || 'unknown error'}`
      }
    }
  } else if (!needsSandboxChecker) {
    console.log(`[Judge] Using JS checker: ${checkerType}`)
  }

  // 结果
  const caseResults: JudgeCaseResult[] = []
  let maxCpuTime = 0
  let maxWallTime = 0
  let maxMemory: number | null = null
  let timeoutReason: 'cpu' | 'wall' | 'unknown' | null = null
  let metricSource: 'go-judge-cgroup' | 'local-unavailable' | undefined

  const updateMaxMetrics = (caseResult: JudgeCaseResult) => {
    maxCpuTime = Math.max(maxCpuTime, caseResult.cpuTime ?? caseResult.time ?? 0)
    maxWallTime = Math.max(maxWallTime, caseResult.wallTime ?? caseResult.time ?? 0)
    if (caseResult.memory !== null && caseResult.memory !== undefined) {
      maxMemory = maxMemory === null ? caseResult.memory : Math.max(maxMemory, caseResult.memory)
    }
    if (!timeoutReason && caseResult.timeoutReason) timeoutReason = caseResult.timeoutReason
    if (!metricSource && caseResult.metricSource) metricSource = caseResult.metricSource
  }

  try {
    if (subtasks.length > 0) {
      // 有子任务：按子任务分组评测
      const subtaskResults: SubtaskResult[] = []
      const failedSubtasks: Record<number, boolean> = {}
      let caseIndex = 0

      for (const subtask of subtasks) {
        // 对于 sum 类型，如果没有配置 case 级别的分数，需要分配分数
        // 参考 Hydro normalizeSubtasks: 将子任务分数均匀分配给没有 score 的 cases
        const subtaskCases = subtask.cases || []
        if (subtask.type === 'sum' && subtask.score) {
          const casesWithoutScore = subtaskCases.filter(c => !c.score).length
          const casesWithScore = subtaskCases.reduce((sum, c) => sum + (c.score || 0), 0)
          const remainingScore = Math.max(subtask.score - casesWithScore, 0)
          const perCaseScore = casesWithoutScore > 0 ? Math.floor(remainingScore / casesWithoutScore) : 0
          // 分配分数给没有 score 的 cases
          subtaskCases.forEach(c => {
            if (!c.score) c.score = perCaseScore
          })
        }
        // 对于 min/max 类型，如果没有配置 case 级别的分数，继承子任务的分数
        // 参考 Hydro normalizeSubtasks: score: c.score || (s.type === 'sum' ? caseScore.next().value as number : score)
        if ((subtask.type === 'min' || subtask.type === 'max') && subtask.score) {
          subtaskCases.forEach(c => {
            if (!c.score) c.score = subtask.score
          })
        }

        // 检查子任务依赖：如果依赖的子任务失败，跳过当前子任务
        const deps = subtask.if || []
        const depsFailed = deps.some((depId: number) => failedSubtasks[depId])

        if (depsFailed) {
          // 依赖未通过，跳过此子任务（所有测试点标记为跳过）
          console.log(`[Judge] Subtask ${subtask.id}: skipped (dependency failed)`)
          const skippedResults: JudgeCaseResult[] = subtaskCases.map((_, i) => ({
            caseId: caseIndex + i,
            subtaskId: subtask.id,
            result: 'Skipped' as JudgeResult,
            time: 0,
            cpuTime: 0,
            wallTime: 0,
            memory: null,
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

        const subtaskCaseResults: JudgeCaseResult[] = []
        const subtaskType = subtask.type || 'min'
        let subtaskDetermined = false  // 提前终止标志

        for (let i = 0; i < subtaskCases.length; i++) {
          const testCase = subtaskCases[i]

          // 提前终止优化
          if (subtaskDetermined) {
            // min: 已有失败用例，跳过剩余
            // max: 已有满分用例，跳过剩余
            const skippedResult: JudgeCaseResult = {
              caseId: caseIndex,
              subtaskId: subtask.id,
              result: 'Skipped' as JudgeResult,
              time: 0,
              memory: 0,
              message: subtaskType === 'min' ? '跳过：子任务已确定失败' : '跳过：子任务已确定满分',
            }
            subtaskCaseResults.push(skippedResult)
            caseResults.push(skippedResult)
            caseIndex++
            continue
          }

          const caseTimeLimit = testCase.time ? parseTime(testCase.time) : timeLimit
          const caseMemoryLimit = testCase.memory ? parseMemory(testCase.memory) : memoryLimit

          const caseResult = await runTestCase(
            language,
            testCase,
            caseTimeLimit,
            caseMemoryLimit,
            checkerCtx,
            testdataPath,
            compileResult.fileId,
            workDir,
            filename,
            cfg.user_extra_files
          )
          caseResult.caseId = caseIndex
          caseResult.subtaskId = subtask.id
          // A subtask case inherits its subtask score unless it has an explicit score.
          if (caseResult.result === 'Accepted') {
            caseResult.score = testCase.score ?? subtask.score ?? 0
          }
          subtaskCaseResults.push(caseResult)
          caseResults.push(caseResult)

          updateMaxMetrics(caseResult)

          // 检查是否可以提前终止
          if (subtaskType === 'min' && caseResult.result !== 'Accepted') {
            subtaskDetermined = true
          } else if (subtaskType === 'max' && caseResult.result === 'Accepted' && (caseResult.score || 0) >= (testCase.score || 0)) {
            // max: 已有满分用例，跳过剩余
            subtaskDetermined = true
          }

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

      console.log(`[Judge] Total: ${caseResults.length} cases, time=${maxCpuTime}ms, wall=${maxWallTime}ms, score=${totalScore}, result=${finalResult}`)

      cleanupWorkDir(workDir)
      cleanupWorkDir(checkerWorkDirToCleanup)
      // 清理 go-judge 中的编译产物
      if (compileResult.fileId) {
        sandbox.deleteFile(compileResult.fileId).catch(() => {})
      }
      if (checkerCtx.checkerFileId) {
        sandbox.deleteFile(checkerCtx.checkerFileId).catch(() => {})
      }

      return {
        submissionId,
        result: finalResult,
        time: maxCpuTime,
        cpuTime: maxCpuTime,
        wallTime: maxWallTime,
        memory: maxMemory,
        timeoutReason,
        metricSource,
        score: totalScore,
        cases: caseResults,
        subtasks: subtaskResults
      }
    } else {
      // 无子任务：直接逐个评测。ACM 首个失败后跳过剩余测试点。
      let acmStopped = false
      for (let i = 0; i < allCases.length; i++) {
        if (judgeMode === 'acm' && acmStopped) {
          caseResults.push({ caseId: i, result: 'Skipped', time: 0, cpuTime: 0, wallTime: 0, memory: null, message: '跳过：ACM 赛制已确定失败' })
          continue
        }
        const testCase = allCases[i]
        const caseTimeLimit = testCase.time ? parseTime(testCase.time) : timeLimit
        const caseMemoryLimit = testCase.memory ? parseMemory(testCase.memory) : memoryLimit
        const caseScore = testCase.score || 0

        const caseResult = await runTestCase(
          language,
          testCase,
          caseTimeLimit,
          caseMemoryLimit,
          checkerCtx,
          testdataPath,
          compileResult.fileId,
          workDir,
          filename,
          cfg.user_extra_files
        )
        caseResult.caseId = i
        if (caseResult.result === 'Accepted') {
          caseResult.score = caseScore
        }

        caseResults.push(caseResult)
        updateMaxMetrics(caseResult)
        if (judgeMode === 'acm' && caseResult.result !== 'Accepted') acmStopped = true
      }

      const finalResult = calculateFinalResult(caseResults)
      const totalScore = judgeMode === 'acm' ? acmScore(finalResult) : caseResults.reduce((sum, c) => sum + (c.score || 0), 0)
      if (judgeMode === 'acm') caseResults.forEach(caseResult => { if (caseResult.result !== 'Skipped') caseResult.score = caseResult.result === 'Accepted' ? 100 : 0 })

      console.log(`[Judge] Total: ${caseResults.length} cases, time=${maxCpuTime}ms, wall=${maxWallTime}ms, score=${totalScore}, result=${finalResult}`)

      cleanupWorkDir(workDir)
      cleanupWorkDir(checkerWorkDirToCleanup)
      if (compileResult.fileId) {
        sandbox.deleteFile(compileResult.fileId).catch(() => {})
      }
      if (checkerCtx.checkerFileId) {
        sandbox.deleteFile(checkerCtx.checkerFileId).catch(() => {})
      }

      return {
        submissionId,
        result: finalResult,
        time: maxCpuTime,
        cpuTime: maxCpuTime,
        wallTime: maxWallTime,
        memory: maxMemory,
        timeoutReason,
        metricSource,
        score: totalScore,
        cases: caseResults
      }
    }
  } catch (e: any) {
    cleanupWorkDir(workDir)
    cleanupWorkDir(checkerWorkDirToCleanup)
    if (compileResult.fileId) {
      sandbox.deleteFile(compileResult.fileId).catch(() => {})
    }
    if (checkerCtx.checkerFileId) {
      sandbox.deleteFile(checkerCtx.checkerFileId).catch(() => {})
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
 * Checker 上下文 — 包含编译后的 checker 信息
 */
interface CheckerContext {
  type: string
  /** JS checker 函数（default/strict 模式使用） */
  jsChecker?: (userOutput: string, expectedOutput: string) => import('./checker').CheckerResult
  /** 编译后的 checker fileId（go-judge 模式） */
  checkerFileId?: string
  /** 编译后的 checker 工作目录（本地模式） */
  checkerWorkDir?: string
}

/**
 * 执行单个测试用例
 */
async function runTestCase(
  language: string,
  testCase: TestCaseConfig,
  timeLimit: number,
  memoryLimit: number,
  checkerCtx: CheckerContext,
  testdataPath: string,
  compileFileId?: string,
  workDir?: string,
  filename?: string,
  userExtraFiles?: Record<string, string>
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
      cpuTime: 0,
      wallTime: 0,
      memory: null,
      timeoutReason: null,
      metricSource: 'local-unavailable',
      message: `无法读取测试数据: ${e.message}`
    }
  }

  // 执行程序（支持 File IO 模式 + 额外文件）
  const execResult = await sandbox.execute({
    language,
    stdin: input,
    timeLimit,
    memoryLimit,
    outputLimit: 65536,
    compileFileId,
    workDir,
    filename,  // 当设置时，程序通过 {filename}.in / {filename}.out 文件读写
    extraCopyIn: userExtraFiles  // 额外文件（如辅助数据文件）
  })

  if (execResult.status !== 'Accepted') {
    return {
      caseId: 0,
      result: execResult.status as JudgeResult,
      time: execResult.time,
      cpuTime: execResult.cpuTime,
      wallTime: execResult.wallTime,
      memory: execResult.memory,
      timeoutReason: execResult.timeoutReason,
      metricSource: execResult.metricSource,
      message: execResult.stderr
    }
  }

  const userOutput = execResult.stdout || ''

  // 校验输出
  // 如果有编译后的 checker（沙箱执行模式），使用沙箱 checker
  if (checkerCtx.checkerFileId || checkerCtx.checkerWorkDir) {
    return await runCheckerInSandbox(
      checkerCtx, input, expectedOutput, userOutput,
      testCase.score || 0, execResult.time, execResult.memory ?? 0
    )
  }

  // JS checker（default/strict 模式）
  const checker = checkerCtx.jsChecker || getChecker('default')
  const checkResult = checker(userOutput, expectedOutput)

  if (checkResult.accepted) {
    return {
      caseId: 0,
      result: 'Accepted',
      time: execResult.time,
      cpuTime: execResult.cpuTime,
      wallTime: execResult.wallTime,
      memory: execResult.memory,
      timeoutReason: execResult.timeoutReason,
      metricSource: execResult.metricSource,
      score: testCase.score
    }
  }

  return {
    caseId: 0,
    result: 'Wrong Answer',
    time: execResult.time,
    cpuTime: execResult.cpuTime,
    wallTime: execResult.wallTime,
    memory: execResult.memory,
    timeoutReason: execResult.timeoutReason,
    metricSource: execResult.metricSource,
    message: checkResult.message
  }
}

/**
 * 在沙箱中执行 checker（testlib/lemon/qduoj/syzoj/hustoj/kattis）
 */
async function runCheckerInSandbox(
  checkerCtx: CheckerContext,
  input: string,
  expectedOutput: string,
  userOutput: string,
  caseScore: number,
  execTime: number,
  execMemory: number
): Promise<JudgeCaseResult> {
  const { type, checkerFileId, checkerWorkDir } = checkerCtx

  // 构建 checker 执行参数
  let execCommand = ''
  const copyIn: Record<string, any> = {}
  const copyOut: string[] = ['stderr']

  // 传入 checker 二进制
  if (checkerFileId) {
    copyIn['checker'] = { fileId: checkerFileId }
    execCommand = 'chmod +x checker && ./checker'
  } else if (checkerWorkDir) {
    // 本地模式：checker 已在 workDir 中
    execCommand = './checker'
  }

  // 写入输入/输出/用户输出文件
  copyIn['input'] = { content: input }
  copyIn['answer'] = { content: expectedOutput }
  copyIn['usrout'] = { content: userOutput }

  switch (type) {
    case 'testlib':
      // testlib: checker input user_out answer
      execCommand += ' /w/in /w/user_out /w/answer'
      copyIn['in'] = { content: input }
      copyIn['user_out'] = { content: userOutput }
      copyIn['answer'] = { content: expectedOutput }
      break
    case 'lemon':
      execCommand += ' input usrout answer ' + Math.max(1, Math.round(caseScore || 100)) + ' score message'
      copyOut.push('score', 'message')
      break
    case 'hustoj':
      // hustoj: checker input answer usrout (exit code)
      execCommand += ' input answer usrout'
      break
    case 'qduoj':
      // qduoj: checker input usrout (exit code)
      execCommand += ' input usrout'
      break
    case 'syzoj':
      // syzoj: reads input, user_out, answer, code from files; outputs score to stdout, message to stderr
      copyIn['code'] = { content: '' }
      execCommand = `chmod +x checker && ./checker`
      break
    case 'kattis':
      // kattis: checker input answer_file feedback_dir; reads user output from stdin
      execCommand += ' input answer_file feedback_dir'
      copyIn['feedback_dir/.placeholder'] = { content: '' }
      copyOut.push('feedback_dir/score.txt', 'feedback_dir/judgemessage.txt',
        'feedback_dir/teammessage.txt', 'feedback_dir/judgeerror.txt')
      break
    default:
      execCommand += ' input answer usrout'
      break
  }

  try {
    if (sandbox.isLocalMode()) {
      // 本地模式：在 checkerWorkDir 中执行
      const cDir = checkerWorkDir || ''
      if (!cDir) {
        // 没有本地 checker 目录，回退到 JS checker
        const checker = getChecker('default')
        const checkResult = checker(userOutput, expectedOutput)
        if (checkResult.accepted) {
          return { caseId: 0, result: 'Accepted', time: execTime, memory: execMemory, score: caseScore }
        }
        return { caseId: 0, result: 'Wrong Answer', time: execTime, memory: execMemory, message: checkResult.message }
      }

      // 写入文件
      for (const [name, val] of Object.entries(copyIn)) {
        const filePath = path.join(cDir, name)
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(filePath, (val as any).content || '', 'utf-8')
      }

      // 在本地执行 checker
      const { spawn } = require('child_process')
      const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        const proc = spawn('sh', ['-c', execCommand], { cwd: cDir })
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code: number) => resolve({ code: code || 0, stdout, stderr }))
        proc.on('error', () => resolve({ code: 1, stdout: '', stderr: 'Checker execution failed' }))
      })

      return parseCheckerResult(type, result, caseScore, execTime, execMemory, cDir, copyOut)
    } else {
      // go-judge 模式
      const result = await sandboxRunCommand({
        args: ['sh', '-c', execCommand],
        env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
        copyIn: Object.keys(copyIn).length > 0 ? copyIn : undefined,
        copyOut: ['stdout', ...copyOut],
        copyOutOptional: ['stdout', ...copyOut],
        cpuLimit: 30000000000,  // 30s
        memoryLimit: 536870912, // 512MB
        strictMemoryLimit: true,
        procLimit: 10
      })

      const files: Record<string, string> = result.files || {}
      return parseCheckerResult(type,
        { code: result.exitStatus, stdout: files.stdout || '', stderr: files.stderr || '' },
        caseScore, execTime, execMemory, '', copyOut, files
      )
    }
  } catch (e: any) {
    return {
      caseId: 0,
      result: 'System Error',
      time: execTime,
      memory: execMemory,
      message: `Checker 执行失败: ${e.message}`
    }
  }
}

/**
 * 解析 checker 执行结果
 */
function parseCheckerResult(
  type: string,
  result: { code: number; stdout: string; stderr: string },
  caseScore: number,
  execTime: number,
  execMemory: number,
  workDir?: string,
  expectedFiles?: string[],
  sandboxFiles?: Record<string, string>
): JudgeCaseResult {
  switch (type) {
    case 'testlib': {
      // testlib: 解析 stderr
      const output = (result.stderr || '').trim()
      const firstLine = output.split('\n')[0]?.toLowerCase() || ''

      if (firstLine.startsWith('ok')) {
        return { caseId: 0, result: 'Accepted', time: execTime, memory: execMemory, score: caseScore }
      }
      if (firstLine.startsWith('points')) {
        const match = firstLine.match(/points\s+(\d+(?:\.\d+)?)/)
        const score = match ? Math.floor(parseFloat(match[1])) : 0
        return { caseId: 0, result: score > 0 ? 'Accepted' : 'Wrong Answer', time: execTime, memory: execMemory, score, message: output }
      }
      return { caseId: 0, result: 'Wrong Answer', time: execTime, memory: execMemory, message: output || 'Wrong Answer' }
    }
    case 'lemon': {
      // lemon: 读取 score 和 message 文件
      let score = 0
      let message = ''
      if (sandboxFiles) {
        score = Math.floor(+((sandboxFiles as any)['score'] || '0'))
        message = (sandboxFiles as any)['message'] || ''
      } else if (workDir) {
        try {
          const scorePath = path.join(workDir, 'score')
          const msgPath = path.join(workDir, 'message')
          if (fs.existsSync(scorePath)) score = Math.floor(+fs.readFileSync(scorePath, 'utf-8'))
          if (fs.existsSync(msgPath)) message = fs.readFileSync(msgPath, 'utf-8')
        } catch { /* ignore */ }
      }
      if (result.code !== 0) {
        return { caseId: 0, result: 'System Error', time: execTime, memory: execMemory, message: `Checker 返回非零退出码: ${result.code}` }
      }
      const checkerFullScore = Math.max(1, Math.round(caseScore || 100))
      const accepted = score === checkerFullScore
      return { caseId: 0, result: accepted ? 'Accepted' : 'Wrong Answer', time: execTime, memory: execMemory, score, message }
    }
    case 'hustoj':
    case 'qduoj': {
      // exit code: 0 = AC, non-zero = WA
      if (result.code === 0) {
        return { caseId: 0, result: 'Accepted', time: execTime, memory: execMemory, score: caseScore }
      }
      return { caseId: 0, result: 'Wrong Answer', time: execTime, memory: execMemory, message: result.stderr || result.stdout }
    }
    case 'syzoj': {
      // stdout = score (0-100), stderr = message
      const pct = Math.floor(+result.stdout || 0)
      const score = Math.floor((pct * caseScore) / 100)
      const accepted = pct === 100
      return { caseId: 0, result: accepted ? 'Accepted' : 'Wrong Answer', time: execTime, memory: execMemory, score, message: result.stderr }
    }
    case 'kattis': {
      // exit code: 42 = AC, 43 = WA, else = SE
      if (result.code === 42) {
        return { caseId: 0, result: 'Accepted', time: execTime, memory: execMemory, score: caseScore }
      }
      if (result.code === 43) {
        let score = 0
        let message = ''
        if (sandboxFiles) {
          score = Math.floor(+(sandboxFiles['feedback_dir/score.txt'] || '0'))
          message = sandboxFiles['feedback_dir/teammessage.txt'] || sandboxFiles['feedback_dir/judgemessage.txt'] || ''
        } else if (workDir) {
          try {
            const scorePath = path.join(workDir, 'feedback_dir', 'score.txt')
            const msgPath = path.join(workDir, 'feedback_dir', 'teammessage.txt')
            if (fs.existsSync(scorePath)) score = Math.floor(+fs.readFileSync(scorePath, 'utf-8'))
            if (fs.existsSync(msgPath)) message = fs.readFileSync(msgPath, 'utf-8')
          } catch { /* ignore */ }
        }
        return { caseId: 0, result: 'Wrong Answer', time: execTime, memory: execMemory, score, message }
      }
      return { caseId: 0, result: 'System Error', time: execTime, memory: execMemory, message: `Checker 退出码异常: ${result.code}` }
    }
    default: {
      // 未知类型，按 exit code 判断
      if (result.code === 0) {
        return { caseId: 0, result: 'Accepted', time: execTime, memory: execMemory, score: caseScore }
      }
      return { caseId: 0, result: 'Wrong Answer', time: execTime, memory: execMemory, message: result.stderr || result.stdout }
    }
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

  // 将 cases 中的数字转换为 {input, output} 对象，并将 scoring 映射到 type
  function normalizeSubtask(st: any): any {
    const rawCases = st.cases || []
    const cases = rawCases.map((c: any) => {
      if (typeof c === 'number') {
        return { input: `${c}.in`, output: `${c}.ans` }
      }
      return c
    })
    return { ...st, cases, type: st.type || st.scoring }
  }

  // 如果配置中有 subtasks
  if (config.subtasks && config.subtasks.length > 0) {
    config.subtasks.forEach((st: any, idx: number) => {
      const subtask = normalizeSubtask(st)
      const normalized = { ...subtask, id: subtask.id || idx + 1 }
      subtasks.push(normalized)
      allCases.push(...normalized.cases)
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
 * 参考 Hydro flow.ts:55 — 累计每个用例的分数
 */
function calculateSubtaskScore(
  caseResults: JudgeCaseResult[],
  type: SubtaskType,
  maxScore: number
): number {
  if (caseResults.length === 0) return 0

  switch (type) {
    case 'min': {
      // Hydro: 取子任务内最小分数
      // 如果 checker 返回部分分，取最小；否则 all-or-nothing
      const scores = caseResults.map(c => c.score || 0)
      return Math.min(...scores)
    }
    case 'max': {
      // Hydro: 取子任务内最大分数
      const scores = caseResults.map(c => c.score || 0)
      return Math.max(...scores)
    }
    case 'sum': {
      // Hydro: 累计每个用例的分数
      // 每个 case 有独立分数，子任务分数 = 所有 case 分数之和
      return caseResults.reduce((sum, c) => sum + (c.score || 0), 0)
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

  // 过滤掉 Skipped 状态，只看实际评测结果
  const nonSkipped = cases.filter(c => c.result !== 'Skipped')
  const results = nonSkipped.map(c => c.result)

  if (results.length === 0) {
    // 所有测试点都被跳过，说明依赖失败，返回 Wrong Answer
    return 'Wrong Answer'
  }

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
function parseTime(timeStr: string | number | undefined): number {
  if (!timeStr) return 1000
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
function parseMemory(memStr: string | number | undefined): number {
  if (!memStr) return 262144
  if (typeof memStr === 'number') return memStr * 1024 // raw numbers are MB
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

// ==================== 交互题评测 ====================

/**
 * 解析 testlib 格式的 interactor stderr 输出
 * 参考 Hydro packages/hydrojudge/src/testlib.ts
 */
function parseTestlibOutput(output: string, fullScore: number): { status: JudgeResult; score: number; message: string } {
  let status: JudgeResult = 'Wrong Answer'
  let score = 0
  let message = output.substring(0, 1024)

  const trimmed = output.trim()
  const firstLine = trimmed.split('\n')[0]?.toLowerCase() || ''

  if (firstLine.startsWith('ok')) {
    status = 'Accepted'
    score = fullScore
    message = ''
  } else if (firstLine.startsWith('wrong answer')) {
    message = trimmed.split('wrong answer ')[1] || ''
  } else if (firstLine.startsWith('wrong output format')) {
    message = 'PE ' + (trimmed.split('wrong output format ')[1] || '')
  } else if (firstLine.startsWith('partially correct')) {
    // partially correct (X) 或 partially correct X%
    let pct = 0
    const match = firstLine.match(/partially correct\s*\(?(\d+(?:\.\d+)?)(?:%)?\)?/)
    if (match) {
      pct = parseFloat(match[1])
      if (pct > 1) pct = pct / 100 // 如果是百分数则转换
    }
    score = Math.floor(fullScore * pct)
    status = score > 0 ? 'Accepted' : 'Wrong Answer'
    message = trimmed.replace(/partially correct\s*\(?(\d+(?:\.\d+)?)(?:%)?\)?\s*/, '').trim()
  } else if (firstLine.startsWith('points')) {
    // points X message
    const match = firstLine.match(/points\s+(\d+(?:\.\d+)?)/)
    if (match) {
      let p = parseFloat(match[1])
      if (p > 1) p = p / 100
      if (p === 1) {
        status = 'Accepted'
        score = fullScore
        message = trimmed.replace(/^points\s+[\d.]+\s*/, '') || ''
      } else {
        score = Math.floor(fullScore * p)
        status = score > 0 ? 'Accepted' : 'Wrong Answer'
      }
    }
  }

  // 支持特殊指令 status(N) 或 score(N)
  const operation = /^\s*(status|score)\((\d+)\)\s*((\S|$).*)$/m
  if (operation.test(message)) {
    const [, op, val, rest] = message.match(operation) || []
    message = rest || ''
    if (op === 'status') {
      const s = parseInt(val)
      if ([0, 1, 2, 3, 4, 5, 6, 7].includes(s)) {
        // STATUS Accepted/Runtime Error/etc.
        const statusMap: Record<number, JudgeResult> = {
          0: 'Accepted',
          1: 'Wrong Answer',
          2: 'Compilation Error',
          3: 'Runtime Error',
          4: 'Memory Limit Exceeded',
          5: 'Time Limit Exceeded',
          6: 'Output Limit Exceeded',
          7: 'Presentation Error',
        }
        status = statusMap[s] || status
      }
    } else if (op === 'score') {
      score = parseInt(val)
    }
  }

  return { status, score, message }
}

/**
 * 交互题评测 — 用户程序与 interactor 通过双向管道通信
 *
 * 流程（参考 Hydro interactive.ts）：
 * 1. 编译用户代码 + 编译 interactor
 * 2. 使用 runPiped 启动两个进程，通过 pipeMapping 连接 stdin/stdout
 * 3. 解析 interactor 的 stderr（testlib 格式）获取评测结果
 */
async function judgeInteractive(params: {
  language: string
  code: string
  problemConfig: ProblemConfig
  testdataPath: string
  submissionId: string
}): Promise<JudgeTaskResult> {
  const { language, code, problemConfig, testdataPath, submissionId } = params
  const cfg = problemConfig

  const timeLimit = parseTime((cfg as any).time || (cfg as any).timeLimit || '1s')
  const memoryLimit = parseMemory((cfg as any).memory || (cfg as any).memoryLimit || '256MB')

  console.log(`[Judge Interactive] Starting interactive problem judging...`)

  // 读取 interactor 源码
  let interactorCode: string | undefined
  let interactorLang: string | undefined
  if (cfg.interactor) {
    if (typeof cfg.interactor === 'string') {
      const interactorPath = path.join(testdataPath, cfg.interactor)
      try {
        interactorCode = fs.readFileSync(interactorPath, 'utf-8')
        console.log(`[Judge Interactive] Read interactor from ${cfg.interactor}`)
      } catch (e: any) {
        return {
          submissionId,
          result: 'System Error',
          time: 0,
          memory: 0,
          score: 0,
          cases: [],
          message: `无法读取 interactor 文件: ${e.message}`
        }
      }
    } else if (cfg.interactor.file) {
      const interactorPath = path.join(testdataPath, cfg.interactor.file)
      try {
        interactorCode = fs.readFileSync(interactorPath, 'utf-8')
        interactorLang = cfg.interactor.lang || cfg.interactor.language
        console.log(`[Judge Interactive] Read interactor from ${cfg.interactor.file}, lang=${interactorLang || 'auto'}`)
      } catch (e: any) {
        return {
          submissionId,
          result: 'System Error',
          time: 0,
          memory: 0,
          score: 0,
          cases: [],
          message: `无法读取 interactor 文件: ${e.message}`
        }
      }
    } else if (cfg.interactor.code) {
      interactorCode = cfg.interactor.code
      interactorLang = cfg.interactor.language
    }
  }

  if (!interactorCode) {
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: '交互题需要配置 interactor'
    }
  }

  // 编译用户代码
  let userWorkDir: string | undefined
  if (sandbox.isLocalMode()) {
    userWorkDir = path.join(require('os').tmpdir(), `judge_interactive_user_${submissionId}_${Date.now()}`)
    fs.mkdirSync(userWorkDir, { recursive: true })
  }

  const userCompileResult = await sandbox.compile({
    language,
    code,
    timeLimit: 60000,
    memoryLimit: 524288,
    workDir: userWorkDir
  })

  if (!userCompileResult.success) {
    cleanupWorkDir(userWorkDir)
    return {
      submissionId,
      result: 'Compilation Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: userCompileResult.error
    }
  }

  // 编译 interactor
  let interactorWorkDir: string | undefined
  if (sandbox.isLocalMode()) {
    interactorWorkDir = path.join(require('os').tmpdir(), `judge_interactive_interactor_${submissionId}_${Date.now()}`)
    fs.mkdirSync(interactorWorkDir, { recursive: true })
  }

  const interactorCompileResult = await sandbox.compile({
    language: interactorLang || 'cpp17',
    code: interactorCode,
    timeLimit: 60000,
    memoryLimit: 524288,
    workDir: interactorWorkDir
  })

  if (!interactorCompileResult.success) {
    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(interactorWorkDir)
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: `Interactor 编译失败: ${interactorCompileResult.error}`
    }
  }

  // 加载测试用例
  const { cases: allCases, subtasks } = loadTestCases(testdataPath, cfg)
  if (allCases.length === 0) {
    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(interactorWorkDir)
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

  const caseResults: JudgeCaseResult[] = []
  let maxTime = 0
  let maxMemory = 0

  try {
    // 逐个测试用例评测
    for (let i = 0; i < allCases.length; i++) {
      const testCase = allCases[i]
      const caseTimeLimit = testCase.time ? parseTime(testCase.time) : timeLimit
      const caseMemoryLimit = testCase.memory ? parseMemory(testCase.memory) : memoryLimit
      const caseScore = testCase.score || 0

      // 读取输入输出
      const inputPath = path.join(testdataPath, testCase.input)
      const outputPath = path.join(testdataPath, testCase.output)
      let input = ''
      let expectedOutput = ''
      try {
        input = fs.readFileSync(inputPath, 'utf-8')
        expectedOutput = fs.readFileSync(outputPath, 'utf-8')
      } catch (e: any) {
        caseResults.push({
          caseId: i,
          result: 'System Error',
          time: 0,
          memory: 0,
          message: `无法读取测试数据: ${e.message}`
        })
        continue
      }

      // 使用 runPiped 执行用户程序和 interactor
      const caseResult = await runInteractiveCase(
        language,
        input,
        expectedOutput,
        caseTimeLimit,
        caseMemoryLimit,
        caseScore,
        i,
        userCompileResult.fileId,
        userWorkDir,
        interactorCompileResult.fileId,
        interactorWorkDir
      )

      caseResults.push(caseResult)
      maxTime = Math.max(maxTime, caseResult.time)
      maxMemory = Math.max(maxMemory, caseResult.memory ?? 0)
    }

    // ACM 通过制统一 0/100 分。
    const finalResult = calculateFinalResult(caseResults)
    const totalScore = acmScore(finalResult)
    caseResults.forEach(caseResult => { caseResult.score = caseResult.result === 'Accepted' ? 100 : 0 })

    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(interactorWorkDir)
    if (userCompileResult.fileId) sandbox.deleteFile(userCompileResult.fileId).catch(() => {})
    if (interactorCompileResult.fileId) sandbox.deleteFile(interactorCompileResult.fileId).catch(() => {})

    return {
      submissionId,
      result: finalResult,
      time: maxTime,
      memory: maxMemory,
      score: totalScore,
      cases: caseResults
    }
  } catch (e: any) {
    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(interactorWorkDir)
    if (userCompileResult.fileId) sandbox.deleteFile(userCompileResult.fileId).catch(() => {})
    if (interactorCompileResult.fileId) sandbox.deleteFile(interactorCompileResult.fileId).catch(() => {})

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
 * 执行单个交互题测试用例
 */
async function runInteractiveCase(
  language: string,
  input: string,
  expectedOutput: string,
  timeLimit: number,
  memoryLimit: number,
  caseScore: number,
  caseIndex: number,
  userFileId?: string,
  userWorkDir?: string,
  interactorFileId?: string,
  interactorWorkDir?: string
): Promise<JudgeCaseResult> {
  const langConfig = getLanguageConfig(language)
  if (!langConfig) {
    return {
      caseId: caseIndex,
      result: 'System Error',
      time: 0,
      memory: 0,
      message: `不支持的语言: ${language}`
    }
  }

  try {
    if (sandbox.isLocalMode()) {
      // 本地模式：使用 runPipedLocal
      const { runPipedLocal } = await import('./sandbox/local.js')

      // 创建两个进程的配置
      const userCmd = {
        args: ['sh', '-c', langConfig.execute],
        copyIn: userFileId ? {} : { [langConfig.code_file]: { content: '' } },
        copyOut: ['stderr'],
        cpuLimit: timeLimit * 1000000,
        memoryLimit: memoryLimit * 1024,
        procLimit: 50,
        name: 'user'
      }

      const interactorCmd = {
        args: ['sh', '-c', './interactor /w/in /w/tout /w/out'],
        copyIn: {
          'in': { content: input },
          'out': { content: expectedOutput },
        },
        copyOut: ['stderr', 'tout'],
        cpuLimit: timeLimit * 2 * 1000000,
        memoryLimit: memoryLimit * 2 * 1024,
        procLimit: 50,
        name: 'interactor'
      }

      // 如果有编译产物，设置正确的 copyIn
      if (userWorkDir && langConfig.execute_file) {
        // 用户程序已在 workDir 中
      }
      if (interactorWorkDir) {
        // interactor 已在 workDir 中
      }

      const results = await runPipedLocal({
        cmds: [userCmd, interactorCmd],
        pipeMapping: [
          { in: { index: 1, fd: 0 }, out: { index: 0, fd: 1 } }, // user stdout → interactor stdin
          { in: { index: 0, fd: 0 }, out: { index: 1, fd: 1 } }, // interactor stdout → user stdin
        ],
        workDirBase: path.join(require('os').tmpdir(), `interactive_${Date.now()}`)
      })

      const userResult = results[0]
      const interactorResult = results[1]

      // 检查时间/内存限制
      if (userResult.time > timeLimit) {
        return { caseId: caseIndex, result: 'Time Limit Exceeded', time: userResult.time, memory: userResult.memory, message: '' }
      }
      if (userResult.memory > memoryLimit) {
        return { caseId: caseIndex, result: 'Memory Limit Exceeded', time: userResult.time, memory: userResult.memory, message: '' }
      }
      if (userResult.exitStatus !== 0 && userResult.exitStatus !== 13) {
        return { caseId: caseIndex, result: 'Runtime Error', time: userResult.time, memory: userResult.memory, message: `用户程序退出码: ${userResult.exitStatus}` }
      }

      // 解析 interactor stderr（testlib 格式）
      const parsed = parseTestlibOutput(interactorResult.stderr || '', caseScore)
      return {
        caseId: caseIndex,
        result: parsed.status,
        time: userResult.time,
        memory: userResult.memory,
        score: parsed.score,
        message: parsed.message
      }
    } else {
      // go-judge 模式：使用 runPiped
      const userCopyIn: Record<string, any> = {}
      if (userFileId) {
        const executeFile = langConfig.execute_file || 'main'
        userCopyIn[executeFile] = { fileId: userFileId }
      }

      const interactorCopyIn: Record<string, any> = {
        'in': { content: input },
        'out': { content: expectedOutput },
      }
      if (interactorFileId) {
        interactorCopyIn['interactor'] = { fileId: interactorFileId }
      }

      const results = await sandbox.runPiped({
        cmds: [
          {
            args: ['sh', '-c', langConfig.execute],
            copyIn: Object.keys(userCopyIn).length > 0 ? userCopyIn : undefined,
            copyOut: [],
            cpuLimit: timeLimit * 1000000,
            memoryLimit: memoryLimit * 1024,
            strictMemoryLimit: true,
            procLimit: 50
          },
          {
            args: ['sh', '-c', 'chmod +x interactor && ./interactor /w/in /w/tout /w/out'],
            copyIn: Object.keys(interactorCopyIn).length > 0 ? interactorCopyIn : undefined,
            copyOut: ['stderr', '/w/tout?'],
            cpuLimit: timeLimit * 2 * 1000000,
            memoryLimit: memoryLimit * 2 * 1024,
            strictMemoryLimit: true,
            procLimit: 50
          }
        ],
        pipeMapping: [
          { in: { index: 1, fd: 0 }, out: { index: 0, fd: 1 } },
          { in: { index: 0, fd: 0 }, out: { index: 1, fd: 1 } },
        ]
      })

      const userResult = results[0]
      const interactorResult = results[1]

      // 检查时间/内存限制
      if (userResult.time > timeLimit * 1000000) {
        return { caseId: caseIndex, result: 'Time Limit Exceeded', time: Math.round(userResult.time / 1000000), memory: Math.round(userResult.memory / 1024), message: '' }
      }
      if (userResult.memory > memoryLimit * 1024) {
        return { caseId: caseIndex, result: 'Memory Limit Exceeded', time: Math.round(userResult.time / 1000000), memory: Math.round(userResult.memory / 1024), message: '' }
      }
      if (userResult.exitStatus !== 0 && userResult.exitStatus !== 13) {
        return { caseId: caseIndex, result: 'Runtime Error', time: Math.round(userResult.time / 1000000), memory: Math.round(userResult.memory / 1024), message: `用户程序退出码: ${userResult.exitStatus}` }
      }

      // 解析 interactor stderr
      const parsed = parseTestlibOutput(interactorResult.files?.stderr || '', caseScore)
      return {
        caseId: caseIndex,
        result: parsed.status,
        time: Math.round(userResult.time / 1000000),
        memory: Math.round(userResult.memory / 1024),
        score: parsed.score,
        message: parsed.message
      }
    }
  } catch (e: any) {
    return {
      caseId: caseIndex,
      result: 'System Error',
      time: 0,
      memory: 0,
      message: e.message
    }
  }
}

// ==================== 通信题评测 ====================

/**
 * 通信题评测 — N 个用户进程 + 1 个 manager 通过管道通信
 *
 * 流程（参考 Hydro communication.ts）：
 * 1. 编译用户代码（N份）+ 编译 manager
 * 2. 使用 runPiped 启动 N+1 个进程，通过 pipeMapping 连接
 * 3. manager 的 stdout 输出分数百分比，stderr 输出消息
 */
async function judgeCommunication(params: {
  language: string
  code: string
  problemConfig: ProblemConfig
  testdataPath: string
  submissionId: string
}): Promise<JudgeTaskResult> {
  const { language, code, problemConfig, testdataPath, submissionId } = params
  const cfg = problemConfig

  const numProcesses = cfg.num_processes || 2
  const timeLimit = parseTime((cfg as any).time || (cfg as any).timeLimit || '1s')
  const memoryLimit = parseMemory((cfg as any).memory || (cfg as any).memoryLimit || '256MB')

  console.log(`[Judge Communication] Starting communication problem with ${numProcesses} processes...`)

  // 读取 manager 源码
  let managerCode: string | undefined
  let managerLang: string | undefined
  if (cfg.manager) {
    if (typeof cfg.manager === 'string') {
      const managerPath = path.join(testdataPath, cfg.manager)
      try {
        managerCode = fs.readFileSync(managerPath, 'utf-8')
        console.log(`[Judge Communication] Read manager from ${cfg.manager}`)
      } catch (e: any) {
        return {
          submissionId,
          result: 'System Error',
          time: 0,
          memory: 0,
          score: 0,
          cases: [],
          message: `无法读取 manager 文件: ${e.message}`
        }
      }
    } else if (cfg.manager.file) {
      const managerPath = path.join(testdataPath, cfg.manager.file)
      try {
        managerCode = fs.readFileSync(managerPath, 'utf-8')
        managerLang = cfg.manager.lang || cfg.manager.language
        console.log(`[Judge Communication] Read manager from ${cfg.manager.file}, lang=${managerLang || 'auto'}`)
      } catch (e: any) {
        return {
          submissionId,
          result: 'System Error',
          time: 0,
          memory: 0,
          score: 0,
          cases: [],
          message: `无法读取 manager 文件: ${e.message}`
        }
      }
    } else if (cfg.manager.code) {
      managerCode = cfg.manager.code
      managerLang = cfg.manager.language
    }
  }

  if (!managerCode) {
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: '通信题需要配置 manager'
    }
  }

  // 编译用户代码
  let userWorkDir: string | undefined
  if (sandbox.isLocalMode()) {
    userWorkDir = path.join(require('os').tmpdir(), `judge_comm_user_${submissionId}_${Date.now()}`)
    fs.mkdirSync(userWorkDir, { recursive: true })
  }

  const userCompileResult = await sandbox.compile({
    language,
    code,
    timeLimit: 60000,
    memoryLimit: 524288,
    workDir: userWorkDir
  })

  if (!userCompileResult.success) {
    cleanupWorkDir(userWorkDir)
    return {
      submissionId,
      result: 'Compilation Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: userCompileResult.error
    }
  }

  // 编译 manager
  let managerWorkDir: string | undefined
  if (sandbox.isLocalMode()) {
    managerWorkDir = path.join(require('os').tmpdir(), `judge_comm_manager_${submissionId}_${Date.now()}`)
    fs.mkdirSync(managerWorkDir, { recursive: true })
  }

  const managerCompileResult = await sandbox.compile({
    language: managerLang || 'cpp17',
    code: managerCode,
    timeLimit: 60000,
    memoryLimit: 524288,
    workDir: managerWorkDir
  })

  if (!managerCompileResult.success) {
    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(managerWorkDir)
    return {
      submissionId,
      result: 'System Error',
      time: 0,
      memory: 0,
      score: 0,
      cases: [],
      message: `Manager 编译失败: ${managerCompileResult.error}`
    }
  }

  // 加载测试用例
  const { cases: allCases } = loadTestCases(testdataPath, cfg)
  if (allCases.length === 0) {
    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(managerWorkDir)
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

  const caseResults: JudgeCaseResult[] = []
  let maxTime = 0
  let maxMemory = 0

  try {
    for (let i = 0; i < allCases.length; i++) {
      const testCase = allCases[i]
      const caseTimeLimit = testCase.time ? parseTime(testCase.time) : timeLimit
      const caseMemoryLimit = testCase.memory ? parseMemory(testCase.memory) : memoryLimit
      const caseScore = testCase.score || 0

      // 读取输入
      const inputPath = path.join(testdataPath, testCase.input)
      let input = ''
      try {
        input = fs.readFileSync(inputPath, 'utf-8')
      } catch (e: any) {
        caseResults.push({
          caseId: i,
          result: 'System Error',
          time: 0,
          memory: 0,
          message: `无法读取测试数据: ${e.message}`
        })
        continue
      }

      const caseResult = await runCommunicationCase(
        language,
        input,
        caseTimeLimit,
        caseMemoryLimit,
        caseScore,
        numProcesses,
        i,
        userCompileResult.fileId,
        userWorkDir,
        managerCompileResult.fileId,
        managerWorkDir
      )

      caseResults.push(caseResult)
      maxTime = Math.max(maxTime, caseResult.time)
      maxMemory = Math.max(maxMemory, caseResult.memory ?? 0)
    }

    const finalResult = calculateFinalResult(caseResults)
    const totalScore = acmScore(finalResult)
    caseResults.forEach(caseResult => { caseResult.score = caseResult.result === 'Accepted' ? 100 : 0 })

    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(managerWorkDir)
    if (userCompileResult.fileId) sandbox.deleteFile(userCompileResult.fileId).catch(() => {})
    if (managerCompileResult.fileId) sandbox.deleteFile(managerCompileResult.fileId).catch(() => {})

    return {
      submissionId,
      result: finalResult,
      time: maxTime,
      memory: maxMemory,
      score: totalScore,
      cases: caseResults
    }
  } catch (e: any) {
    cleanupWorkDir(userWorkDir)
    cleanupWorkDir(managerWorkDir)
    if (userCompileResult.fileId) sandbox.deleteFile(userCompileResult.fileId).catch(() => {})
    if (managerCompileResult.fileId) sandbox.deleteFile(managerCompileResult.fileId).catch(() => {})

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
 * 执行单个通信题测试用例
 */
async function runCommunicationCase(
  language: string,
  input: string,
  timeLimit: number,
  memoryLimit: number,
  caseScore: number,
  numProcesses: number,
  caseIndex: number,
  userFileId?: string,
  userWorkDir?: string,
  managerFileId?: string,
  managerWorkDir?: string
): Promise<JudgeCaseResult> {
  const langConfig = getLanguageConfig(language)
  if (!langConfig) {
    return { caseId: caseIndex, result: 'System Error', time: 0, memory: 0, message: `不支持的语言: ${language}` }
  }

  try {
    if (sandbox.isLocalMode()) {
      // 本地模式暂时不支持完整的通信题（管道连接复杂）
      // 返回 System Error 提示
      return {
        caseId: caseIndex,
        result: 'System Error',
        time: 0,
        memory: 0,
        message: '本地模式暂不支持通信题，请使用 go-judge 沙箱'
      }
    } else {
      // go-judge 模式
      const executeFile = langConfig.execute_file || 'main'

      // 构建 manager 命令
      let managerArgs = 'chmod +x manager && ./manager'
      for (let p = 0; p < numProcesses; p++) {
        managerArgs += ` /proc/self/fd/${p * 2 + 3} /proc/self/fd/${p * 2 + 4}`
      }

      // 构建 copyIn
      const managerCopyIn: Record<string, any> = {
        'manager': { fileId: managerFileId! }
      }

      // 构建所有进程
      const cmds: Array<{
        args: string[]
        copyIn?: Record<string, any>
        copyOut?: string[]
        copyOutOptional?: string[]
        cpuLimit?: number
        memoryLimit?: number
        strictMemoryLimit?: boolean
        procLimit?: number
      }> = []

      // Manager 进程（index 0）
      cmds.push({
        args: ['sh', '-c', managerArgs],
        copyIn: managerCopyIn,
        copyOut: ['stdout', 'stderr'],
        copyOutOptional: ['stdout', 'stderr'],
        cpuLimit: timeLimit * 2 * 1000000,
        memoryLimit: memoryLimit * 2 * 1024,
        strictMemoryLimit: true,
        procLimit: 50
      })

      // 用户进程（index 1 到 N）
      for (let p = 0; p < numProcesses; p++) {
        const userCopyIn: Record<string, any> = {}
        if (userFileId) {
          userCopyIn[executeFile] = { fileId: userFileId }
        }
        cmds.push({
          args: ['sh', '-c', `${langConfig.execute} ${p}`],
          copyIn: Object.keys(userCopyIn).length > 0 ? userCopyIn : undefined,
          copyOut: [],
          cpuLimit: timeLimit * 1000000,
          memoryLimit: memoryLimit * 1024,
          strictMemoryLimit: true,
          procLimit: 50
        })
      }

      // 构建 pipeMapping
      const pipeMapping: Array<{ in: { index: number; fd: number }; out: { index: number; fd: number } }> = []
      for (let p = 0; p < numProcesses; p++) {
        // user[p] stdout → manager fd (p*2+3)
        pipeMapping.push({
          in: { index: 0, fd: p * 2 + 3 },
          out: { index: p + 1, fd: 1 }
        })
        // manager fd (p*2+4) → user[p] stdin
        pipeMapping.push({
          in: { index: p + 1, fd: 0 },
          out: { index: 0, fd: p * 2 + 4 }
        })
      }

      const results = await sandbox.runPiped({ cmds, pipeMapping })

      const managerResult = results[0]

      // 检查各用户进程状态
      let maxTime = 0
      let maxMemory = 0
      let status: JudgeResult = 'Accepted'

      for (let p = 0; p < numProcesses; p++) {
        const userResult = results[p + 1]
        maxTime = Math.max(maxTime, Math.round(userResult.time / 1000000))
        maxMemory = Math.max(maxMemory, Math.round(userResult.memory / 1024))

        if (userResult.time > timeLimit * 1000000) {
          status = 'Time Limit Exceeded'
        } else if (userResult.memory > memoryLimit * 1024) {
          status = 'Memory Limit Exceeded'
        } else if (userResult.exitStatus !== 0 && userResult.exitStatus !== 13) {
          status = 'Runtime Error'
        }
      }

      if (status !== 'Accepted') {
        return { caseId: caseIndex, result: status, time: maxTime, memory: maxMemory, message: '' }
      }

      // Manager 输出分数百分比
      const stdoutValue = managerResult.files?.stdout || '0'
      const pct = Math.floor(Number(stdoutValue))
      const score = Math.floor((pct * caseScore) / 100)
      const message = managerResult.files?.stderr || ''

      return {
        caseId: caseIndex,
        result: score === caseScore ? 'Accepted' : 'Wrong Answer',
        time: managerResult.time,
        cpuTime: managerResult.time,
        wallTime: managerResult.time,
        memory: Math.ceil((managerResult.memory || 0) / 1024),
        timeoutReason: null,
        metricSource: 'go-judge-cgroup',
        score,
        message
      }
    }
  } catch (e: any) {
    return { caseId: caseIndex, result: 'System Error', time: 0, memory: 0, message: e.message }
  }
}

// ==================== 提交答案题评测 ====================

/**
 * 提交答案题评测 — 用户提交 zip 包，checker 比对答案文件
 *
 * 流程（参考 Hydro submit_answer.ts）：
 * 1. 用户提交的 zip 包作为代码
 * 2. 从 zip 中提取对应测试点的答案文件
 * 3. checker 比对答案
 */
async function judgeSubmitAnswer(params: {
  code: string  // 实际是 zip 文件内容或路径
  problemConfig: ProblemConfig
  testdataPath: string
  submissionId: string
}): Promise<JudgeTaskResult> {
  const { code, problemConfig, testdataPath, submissionId } = params
  const cfg = problemConfig

  console.log(`[Judge Submit Answer] Starting submit answer problem...`)

  // 检查是否是 zip 文件
  // 如果 code 是 zip 文件路径，直接使用；否则假设用户提交的是答案内容
  // 目前简化实现：假设用户提交的 code 是单个答案文件内容

  const { cases: allCases } = loadTestCases(testdataPath, cfg)
  if (allCases.length === 0) {
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

  // 提交答案题通常需要 checker 比对
  const checkerType = (cfg as any).checker_type || 'default'

  // 读取 checker 源码（如果有）
  let checkerCode: string | undefined
  let checkerLang: string | undefined
  let checkerCtx: CheckerContext = { type: checkerType, jsChecker: getChecker(checkerType) }
  let checkerWorkDirToCleanup: string | undefined

  if (cfg.checker && !['default', 'strict'].includes(checkerType)) {
    if (typeof cfg.checker === 'string') {
      const checkerPath = path.join(testdataPath, cfg.checker)
      try {
        checkerCode = fs.readFileSync(checkerPath, 'utf-8')
      } catch (e: any) {
        console.log(`[Judge Submit Answer] Cannot read checker: ${e.message}`)
      }
    } else if (cfg.checker.file) {
      const checkerPath = path.join(testdataPath, cfg.checker.file)
      try {
        checkerCode = fs.readFileSync(checkerPath, 'utf-8')
        checkerLang = cfg.checker.lang || cfg.checker.language
      } catch (e: any) {
        console.log(`[Judge Submit Answer] Cannot read checker: ${e.message}`)
      }
    } else if (cfg.checker.code) {
      checkerCode = cfg.checker.code
      checkerLang = cfg.checker.language
    }

    if (checkerCode) {
      const checkerCompileResult = await sandbox.compile({
        language: checkerLang || 'cpp17',
        code: checkerCode,
        timeLimit: 60000,
        memoryLimit: 524288,
        extraCopyIn: readCheckerDependencies(testdataPath),
      })
      if (checkerCompileResult.success) {
        checkerCtx = {
          type: checkerType,
          checkerFileId: checkerCompileResult.fileId,
          checkerWorkDir: checkerCompileResult.workDir,
        }
        checkerWorkDirToCleanup = checkerCompileResult.workDir
      } else {
        return {
          submissionId,
          result: 'System Error',
          time: 0,
          memory: 0,
          score: 0,
          cases: [],
          message: 'Checker compile failed: ' + (checkerCompileResult.error || 'unknown error')
        }
      }
    }
  }

  const caseResults: JudgeCaseResult[] = []

  try {
    for (let i = 0; i < allCases.length; i++) {
      const testCase = allCases[i]
      const caseScore = testCase.score || 10

      // 读取标准输出
      const outputPath = path.join(testdataPath, testCase.output)
      let expectedOutput = ''
      try {
        expectedOutput = fs.readFileSync(outputPath, 'utf-8')
      } catch (e: any) {
        caseResults.push({
          caseId: i,
          result: 'System Error',
          time: 0,
          memory: 0,
          message: `无法读取标准答案: ${e.message}`
        })
        continue
      }

      // 提交答案题：用户提交的 code 直接作为答案输出
      // 简化实现：假设 code 是单个文件内容，用于所有测试点
      const userOutput = code

      // 使用 checker 比对
      if (checkerCtx.checkerFileId || checkerCtx.checkerWorkDir) {
        const inputPath = path.join(testdataPath, testCase.input)
        let input = ''
        try {
          input = fs.readFileSync(inputPath, 'utf-8')
        } catch {
          input = ''
        }

        const result = await runCheckerInSandbox(
          checkerCtx, input, expectedOutput, userOutput,
          caseScore, 0, 0
        )
        result.caseId = i
        caseResults.push(result)
      } else {
        // JS checker
        const checker = checkerCtx.jsChecker || getChecker('default')
        const checkResult = checker(userOutput, expectedOutput)
        caseResults.push({
          caseId: i,
          result: checkResult.accepted ? 'Accepted' : 'Wrong Answer',
          time: 0,
          memory: 0,
          score: checkResult.accepted ? caseScore : 0,
          message: checkResult.message
        })
      }
    }

    const finalResult = calculateFinalResult(caseResults)
    const totalScore = acmScore(finalResult)
    cleanupWorkDir(checkerWorkDirToCleanup)
    if (checkerCtx.checkerFileId) sandbox.deleteFile(checkerCtx.checkerFileId).catch(() => {})

    return {
      submissionId,
      result: finalResult,
      time: 0,
      memory: 0,
      score: totalScore,
      cases: caseResults
    }
  } catch (e: any) {
    cleanupWorkDir(checkerWorkDirToCleanup)
    if (checkerCtx.checkerFileId) sandbox.deleteFile(checkerCtx.checkerFileId).catch(() => {})

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

// ==================== 需要导入的语言配置 ====================

import { getLanguageConfig } from './langs'
