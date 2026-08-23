import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { config } from './config'
import { judge } from './judge'
import { compile, execute } from './sandbox/client'
import type { HackJudgeRequest, HackJudgeTaskResult, JudgeResult, ProblemConfig, TestCaseConfig } from './types'

const MAX_DATA_BYTES = 1024 * 1024
const VALID_DIFFERENCE_RESULTS = new Set<JudgeResult>([
  'Accepted',
  'Wrong Answer',
  'Presentation Error',
  'Time Limit Exceeded',
  'Memory Limit Exceeded',
  'Runtime Error',
  'Output Limit Exceeded',
])

function parseTime(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  const match = String(value || '1000ms').trim().match(/^([\d.]+)\s*(ms|s)?$/i)
  if (!match) return 1000
  const amount = Number(match[1])
  return match[2]?.toLowerCase() === 's' ? Math.ceil(amount * 1000) : Math.ceil(amount)
}

function parseMemory(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  const match = String(value || '256MB').trim().match(/^([\d.]+)\s*(kb|mb|gb)?$/i)
  if (!match) return 256 * 1024
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase() || 'mb'
  if (unit === 'gb') return Math.ceil(amount * 1024 * 1024)
  if (unit === 'kb') return Math.ceil(amount)
  return Math.ceil(amount * 1024)
}

function checkerDependencies(): Record<string, string> {
  const header = path.join(config.checkerIncludeDir, 'testlib.h')
  if (!fs.existsSync(header)) throw new Error('系统 testlib.h 不可用')
  return { 'testlib.h': fs.readFileSync(header, 'utf8') }
}

