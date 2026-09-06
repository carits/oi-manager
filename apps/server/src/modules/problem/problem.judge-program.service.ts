import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { JwtPayload, JudgeProgramKind, JudgeProgramLanguage, JudgeProgramProtocol } from '@oi-manager/shared'
import {
  defaultProtocolFor, getJudgeProgramTemplate, isJudgeProgramCombinationAllowed,
  CLASSIFIER_OUTPUT_V1_SCHEMA, GENERATOR_CONTEXT_V1_SCHEMA,
  JUDGE_PROGRAM_CAPABILITIES, JUDGE_PROGRAM_KINDS, JUDGE_PROGRAM_TEMPLATES,
  OJ_GENERATOR_CPP_HEADER, parseClassifierOutput,
} from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { logger } from '../../lib/logger'
import { canModifyProblem } from './problem.access'
import { validateHackCppSource } from './problem.hack.service'
import { refreshAdmittedCandidateStages } from './problem.contribution-readiness.service'

export { JUDGE_PROGRAM_KINDS }
export class JudgeProgramError extends Error { constructor(public statusCode: number, public code: string, message: string, public data?: unknown) { super(message) } }

export async function requireProgramProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canModifyProblem(user, problem)) throw new JudgeProgramError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  return problem
}

function resolveProgramIdentity(kindValue: string, languageValue?: string, protocolValue?: string, allowLegacy = false) {
  if (!JUDGE_PROGRAM_KINDS.includes(kindValue as JudgeProgramKind)) throw new JudgeProgramError(400, 'PROGRAM_KIND_INVALID', '评测程序类型无效')
  const kind = kindValue as JudgeProgramKind
  const language = (languageValue || JUDGE_PROGRAM_CAPABILITIES[kind].defaultLanguage) as JudgeProgramLanguage
  if (language === 'validator-dsl') throw new JudgeProgramError(400, 'PROGRAM_LANGUAGE_INVALID', 'Validator DSL 请使用 Validator Spec 编辑器')
  const protocol = (protocolValue || defaultProtocolFor(kind, language)) as JudgeProgramProtocol | null
  if (!protocol || !isJudgeProgramCombinationAllowed(kind, language, protocol, allowLegacy)) throw new JudgeProgramError(400, 'PROGRAM_PROTOCOL_MISMATCH', `${kind} / ${language} 不支持协议 ${protocolValue || '默认协议'}`)
  return { kind, language, protocol }
}

function verifyTemplate(input: { templateId?: string; kind: JudgeProgramKind; language: JudgeProgramLanguage; protocol: JudgeProgramProtocol }) {
  if (!input.templateId) return null
  const template = getJudgeProgramTemplate(input.templateId)
  if (!template || template.kind !== input.kind || template.language !== input.language || template.protocol !== input.protocol) throw new JudgeProgramError(400, 'PROGRAM_TEMPLATE_MISMATCH', '模板与程序类型、语言或协议不匹配')
  return template
}

