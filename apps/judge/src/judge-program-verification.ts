import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OJ_GENERATOR_CPP_HEADER, parseClassifierOutput, parseGeneratorContext } from '@oi-manager/shared'
import { acquireCompiledProgram, type CompiledProgramLease } from './compiled-program-cache'
import { config } from './config'
import { judge } from './judge'
import { runClassifierProgram, runGeneratorProgram, runStandardProgram, runValidatorProgram } from './judge-program-runner'
import type { JudgeProgramFixture, JudgeProgramVerificationRequest, JudgeProgramVerificationResult, SandboxResult } from './types'

const PREVIEW_BYTES = 4096
const MAX_OUTPUT = 16 * 1024 * 1024

function testlib() {
  const header = path.join(config.checkerIncludeDir, 'testlib.h')
  if (!fs.existsSync(header)) throw new Error('系统 testlib.h 不可用')
  return { 'testlib.h': fs.readFileSync(header, 'utf8') }
}

function extras(kind: JudgeProgramVerificationRequest['kind'], language: string) {
  if (language !== 'cpp17') return undefined
  if (kind === 'generator') return { 'oj_generator.hpp': OJ_GENERATOR_CPP_HEADER }
  if (kind === 'validator' || kind === 'classifier') return testlib()
  return undefined
}

function preview(value?: string) {
  const source = value || ''
  return Buffer.byteLength(source) <= PREVIEW_BYTES ? source : `${Buffer.from(source).subarray(0, PREVIEW_BYTES).toString('utf8')}\n[truncated]`
}

function healthy(result: SandboxResult) {
  return !result.infrastructureError && result.status === 'Accepted' && result.exitCode === 0
}

function reportItem(fixture: JudgeProgramFixture, result: SandboxResult, passed: boolean, message: string) {
  return {
    name: fixture.name,
    passed,
    message,
    timeMs: result.time || 0,
    memoryKb: result.memory || 0,
    ...(result.stdout ? { stdoutPreview: preview(result.stdout) } : {}),
    ...(result.stderr ? { stderrPreview: preview(result.stderr) } : {}),
  }
}

function failure(request: JudgeProgramVerificationRequest, outcome: JudgeProgramVerificationResult['outcome'], stage: JudgeProgramVerificationResult['stage'], code: string, message: string, safeMessage = message): JudgeProgramVerificationResult {
  return { jobId: request.jobId, fencingToken: request.fencingToken, outcome, stage, code, message, safeMessage, retryable: outcome === 'infrastructure_error' }
}

async function checkerSelfTest(request: JudgeProgramVerificationRequest, fixture: JudgeProgramFixture, input: string, answer: string) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), `program-verify-${request.jobId}-`))
  try {
    await fs.promises.writeFile(path.join(root, 'case.in'), input)
    await fs.promises.writeFile(path.join(root, 'case.out'), answer)
    const problemConfig = { ...request.problemConfig, mode: 'acm' as const, cases: [{ input: 'case.in', output: 'case.out' }] }
    delete problemConfig.subtasks
    const source = request.kind === 'standard' ? request.source : request.integration?.standard?.source
    if (!source) return { passed: true, message: '未配置活动 STD，跳过 Checker 联调' }
    const result = await judge({ submissionId: `program-verify-${request.jobId}-${fixture.name}`, problemId: request.problemId, code: source, language: 'cpp17', config: problemConfig, testdataPath: root })
    if (result.retryable) throw Object.assign(new Error(result.message || 'Checker 基础设施不可用'), { infrastructureError: true })
    return { passed: result.result === 'Accepted', message: result.result === 'Accepted' ? 'Checker 自检通过' : `Checker 自检失败：${result.result}` }
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
}

async function acquireIntegration(request: JudgeProgramVerificationRequest) {
  const validator = request.integration?.validator
    ? await acquireCompiledProgram({ language: request.integration.validator.language, code: request.integration.validator.source, extraCopyIn: extras('validator', request.integration.validator.language) }, true)
    : null
  try {
    const standard = request.integration?.standard
      ? await acquireCompiledProgram({ language: 'cpp17', code: request.integration.standard.source }, true)
      : null
    return { validator, standard }
  } catch (error) {
    await validator?.release()
    throw error
  }
}

