import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { config } from './config'
import { judge } from './judge'
import { execute } from './sandbox/client'
import { acquireCompiledProgram } from './compiled-program-cache'
import type { HackJudgeRequest, HackJudgeTaskResult, JudgeResult, ProblemConfig, TestCaseConfig } from './types'

const MAX_DATA_BYTES = 16 * 1024 * 1024
const VALID_DIFFERENCE_RESULTS = new Set<JudgeResult>([
  'Accepted', 'Wrong Answer', 'Presentation Error', 'Time Limit Exceeded',
  'Memory Limit Exceeded', 'Runtime Error', 'Output Limit Exceeded',
])

function infrastructureError(message: string) {
  const error = new Error(message) as Error & { infrastructureError: true }
  error.infrastructureError = true
  return error
}

function isInfrastructureError(value: unknown): value is { message: string; infrastructureError: true } {
  return Boolean(value && typeof value === 'object' && (value as any).infrastructureError === true)
}

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
  if (Array.isArray(problemConfig.cases) && problemConfig.cases.length > 0) return problemConfig.cases.map(item => ({ ...item }))
  if (Array.isArray(problemConfig.subtasks)) {
    const seen = new Set<string>()
    const cases = problemConfig.subtasks.flatMap(item =>
      item.groups?.length ? item.groups.flatMap(group => group.cases || []) : item.cases || []
    ).filter(item => {
      const key = `${item.input}\0${item.output}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (cases.length > 0) return cases.map(item => ({ input: item.input, output: item.output }))
  }
  if (!fs.existsSync(testdataPath)) return []
  const names = fs.readdirSync(testdataPath)
  return names.filter(name => name.endsWith('.in') && !name.startsWith('.hack_pending_'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(input => {
      const stem = input.slice(0, -3)
      const output = names.includes(`${stem}.out`) ? `${stem}.out` : `${stem}.ans`
      return { input, output }
    }).filter(item => names.includes(item.output))
}

async function createCandidateInput(request: HackJudgeRequest): Promise<string> {
  if (request.inputMode === 'data') return request.inputData || ''
  if (!request.generatorSource || !request.generatorLanguage) throw new Error('生成器源码或语言缺失')
  let compiled
  try { compiled = await acquireCompiledProgram({ language: request.generatorLanguage, code: request.generatorSource }, false) }
  catch (error: any) {
    if (isInfrastructureError(error)) throw infrastructureError(`生成器编译基础设施失败：${error.message}`)
    throw new Error(`生成器编译失败：${error.message}`)
  }
  try {
    const result = await execute({
      language: request.generatorLanguage, timeLimit: 5000, memoryLimit: 262_144,
      outputLimit: MAX_DATA_BYTES, compileFileId: compiled.result.fileId, workDir: compiled.result.workDir,
    })
    if (result.infrastructureError) throw infrastructureError(`生成器沙箱基础设施失败：${result.stderr || result.status}`)
    if (result.status !== 'Accepted') throw new Error(`生成器运行失败：${result.status}${result.stderr ? `；${result.stderr.slice(0, 1000)}` : ''}`)
    return result.stdout || ''
  } finally { await compiled.release() }
}

type HackFailureStage = NonNullable<HackJudgeTaskResult['failureStage']>
function rejected(request: HackJudgeRequest, failureStage: HackFailureStage, message: string, extra: Partial<HackJudgeTaskResult> = {}): HackJudgeTaskResult {
  return { hackAttemptId: request.hackAttemptId, outcome: 'rejected', failureStage, message, ...extra }
}
function systemError(request: HackJudgeRequest, failureStage: HackFailureStage, message: string, extra: Partial<HackJudgeTaskResult> = {}): HackJudgeTaskResult {
  return { hackAttemptId: request.hackAttemptId, outcome: 'system_error', failureStage, message, ...extra }
}
function retryableSystemError(request: HackJudgeRequest, failureStage: HackFailureStage, message: string): HackJudgeTaskResult {
  return systemError(request, failureStage, message, { retryable: true })
}

export function hasStandardOutput(output: string | undefined): output is string {
  return typeof output === 'string' && output.length > 0
}
export function isEffectiveHackVerdictChange(baseline: JudgeResult, candidate: JudgeResult): boolean {
  return VALID_DIFFERENCE_RESULTS.has(baseline) && VALID_DIFFERENCE_RESULTS.has(candidate) && baseline !== candidate
}
export function isEffectiveOiHackScoreChange(baselineScore: number, candidateScore: number): boolean {
  return Number.isFinite(baselineScore) && Number.isFinite(candidateScore) && candidateScore < baselineScore
}

export function buildCandidateConfig(
  problemConfig: ProblemConfig,
  testdataPath: string,
  candidate: TestCaseConfig,
  affectedSubtaskIds: number[] = [],
): ProblemConfig {
  if ((problemConfig.mode || 'acm') !== 'oi') {
    const next: ProblemConfig = { ...problemConfig, mode: 'acm', cases: [candidate, ...currentCases(problemConfig, testdataPath).filter(item => item.input !== candidate.input)] }
    delete next.subtasks
    return next
  }
  const affected = new Set(affectedSubtaskIds)
  const next = JSON.parse(JSON.stringify(problemConfig)) as ProblemConfig
  next.mode = 'oi'
  next.subtasks = (next.subtasks || []).map((subtask, index) => {
    const id = Number(subtask.id || index + 1)
    if (!affected.has(id)) return subtask
    const groups = subtask.groups || []
    const gate = groups.find(group => group.kind === 'hack_gate')
    if (!gate) throw new Error(`Subtask ${id} 缺少 Hack Gate`)
    gate.cases = [candidate, ...(gate.cases || []).filter(item => item.input !== candidate.input)]
    return { ...subtask, groups }
  })
  return next
}

async function classifyInput(request: HackJudgeRequest, candidateInput: string): Promise<number[]> {
  if (!request.classifierSource?.trim()) throw new Error('Classifier 源码缺失')
  const compiled = await acquireCompiledProgram({ language: 'cpp17', code: request.classifierSource, extraCopyIn: checkerDependencies() }, true)
  let run
  try {
    run = await execute({
      language: 'cpp17', stdin: candidateInput, timeLimit: 2000, memoryLimit: 262_144,
      outputLimit: 65_536, compileFileId: compiled.result.fileId, workDir: compiled.result.workDir,
    })
  } finally { await compiled.release() }
  if (run.infrastructureError) throw infrastructureError(`Classifier 沙箱基础设施失败：${run.stderr || run.status}`)
  if (run.status !== 'Accepted' || run.exitCode !== 0) throw new Error(`Classifier 运行失败：${run.status}${run.stderr ? `；${run.stderr.slice(0, 1000)}` : ''}`)
  let parsed: any
  try { parsed = JSON.parse(run.stdout || '') } catch { throw new Error('Classifier 必须输出严格 JSON') }
  if (!parsed || !Array.isArray(parsed.subtasks)) throw new Error('Classifier 输出必须包含 subtasks 数组')
  const ids: number[] = [...new Set<number>((parsed.subtasks as unknown[]).map(value => Number(value)))]
  if (ids.length === 0 || ids.some(id => !Number.isInteger(id) || id <= 0)) throw new Error('Classifier 返回的 Subtask 集合无效')
  const configured = new Set((request.config.subtasks || []).map((subtask, index) => Number(subtask.id || index + 1)))
  const unknown = ids.filter(id => !configured.has(id))
  if (unknown.length > 0) throw new Error(`Classifier 返回未知 Subtask：${unknown.join(', ')}`)
  return ids.sort((a, b) => a - b)
}

export async function judgeHack(request: HackJudgeRequest): Promise<HackJudgeTaskResult> {
  const hackMode = request.hackMode || request.config.mode || 'acm'
  let candidateInput: string
  try { candidateInput = await createCandidateInput(request) }
  catch (error: any) {
    const stage = request.inputMode === 'generator' ? 'generator' : 'input'
    return isInfrastructureError(error) ? retryableSystemError(request, stage, error.message) : rejected(request, stage, error.message)
  }
  if (!candidateInput.trim()) return rejected(request, 'input', '候选输入不能为空')
  if (Buffer.byteLength(candidateInput, 'utf8') > MAX_DATA_BYTES) return rejected(request, 'input', '候选输入超过 16 MiB')

  let validator
  try { validator = await acquireCompiledProgram({ language: 'cpp17', code: request.validatorSource, extraCopyIn: checkerDependencies() }, true) }
  catch (error: any) {
    return isInfrastructureError(error)
      ? retryableSystemError(request, 'validator', `Validator 编译基础设施失败：${error.message}`)
      : systemError(request, 'validator', `Validator 编译失败：${error.message}`)
  }
  let validation
  try {
    validation = await execute({
      language: 'cpp17', stdin: candidateInput, timeLimit: 2000, memoryLimit: 262_144,
      outputLimit: 65_536, compileFileId: validator.result.fileId, workDir: validator.result.workDir,
    })
  } finally { await validator.release() }
  if (validation.infrastructureError) return retryableSystemError(request, 'validator', `Validator 沙箱基础设施失败：${validation.stderr || validation.status}`)
  if (validation.status !== 'Accepted' || validation.exitCode !== 0) {
    return rejected(request, 'validator', `Validator 拒绝候选输入${validation.stderr ? `：${validation.stderr.slice(0, 2000)}` : ''}`)
  }

  let affectedSubtaskIds: number[] = []
  if (hackMode === 'oi') {
    try { affectedSubtaskIds = await classifyInput(request, candidateInput) }
    catch (error: any) {
      return isInfrastructureError(error)
        ? retryableSystemError(request, 'classifier', error.message)
        : systemError(request, 'classifier', error.message)
    }
  }

  let standard
  try { standard = await acquireCompiledProgram({ language: 'cpp17', code: request.standardSource }, true) }
  catch (error: any) {
    return isInfrastructureError(error)
      ? retryableSystemError(request, 'standard', `标准程序编译基础设施失败：${error.message}`)
      : systemError(request, 'standard', `标准程序编译失败：${error.message}`)
  }
  const timeLimit = Math.max(1000, parseTime(request.config.time) * 3)
  const memoryLimit = Math.max(262_144, parseMemory(request.config.memory))
  let standardRun
  try {
    standardRun = await execute({
      language: 'cpp17', stdin: candidateInput,
      timeLimit, memoryLimit, outputLimit: MAX_DATA_BYTES, compileFileId: standard.result.fileId, workDir: standard.result.workDir,
    })
  } finally { await standard.release() }
  if (standardRun.infrastructureError) return retryableSystemError(request, 'standard', `标准程序沙箱基础设施失败：${standardRun.stderr || standardRun.status}`)
  if (standardRun.status !== 'Accepted') return systemError(request, 'standard', `标准程序运行失败：${standardRun.status}${standardRun.stderr ? `；${standardRun.stderr.slice(0, 1000)}` : ''}`)
  if (!hasStandardOutput(standardRun.stdout)) return systemError(request, 'standard', '标准程序没有生成答案输出')
  const candidateOutput = standardRun.stdout
  if (Buffer.byteLength(candidateOutput, 'utf8') > MAX_DATA_BYTES) return systemError(request, 'standard', '标准答案输出超过 16 MiB')

  const pendingStem = `.hack_pending_${request.hackAttemptId}`
  const inputName = `${pendingStem}.in`, outputName = `${pendingStem}.out`
  const inputPath = path.join(request.testdataPath, inputName), outputPath = path.join(request.testdataPath, outputName)
  await fs.promises.mkdir(request.testdataPath, { recursive: true })
  try {
    await fs.promises.writeFile(inputPath, candidateInput, 'utf8')
    await fs.promises.writeFile(outputPath, candidateOutput, 'utf8')
    let candidateConfig: ProblemConfig
    try { candidateConfig = buildCandidateConfig(request.config, request.testdataPath, { input: inputName, output: outputName, score: hackMode === 'oi' ? 100 : undefined }, affectedSubtaskIds) }
    catch (error: any) { return systemError(request, 'classifier', error.message) }

    if (hackMode === 'oi') {
      const selfCheck = await judge({
        submissionId: `hack-standard-${request.hackAttemptId}`, problemId: request.problemId,
        code: request.standardSource, language: 'cpp17', config: candidateConfig, testdataPath: request.testdataPath,
        ioAdapterVersion: 1, io: { inputFile: null, outputFile: null },
      })
      if (selfCheck.retryable) return retryableSystemError(request, 'checker', selfCheck.message || 'Checker 沙箱基础设施失败')
      if (selfCheck.result === 'System Error' || selfCheck.score !== 100) {
        return systemError(request, 'checker', `标准程序 Checker 自检未获满分：${selfCheck.score}/100（${selfCheck.result}）`)
      }
    }

    const baseline = await judge({
      submissionId: `hack-baseline-${request.hackAttemptId}`, problemId: request.problemId,
      code: request.hackSource, language: request.hackLanguage, config: request.config, testdataPath: request.testdataPath,
      ioAdapterVersion: 1, io: { inputFile: request.inputFilename || null, outputFile: request.outputFilename || null },
    })
    if (baseline.retryable) return retryableSystemError(request, 'baseline', baseline.message || '原始评测沙箱基础设施失败')
    if (baseline.result === 'Compilation Error') return rejected(request, 'baseline', `被 Hack 程序编译失败：${baseline.message || ''}`, { baselineResult: baseline.result, baselineScore: baseline.score })
    if (!VALID_DIFFERENCE_RESULTS.has(baseline.result)) return systemError(request, 'baseline', `原始完整评测未得到可比较结果：${baseline.result}`, { baselineResult: baseline.result, baselineScore: baseline.score })

    const candidate = await judge({
      submissionId: `hack-candidate-${request.hackAttemptId}`, problemId: request.problemId,
      code: request.hackSource, language: request.hackLanguage, config: candidateConfig, testdataPath: request.testdataPath,
      ioAdapterVersion: 1, io: { inputFile: request.inputFilename || null, outputFile: request.outputFilename || null },
    })
    if (candidate.retryable) return retryableSystemError(request, 'candidate', candidate.message || '候选评测沙箱基础设施失败')
    if (!VALID_DIFFERENCE_RESULTS.has(candidate.result)) return systemError(request, 'candidate', `加入候选点后的完整评测未得到可比较结果：${candidate.result}`, { baselineResult: baseline.result, baselineScore: baseline.score, candidateResult: candidate.result, candidateScore: candidate.score, affectedSubtaskIds })

    const effective = hackMode === 'oi'
      ? isEffectiveOiHackScoreChange(baseline.score, candidate.score)
      : isEffectiveHackVerdictChange(baseline.result, candidate.result)
    if (!effective) {
      const message = hackMode === 'oi' ? `总分未下降（${baseline.score} → ${candidate.score}）` : `最终 Verdict 未变化（${baseline.result}）`
      return rejected(request, 'candidate', message, { baselineResult: baseline.result, baselineScore: baseline.score, candidateResult: candidate.result, candidateScore: candidate.score, affectedSubtaskIds })
    }
    const message = hackMode === 'oi'
      ? `${baseline.score} → ${candidate.score}，命中 Subtask ${affectedSubtaskIds.join(', ')}`
      : `${baseline.result} → ${candidate.result}，有效 Hack 数据已通过验证`
    return {
      hackAttemptId: request.hackAttemptId, outcome: 'accepted',
      baselineResult: baseline.result, baselineScore: baseline.score,
      candidateResult: candidate.result, candidateScore: candidate.score,
      affectedSubtaskIds, message, inputData: candidateInput, outputData: candidateOutput,
      inputSha256: crypto.createHash('sha256').update(candidateInput).digest('hex'),
      outputSha256: crypto.createHash('sha256').update(candidateOutput).digest('hex'),
    }
  } finally {
    await Promise.allSettled([fs.promises.rm(inputPath, { force: true }), fs.promises.rm(outputPath, { force: true })])
  }
}