export async function compileJudgeProgram(source: string, language: string, label = '评测程序', _options?: { protocol?: string }) {
  if (!source.trim()) throw new JudgeProgramError(400, 'PROGRAM_SOURCE_EMPTY', `${label}源码不能为空`)
  if (Buffer.byteLength(source, 'utf8') > 256 * 1024) throw new JudgeProgramError(413, 'PROGRAM_SOURCE_TOO_LARGE', `${label}源码不能超过 256 KiB`)
  if (source.includes('\0')) throw new JudgeProgramError(400, 'PROGRAM_SOURCE_INVALID', '源码不能包含 NUL 字符')
  if (language === 'cpp17') {
    const compileSource = _options?.protocol === 'oj.generator/v1'
      ? source.replace(/^\s*#include\s+["<]oj_generator\.hpp[">]\s*$/m, OJ_GENERATOR_CPP_HEADER)
      : source
    try { await validateHackCppSource(compileSource, label) }
    catch (error) { throw new JudgeProgramError(422, 'PROGRAM_COMPILE_ERROR', error instanceof Error ? error.message : `${label}编译失败`) }
    return
  }
  if (language !== 'python3') throw new JudgeProgramError(400, 'PROGRAM_LANGUAGE_INVALID', '不支持的程序语言')
  const response = await fetch(`${process.env.SANDBOX_HOST || 'http://127.0.0.1:5050'}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: [{
      args: ['python3', '-m', 'py_compile', 'main.py'], env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'PYTHONDONTWRITEBYTECODE=1'], copyIn: { 'main.py': { content: source } }, copyOut: ['stderr?'],
      cpuLimit: 10_000_000_000, clockLimit: 15_000_000_000, memoryLimit: 268_435_456, procLimit: 20,
    }] }),
  })
  if (!response.ok) throw new JudgeProgramError(503, 'SANDBOX_UNAVAILABLE', `沙箱返回 HTTP ${response.status}`)
  const result = (await response.json() as any[])?.[0]
  if (!result || result.status !== 'Accepted' || result.exitStatus !== 0) throw new JudgeProgramError(422, result?.status === 'Internal Error' ? 'PROGRAM_COMPILE_INFRA_ERROR' : 'PROGRAM_COMPILE_ERROR', String(result?.files?.stderr || result?.error || result?.status || 'Python 语法检查失败').slice(0, 4000))
}

export function listJudgeProgramTemplates() { return JUDGE_PROGRAM_TEMPLATES.map(({ source: _source, ...template }) => template) }
export function readJudgeProgramTemplate(id: string) {
  const template = getJudgeProgramTemplate(id)
  if (!template) throw new JudgeProgramError(404, 'PROGRAM_TEMPLATE_NOT_FOUND', '评测程序模板不存在')
  return template
}
export function getJudgeProgramCapabilities() { return { capabilities: JUDGE_PROGRAM_CAPABILITIES, schemas: { generatorContext: GENERATOR_CONTEXT_V1_SCHEMA, classifierOutput: CLASSIFIER_OUTPUT_V1_SCHEMA } } }

export async function listJudgePrograms(user: JwtPayload, problemId: string) {
  await requireProgramProblem(user, problemId)
  const programs = await prisma.problemJudgeProgram.findMany({ where: { problemId, status: 'active' }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] })
  const versions = await prisma.problemJudgeProgramVersion.findMany({ where: { programId: { in: programs.map(item => item.id) } }, orderBy: { versionNumber: 'desc' } })
  return programs.map(program => ({ ...program, versions: versions.filter(version => version.programId === program.id) }))
}

type CreateProgramInput = { user: JwtPayload; problemId: string; kind: string; name?: string; language?: string; protocol?: string; templateId?: string; templateVersion?: number; source: string; origin?: string; aiRequestId?: string }
const runtimeMetadata = (language: JudgeProgramLanguage) => language === 'python3' ? { runtime: 'python3', standardLibraryOnly: true } : { runtime: 'cpp17', usesTestlib: true }

export async function createJudgeProgram(input: CreateProgramInput) {
  await requireProgramProblem(input.user, input.problemId)
  const identity = resolveProgramIdentity(input.kind, input.language, input.protocol)
  const template = verifyTemplate({ templateId: input.templateId, ...identity })
  const name = String(input.name || JUDGE_PROGRAM_CAPABILITIES[identity.kind].title).trim()
  if (!name || name.length > 80) throw new JudgeProgramError(400, 'PROGRAM_NAME_INVALID', '程序名称长度必须为 1～80')
  await compileJudgeProgram(input.source, identity.language, name, { protocol: identity.protocol })
  const sourceSha256 = crypto.createHash('sha256').update(input.source).digest('hex')
  const created = await prisma.$transaction(async tx => {
    const id = crypto.randomUUID(), versionId = crypto.randomUUID()
    const program = await tx.problemJudgeProgram.create({ data: { id, problemId: input.problemId, kind: identity.kind, name, language: identity.language, currentVersionId: null, createdBy: input.user.userId } })
    const version = await tx.problemJudgeProgramVersion.create({ data: {
      id: versionId, programId: id, problemId: input.problemId, versionNumber: 1, language: identity.language, source: input.source, sourceSha256,
      origin: input.origin || 'manual', aiRequestId: input.aiRequestId || null, compileStatus: 'passed', lifecycleStatus: 'compiled',
      protocol: identity.protocol, protocolVersion: 1, templateId: template?.id || null, templateVersion: input.templateVersion || template?.version || null,
      runtimeMetadata: runtimeMetadata(identity.language), createdBy: input.user.userId,
    } })
    return { program, version }
  })
  logger.audit('judge_program_version_created', { userId: input.user.userId, role: input.user.role, problemId: input.problemId, programId: created.program.id, versionId: created.version.id, kind: identity.kind, language: identity.language, protocol: identity.protocol, sourceSha256 })
  return created
}

export async function createJudgeProgramVersion(input: Omit<CreateProgramInput, 'kind' | 'name'> & { programId: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId, status: 'active' } })
  if (!program) throw new JudgeProgramError(404, 'PROGRAM_NOT_FOUND', '评测程序不存在')
  const identity = resolveProgramIdentity(program.kind, input.language || program.language, input.protocol)
  const template = verifyTemplate({ templateId: input.templateId, ...identity })
  await compileJudgeProgram(input.source, identity.language, program.name, { protocol: identity.protocol })
  const sourceSha256 = crypto.createHash('sha256').update(input.source).digest('hex')
  const version = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`judge-program:${program.id}`}, 0)) IS NULL AS locked`
    const max = await tx.problemJudgeProgramVersion.aggregate({ where: { programId: program.id }, _max: { versionNumber: true } })
    return tx.problemJudgeProgramVersion.create({ data: {
      id: crypto.randomUUID(), programId: program.id, problemId: input.problemId, versionNumber: (max._max.versionNumber || 0) + 1,
      language: identity.language, source: input.source, sourceSha256, origin: input.origin || 'manual', aiRequestId: input.aiRequestId || null,
      compileStatus: 'passed', lifecycleStatus: 'compiled', protocol: identity.protocol, protocolVersion: 1,
      templateId: template?.id || null, templateVersion: input.templateVersion || template?.version || null,
      runtimeMetadata: runtimeMetadata(identity.language), createdBy: input.user.userId,
    } })
  })
  logger.audit('judge_program_version_created', { userId: input.user.userId, role: input.user.role, problemId: input.problemId, programId: program.id, versionId: version.id, kind: identity.kind, language: identity.language, protocol: identity.protocol, sourceSha256 })
  return version
}