function currentCases(problemConfig: ProblemConfig, testdataPath: string): TestCaseConfig[] {
  if (Array.isArray(problemConfig.cases) && problemConfig.cases.length > 0) {
    return problemConfig.cases.map(item => ({ ...item }))
  }
  if (Array.isArray(problemConfig.subtasks)) {
    const seen = new Set<string>()
    const cases = problemConfig.subtasks.flatMap(item => item.cases || []).filter(item => {
      const key = `${item.input}\0${item.output}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (cases.length > 0) return cases.map(item => ({ input: item.input, output: item.output }))
  }
  if (!fs.existsSync(testdataPath)) return []
  const names = fs.readdirSync(testdataPath)
  return names
    .filter(name => name.endsWith('.in') && !name.startsWith('.hack_pending_'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(input => {
      const stem = input.slice(0, -3)
      const output = names.includes(`${stem}.out`) ? `${stem}.out` : `${stem}.ans`
      return { input, output }
    })
    .filter(item => names.includes(item.output))
}

async function compileProgram(language: string, code: string, extraCopyIn?: Record<string, string>) {
  const result = await compile({ language, code, timeLimit: 60_000, memoryLimit: 524_288, extraCopyIn })
  if (!result.success) throw new Error(result.error || '编译失败')
  return result
}

async function createCandidateInput(request: HackJudgeRequest): Promise<string> {
  if (request.inputMode === 'data') return request.inputData || ''
  if (!request.generatorSource || !request.generatorLanguage) throw new Error('生成器源码或语言缺失')
  let compiled
  try {
    compiled = await compileProgram(request.generatorLanguage, request.generatorSource)
  } catch (error: any) {
    throw new Error(`生成器编译失败：${error.message}`)
  }
  const result = await execute({
    language: request.generatorLanguage,
    timeLimit: 5000,
    memoryLimit: 262_144,
    outputLimit: MAX_DATA_BYTES,
    compileFileId: compiled.fileId,
    workDir: compiled.workDir,
  })
  if (result.status !== 'Accepted') {
    throw new Error(`生成器运行失败：${result.status}${result.stderr ? `；${result.stderr.slice(0, 1000)}` : ''}`)
  }
  return result.stdout || ''
}

type HackFailureStage = NonNullable<HackJudgeTaskResult['failureStage']>

function rejected(request: HackJudgeRequest, failureStage: HackFailureStage, message: string, baselineResult?: JudgeResult, candidateResult?: JudgeResult): HackJudgeTaskResult {
  return { hackAttemptId: request.hackAttemptId, outcome: 'rejected', failureStage, baselineResult, candidateResult, message }
}

function systemError(request: HackJudgeRequest, failureStage: HackFailureStage, message: string, baselineResult?: JudgeResult, candidateResult?: JudgeResult): HackJudgeTaskResult {
  return { hackAttemptId: request.hackAttemptId, outcome: 'system_error', failureStage, baselineResult, candidateResult, message }
}

export function hasStandardOutput(output: string | undefined): output is string {
  return typeof output === 'string' && output.length > 0
}

export function isEffectiveHackVerdictChange(baseline: JudgeResult, candidate: JudgeResult): boolean {
  return VALID_DIFFERENCE_RESULTS.has(baseline) && VALID_DIFFERENCE_RESULTS.has(candidate) && baseline !== candidate
}

export function buildCandidateConfig(config: ProblemConfig, testdataPath: string, candidate: TestCaseConfig): ProblemConfig {
  const next: ProblemConfig = {
    ...config,
    mode: 'acm',
    cases: [candidate, ...currentCases(config, testdataPath).filter(item => item.input !== candidate.input)],
  }
  delete next.subtasks
  return next
}

export async function judgeHack(request: HackJudgeRequest): Promise<HackJudgeTaskResult> {
  let candidateInput: string
  try {
    candidateInput = await createCandidateInput(request)
  } catch (error: any) {
    return rejected(request, request.inputMode === 'generator' ? 'generator' : 'input', error.message)
  }
  if (!candidateInput.trim()) return rejected(request, 'input', '候选输入不能为空')
  if (Buffer.byteLength(candidateInput, 'utf8') > MAX_DATA_BYTES) return rejected(request, 'input', '候选输入超过 1 MiB')

  let validator
  try {
    validator = await compileProgram('cpp17', request.validatorSource, checkerDependencies())
  } catch (error: any) {
    return systemError(request, 'validator', `Validator 编译失败：${error.message}`)
  }
  const validation = await execute({
    language: 'cpp17',
    stdin: candidateInput,
    timeLimit: 2000,
    memoryLimit: 262_144,
    outputLimit: 65_536,
    compileFileId: validator.fileId,
    workDir: validator.workDir,
  })
  if (validation.status !== 'Accepted' || validation.exitCode !== 0) {
    return rejected(request, 'validator', `Validator 拒绝候选输入${validation.stderr ? `：${validation.stderr.slice(0, 2000)}` : ''}`)
  }

  let standard
  try {
    standard = await compileProgram('cpp17', request.standardSource)
  } catch (error: any) {
    return systemError(request, 'standard', `标准程序编译失败：${error.message}`)
  }
  const timeLimit = Math.max(1000, parseTime(request.config.time) * 3)
  const memoryLimit = Math.max(262_144, parseMemory(request.config.memory))
  const standardRun = await execute({
    language: 'cpp17',
    stdin: candidateInput,
    filename: request.config.filename,
    timeLimit,
    memoryLimit,
    outputLimit: MAX_DATA_BYTES,
    compileFileId: standard.fileId,
    workDir: standard.workDir,
  })
  if (standardRun.status !== 'Accepted') {
    return systemError(request, 'standard', `标准程序运行失败：${standardRun.status}${standardRun.stderr ? `；${standardRun.stderr.slice(0, 1000)}` : ''}`)
  }
  if (!hasStandardOutput(standardRun.stdout)) return systemError(request, 'standard', '标准程序没有生成答案输出')
  const candidateOutput = standardRun.stdout
  if (Buffer.byteLength(candidateOutput, 'utf8') > MAX_DATA_BYTES) return systemError(request, 'standard', '标准答案输出超过 1 MiB')

  const baseline = await judge({
    submissionId: `hack-baseline-${request.hackAttemptId}`,
    problemId: request.problemId,
    code: request.hackSource,
    language: request.hackLanguage,
    config: request.config,
    testdataPath: request.testdataPath,
  })
  if (baseline.result === 'Compilation Error') return rejected(request, 'baseline', `被 Hack 程序编译失败：${baseline.message || ''}`, baseline.result)
  if (!VALID_DIFFERENCE_RESULTS.has(baseline.result)) {
    return systemError(request, 'baseline', `原始完整评测未得到可比较结果：${baseline.result}`, baseline.result)
  }

  const pendingStem = `.hack_pending_${request.hackAttemptId}`
  const inputName = `${pendingStem}.in`
  const outputName = `${pendingStem}.out`
  const inputPath = path.join(request.testdataPath, inputName)
  const outputPath = path.join(request.testdataPath, outputName)
  await fs.promises.mkdir(request.testdataPath, { recursive: true })
  try {
    await fs.promises.writeFile(inputPath, candidateInput, 'utf8')
    await fs.promises.writeFile(outputPath, candidateOutput, 'utf8')
    const candidate = await judge({
      submissionId: `hack-candidate-${request.hackAttemptId}`,
      problemId: request.problemId,
      code: request.hackSource,
      language: request.hackLanguage,
      config: buildCandidateConfig(request.config, request.testdataPath, { input: inputName, output: outputName }),
      testdataPath: request.testdataPath,
    })
    if (!VALID_DIFFERENCE_RESULTS.has(candidate.result)) {
      return systemError(request, 'candidate', `加入候选点后的完整评测未得到可比较结果：${candidate.result}`, baseline.result, candidate.result)
    }
    if (!isEffectiveHackVerdictChange(baseline.result, candidate.result)) {
      return rejected(request, 'candidate', `最终 Verdict 未变化（${baseline.result}）`, baseline.result, candidate.result)
    }
    return {
      hackAttemptId: request.hackAttemptId,
      outcome: 'accepted',
      baselineResult: baseline.result,
      candidateResult: candidate.result,
      message: `${baseline.result} → ${candidate.result}，有效 Hack 数据已通过验证`,
      inputData: candidateInput,
      outputData: candidateOutput,
      inputSha256: crypto.createHash('sha256').update(candidateInput).digest('hex'),
      outputSha256: crypto.createHash('sha256').update(candidateOutput).digest('hex'),
    }
  } finally {
    await Promise.allSettled([
      fs.promises.rm(inputPath, { force: true }),
      fs.promises.rm(outputPath, { force: true }),
    ])
  }
}