export async function verifyJudgeProgram(request: JudgeProgramVerificationRequest): Promise<JudgeProgramVerificationResult> {
  let compiled: CompiledProgramLease | null = null
  let integration: Awaited<ReturnType<typeof acquireIntegration>> = { validator: null, standard: null }
  try {
    try {
      compiled = await acquireCompiledProgram({ language: request.language, code: request.source, extraCopyIn: extras(request.kind, request.language) }, false)
    } catch (error: any) {
      return failure(request, error?.infrastructureError ? 'infrastructure_error' : 'program_error', 'compile', error?.infrastructureError ? 'PROGRAM_COMPILE_INFRA_ERROR' : 'PROGRAM_COMPILE_FAILED', String(error?.message || '编译失败'), error?.infrastructureError ? '评测基础设施暂时不可用，请稍后重试' : '程序编译失败')
    }
    if (request.mode === 'compile') return { jobId: request.jobId, fencingToken: request.fencingToken, outcome: 'success', code: 'PROGRAM_COMPILED', stage: 'compile', message: '编译成功', safeMessage: '编译成功', report: { fixtures: [], warnings: [] } }

    try { integration = await acquireIntegration(request) }
    catch (error: any) { return failure(request, error?.infrastructureError ? 'infrastructure_error' : 'program_error', 'integration', 'PROGRAM_INTEGRATION_COMPILE_FAILED', String(error?.message || '联调程序编译失败'), '题目评测基础设施暂时异常，请联系题目管理员') }

    const reports: NonNullable<JudgeProgramVerificationResult['report']>['fixtures'] = []
    const warnings: string[] = []
    const covered = new Set<number>()
    for (const fixture of request.fixtures) {
      let result: SandboxResult
      let passed = false
      let message = ''
      if (request.kind === 'generator') {
        try { parseGeneratorContext(fixture.stdin) }
        catch (error) { return failure(request, 'user_error', 'protocol', 'GENERATOR_PROTOCOL_ERROR', String((error as Error).message)) }
        const generated = await runGeneratorProgram({ language: request.language, artifact: compiled.result, stdin: fixture.stdin, timeLimit: 3000, memoryLimit: 524_288, outputLimit: MAX_OUTPUT, deterministic: true })
        result = generated.first
        if (result.infrastructureError || generated.second?.infrastructureError) return failure(request, 'infrastructure_error', 'fixture', 'GENERATOR_INFRA_ERROR', result.stderr || result.status, '评测基础设施暂时不可用，请稍后重试')
        passed = healthy(result) && Boolean(result.stdout) && generated.deterministic
        message = !result.stdout ? 'Generator 输出为空' : !generated.deterministic ? '相同 Context 两次输出不一致' : 'Generator 双运行一致'
        if (passed && integration.validator) {
          const generatedOutput = result.stdout || ''
          const validation = await runValidatorProgram({ language: request.integration!.validator!.language, artifact: integration.validator.result, stdin: generatedOutput, timeLimit: 2000, memoryLimit: 262_144, outputLimit: 65_536 })
          if (validation.result.infrastructureError) return failure(request, 'infrastructure_error', 'integration', 'VALIDATOR_INFRA_ERROR', validation.result.stderr || validation.result.status, '题目 Validator 暂时不可用')
          passed = validation.valid
          message = passed ? `${message}，Validator 联调通过` : 'Generator 输出未通过活动 Validator'
        }
        if (passed && integration.standard) {
          const generatedOutput = result.stdout || ''
          const standard = await runStandardProgram({ language: 'cpp17', artifact: integration.standard.result, stdin: generatedOutput, timeLimit: 30_000, memoryLimit: 524_288, outputLimit: MAX_OUTPUT })
          if (standard.result.infrastructureError) return failure(request, 'infrastructure_error', 'integration', 'STANDARD_INFRA_ERROR', standard.result.stderr || standard.result.status, '题目 STD 暂时不可用')
          passed = healthy(standard.result) && Boolean(standard.output)
          if (passed) {
            const checker = await checkerSelfTest(request, fixture, generatedOutput, standard.output || '')
            passed = checker.passed
            message = checker.message
          } else message = 'Generator 输出无法由活动 STD 生成答案'
        }
      } else if (request.kind === 'validator') {
        const validation = await runValidatorProgram({ language: request.language, artifact: compiled.result, stdin: fixture.stdin, timeLimit: 2000, memoryLimit: 262_144, outputLimit: 65_536 })
        result = validation.result
        if (result.infrastructureError) return failure(request, 'infrastructure_error', 'fixture', 'VALIDATOR_INFRA_ERROR', result.stderr || result.status, '评测基础设施暂时不可用，请稍后重试')
        const expectsValid = fixture.expectedExitCode === 0
        // The sandbox maps a deliberate non-zero validator exit to Runtime Error.
        // For a negative fixture that is the protocol's expected rejection, while
        // time/memory/output limits and infrastructure failures must still fail.
        passed = expectsValid
          ? validation.valid
          : result.status === 'Runtime Error' && result.exitCode !== 0
        message = expectsValid ? '应接受输入' : '应明确拒绝输入'
      } else if (request.kind === 'classifier') {
        if (integration.validator) {
          const validation = await runValidatorProgram({ language: request.integration!.validator!.language, artifact: integration.validator.result, stdin: fixture.stdin, timeLimit: 2000, memoryLimit: 262_144, outputLimit: 65_536 })
          if (validation.result.infrastructureError) return failure(request, 'infrastructure_error', 'integration', 'VALIDATOR_INFRA_ERROR', validation.result.stderr || validation.result.status, '题目 Validator 暂时不可用')
          if (!validation.valid) return failure(request, 'user_error', 'fixture', 'CLASSIFIER_FIXTURE_INVALID', `Fixture ${fixture.name} 未通过活动 Validator`)
        }
        const classified = await runClassifierProgram({ language: request.language, artifact: compiled.result, stdin: fixture.stdin, timeLimit: 2000, memoryLimit: 262_144, outputLimit: 65_536, knownSubtaskIds: request.knownSubtaskIds })
        result = classified.result
        if (result.infrastructureError) return failure(request, 'infrastructure_error', 'fixture', 'CLASSIFIER_INFRA_ERROR', result.stderr || result.status, '评测基础设施暂时不可用，请稍后重试')
        const expected = [...(fixture.expectedSubtasks || [])].sort((a, b) => a - b)
        passed = healthy(result) && Boolean(classified.subtasks) && JSON.stringify(classified.subtasks) === JSON.stringify(expected)
        classified.subtasks?.forEach(id => covered.add(id))
        message = classified.error || `期望 ${expected.join(', ')}，实际 ${(classified.subtasks || []).join(', ')}`
      } else {
        const standard = await runStandardProgram({ language: request.language, artifact: compiled.result, stdin: fixture.stdin, timeLimit: 30_000, memoryLimit: 524_288, outputLimit: MAX_OUTPUT })
        result = standard.result
        if (result.infrastructureError) return failure(request, 'infrastructure_error', 'fixture', 'STANDARD_INFRA_ERROR', result.stderr || result.status, '评测基础设施暂时不可用，请稍后重试')
        passed = healthy(result) && Boolean(standard.output) && (fixture.expectedStdout === undefined || standard.output === fixture.expectedStdout)
        message = passed ? 'STD 输出检查通过' : 'STD 输出为空或与预期不符'
        if (passed) {
          const checker = await checkerSelfTest(request, fixture, fixture.stdin, standard.output)
          passed = checker.passed
          message = checker.message
        }
      }
      reports.push(reportItem(fixture, result!, passed, message))
    }
    if (request.kind === 'classifier') {
      const missing = request.knownSubtaskIds.filter(id => !covered.has(id))
      if (missing.length) warnings.push(`以下 Subtask 没有 Fixture 覆盖：${missing.join(', ')}`)
    }
    const failed = reports.find(item => !item.passed)
    if (failed) return { ...failure(request, 'program_error', 'fixture', 'PROGRAM_PREFLIGHT_FAILED', failed.message), report: { fixtures: reports, warnings, coveredSubtaskIds: [...covered].sort((a, b) => a - b) } }
    return { jobId: request.jobId, fencingToken: request.fencingToken, outcome: 'success', code: 'PROGRAM_VERIFIED', stage: 'fixture', message: '协议与 Fixture 验证通过', safeMessage: '协议与 Fixture 验证通过', report: { fixtures: reports, warnings, coveredSubtaskIds: [...covered].sort((a, b) => a - b) } }
  } finally {
    await Promise.allSettled([compiled?.release(), integration.validator?.release(), integration.standard?.release()].filter(Boolean) as Promise<void>[])
  }
}