type Fixture = { name?: string; stdin?: string; expectedExitCode?: number; expectedStdout?: string; expectedSubtasks?: number[] }
async function runSandboxProgram(source: string, language: string, stdin: string) {
  const isCpp = language === 'cpp17'
  const command = isCpp ? 'g++ main.cpp -o main -O2 -std=c++17 2>compile.stderr && ./main <stdin >stdout 2>stderr' : 'python3 -m py_compile main.py 2>compile.stderr && python3 main.py <stdin >stdout 2>stderr'
  const copyIn: Record<string, { content: string }> = { [isCpp ? 'main.cpp' : 'main.py']: { content: source }, stdin: { content: stdin } }
  if (isCpp) {
    copyIn['oj_generator.hpp'] = { content: OJ_GENERATOR_CPP_HEADER }
    const testlibPath = [
      process.env.CHECKER_INCLUDE_DIR && path.join(process.env.CHECKER_INCLUDE_DIR, 'testlib.h'),
      path.join(process.cwd(), '..', 'judge', 'checker-includes', 'testlib.h'),
      path.join(process.cwd(), 'apps', 'judge', 'checker-includes', 'testlib.h'),
    ].filter(Boolean).find(candidate => fs.existsSync(candidate as string)) as string | undefined
    if (testlibPath) copyIn['testlib.h'] = { content: fs.readFileSync(testlibPath, 'utf8') }
  }
  const response = await fetch(`${process.env.SANDBOX_HOST || 'http://127.0.0.1:5050'}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: [{ args: ['sh', '-c', command], env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'PYTHONDONTWRITEBYTECODE=1', 'TZ=UTC', 'LC_ALL=C.UTF-8'], copyIn, copyOut: ['stdout?', 'stderr?', 'compile.stderr?'], cpuLimit: 10_000_000_000, clockLimit: 15_000_000_000, memoryLimit: 268_435_456, procLimit: 20, outputLimit: 65_536 }] }) })
  if (!response.ok) throw new JudgeProgramError(503, 'SANDBOX_UNAVAILABLE', `沙箱返回 HTTP ${response.status}`)
  const result = (await response.json() as any[])?.[0]
  return { status: String(result?.status || ''), signal: Number(result?.signal || 0), exitCode: Number(result?.exitStatus ?? -1), stdout: String(result?.files?.stdout || ''), stderr: String(result?.files?.stderr || result?.files?.['compile.stderr'] || '').slice(0, 4096) }
}

export async function preflightJudgeProgramVersion(input: { user: JwtPayload; problemId: string; programId: string; versionId: string; fixtures?: Fixture[] }) {
  const problem = await requireProgramProblem(input.user, input.problemId)
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: problem.id, status: 'active' } })
  const version = program ? await prisma.problemJudgeProgramVersion.findFirst({ where: { id: input.versionId, programId: program.id } }) : null
  if (!program || !version) throw new JudgeProgramError(404, 'PROGRAM_VERSION_NOT_FOUND', '评测程序版本不存在')
  const fixtures = Array.isArray(input.fixtures) ? input.fixtures.slice(0, 20) : []
  if (!fixtures.length) throw new JudgeProgramError(422, 'PROGRAM_FIXTURES_REQUIRED', '至少提供一个协议测试样例')
  if (program.kind === 'validator' && (!fixtures.some(item => item.expectedExitCode === 0) || !fixtures.some(item => item.expectedExitCode !== undefined && item.expectedExitCode !== 0))) throw new JudgeProgramError(422, 'VALIDATOR_FIXTURES_INCOMPLETE', 'Validator 激活前必须同时通过正样例和负样例')
  const parsedConfig = yaml.load(problem.judgeConfig || '{}') as any
  const knownSubtasks = (parsedConfig?.subtasks || []).map((item: any, index: number) => Number(item.id || index + 1))
  const reports = []
  for (const fixture of fixtures) {
    const run = await runSandboxProgram(version.source, version.language, String(fixture.stdin || ''))
    let passed = true, message = ''
    if (program.kind === 'validator') {
      const expectsSuccess = fixture.expectedExitCode === 0
      passed = run.signal === 0 && !['Internal Error', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Output Limit Exceeded'].includes(run.status) && (expectsSuccess ? run.status === 'Accepted' && run.exitCode === 0 : run.exitCode !== 0)
      message = expectsSuccess ? '应接受输入' : '应拒绝输入'
    } else if (program.kind === 'generator') {
      const second = await runSandboxProgram(version.source, version.language, String(fixture.stdin || ''))
      passed = run.status === 'Accepted' && second.status === 'Accepted' && run.exitCode === 0 && Boolean(run.stdout) && crypto.createHash('sha256').update(run.stdout).digest('hex') === crypto.createHash('sha256').update(second.stdout).digest('hex')
      message = passed ? '双运行输出一致' : '相同 Context 输出不一致或为空'
    } else if (program.kind === 'classifier') {
      try {
        const actual = parseClassifierOutput(run.stdout, knownSubtasks)
        const expected = fixture.expectedSubtasks ? [...fixture.expectedSubtasks].sort((a, b) => a - b) : null
        passed = run.status === 'Accepted' && run.exitCode === 0 && (!expected || JSON.stringify(actual) === JSON.stringify(expected))
        message = expected ? `期望 ${expected.join(',')}，实际 ${actual.join(',')}` : `分类为 ${actual.join(',')}`
      } catch (error) { passed = false; message = error instanceof Error ? error.message : 'Classifier 协议错误' }
    } else {
      passed = run.status === 'Accepted' && run.exitCode === (fixture.expectedExitCode ?? 0) && Boolean(run.stdout.length) && (fixture.expectedStdout === undefined || run.stdout === fixture.expectedStdout)
      message = passed ? '标准程序样例输出检查通过' : '标准程序必须成功运行并产生非空答案'
    }
    reports.push({ name: String(fixture.name || `样例 ${reports.length + 1}`).slice(0, 80), passed, message, exitCode: run.exitCode, stderr: run.stderr })
  }
  if (reports.some(item => !item.passed)) throw new JudgeProgramError(422, 'PROGRAM_PREFLIGHT_FAILED', '协议预检未通过', { fixtures: reports })
  const now = new Date()
  const updated = await prisma.problemJudgeProgramVersion.update({ where: { id: version.id }, data: { lifecycleStatus: 'verified', verifiedAt: now, preflightReport: { fixtures: reports, verifiedAt: now.toISOString() } } })
  logger.audit('judge_program_version_verified', { userId: input.user.userId, role: input.user.role, problemId: input.problemId, programId: program.id, versionId: version.id, kind: program.kind })
  return updated
}

export async function updateJudgeProgram(input: { user: JwtPayload; problemId: string; programId: string; currentVersionId?: string; name?: string; status?: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId } })
  if (!program) throw new JudgeProgramError(404, 'PROGRAM_NOT_FOUND', '评测程序不存在')
  const selected = input.currentVersionId ? await prisma.problemJudgeProgramVersion.findFirst({ where: { id: input.currentVersionId, programId: program.id } }) : null
  if (input.currentVersionId && !selected) throw new JudgeProgramError(400, 'PROGRAM_VERSION_INVALID', '程序版本不属于当前程序')
  if (selected && !['verified', 'active'].includes(selected.lifecycleStatus)) throw new JudgeProgramError(409, 'PROGRAM_VERSION_NOT_VERIFIED', '程序版本必须完成协议预检后才能激活')
  const updated = await prisma.$transaction(async tx => {
    if (selected) {
      await tx.problemJudgeProgramVersion.updateMany({ where: { programId: program.id, lifecycleStatus: 'active', id: { not: selected.id } }, data: { lifecycleStatus: 'retired' } })
      await tx.problemJudgeProgramVersion.update({ where: { id: selected.id }, data: { lifecycleStatus: 'active', activatedAt: new Date() } })
    }
    return tx.problemJudgeProgram.update({ where: { id: program.id }, data: { ...(selected ? { currentVersionId: selected.id, language: selected.language } : {}), ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...(input.status === 'archived' ? { status: 'archived' } : {}) } })
  })
  if (selected) logger.audit('judge_program_version_activated', { userId: input.user.userId, role: input.user.role, problemId: input.problemId, programId: program.id, versionId: selected.id, kind: program.kind })
  if (program.kind === 'classifier' || program.kind === 'validator' || program.kind === 'standard') await refreshAdmittedCandidateStages(input.problemId)
  return updated
}
