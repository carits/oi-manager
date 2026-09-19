import crypto from 'crypto'
import yaml from 'js-yaml'
import type { Prisma } from '@prisma/client'
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
import { queueAwaitingCandidateEvaluations } from './problem.candidate-evaluation.service'

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

export function listJudgeProgramTemplates() {
  return JUDGE_PROGRAM_TEMPLATES.map(({ source: _source, examples, protocolConfig, learningNotes, requiredChanges, ...template }) => ({
    ...template,
    fixtureCount: examples.length,
    profileCount: protocolConfig?.profiles.length || 0,
    hasProtocolConfig: Boolean(protocolConfig),
    learningNoteCount: learningNotes.length,
    requiredChangeCount: requiredChanges.length,
  }))
}
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

export async function listJudgeProgramAuditLogs(user: JwtPayload, problemId: string) {
  await requireProgramProblem(user, problemId)
  return prisma.problemJudgeProgramAuditLog.findMany({
    where: { problemId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, programId: true, versionId: true, actorUserId: true, action: true, metadata: true, createdAt: true },
  })
}

type Fixture = { name?: string; stdin?: string; expectedExitCode?: number; expectedStdout?: string; expectedSubtasks?: number[] }
type CreateProgramInput = { user: JwtPayload; problemId: string; kind: string; name?: string; language?: string; protocol?: string; templateId?: string; templateVersion?: number; source: string; protocolConfig?: unknown; fixtures?: Fixture[]; origin?: string; aiRequestId?: string }
const runtimeMetadata = (kind: JudgeProgramKind, language: JudgeProgramLanguage) => language === 'python3'
  ? { runtime: 'python3', standardLibraryOnly: true }
  : { runtime: 'cpp17', usesTestlib: kind === 'validator' }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function normalizeFixtures(raw: unknown): Array<{ name: string; stdin: string; expectedExitCode?: number; expectedStdout?: string; expectedSubtasks?: number[] }> {
  const values = Array.isArray(raw) ? raw : []
  if (values.length > 50) throw new JudgeProgramError(422, 'PROGRAM_FIXTURES_INVALID', '每组最多 50 条 Fixture')
  let total = 0
  return values.map((item: any, index) => {
    const name = String(item?.name || `Fixture ${index + 1}`).trim().slice(0, 80)
    const stdin = String(item?.stdin || '')
    total += Buffer.byteLength(stdin)
    if (!name || Buffer.byteLength(stdin) > 1024 * 1024 || total > 8 * 1024 * 1024) throw new JudgeProgramError(422, 'PROGRAM_FIXTURES_INVALID', 'Fixture 名称无效、单条超过 1 MiB 或总量超过 8 MiB')
    const expectedSubtasks = Array.isArray(item?.expectedSubtasks) ? item.expectedSubtasks.map(Number) : undefined
    if (expectedSubtasks?.some((id: number) => !Number.isSafeInteger(id) || id <= 0) || (expectedSubtasks && new Set<number>(expectedSubtasks).size !== expectedSubtasks.length)) throw new JudgeProgramError(422, 'PROGRAM_FIXTURES_INVALID', `Fixture ${name} 的 Subtask 期望无效`)
    return {
      name, stdin,
      ...(Number.isInteger(item?.expectedExitCode) ? { expectedExitCode: Number(item.expectedExitCode) } : {}),
      ...(typeof item?.expectedStdout === 'string' ? { expectedStdout: item.expectedStdout } : {}),
      ...(expectedSubtasks ? { expectedSubtasks: expectedSubtasks.sort((a: number, b: number) => a - b) } : {}),
    }
  })
}

function validateProtocolConfig(kind: JudgeProgramKind, value: unknown): Prisma.InputJsonValue | undefined {
  if (kind !== 'generator') return undefined
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value as any : { profiles: [{ id: 'default', label: '默认', params: {} }], parameterSchema: {} }
  const profiles = Array.isArray(config.profiles) ? config.profiles : []
  const schema = config.parameterSchema && typeof config.parameterSchema === 'object' && !Array.isArray(config.parameterSchema) ? config.parameterSchema : {}
  if (!profiles.length || profiles.length > 64 || Object.keys(schema).length > 64) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', 'Generator 必须包含 1～64 个 Profile，参数最多 64 个')
  const seen = new Set<string>()
  const normalizedProfiles = profiles.map((profile: any) => {
    const id = String(profile?.id || '').trim(), label = String(profile?.label || id).trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id) || seen.has(id) || !label || label.length > 80 || !profile?.params || typeof profile.params !== 'object' || Array.isArray(profile.params)) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', 'Generator Profile 配置无效或重复')
    seen.add(id)
    return { id, label, params: profile.params }
  })
  const normalizedSchema: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(schema as Record<string, any>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key) || !rule || !['integer', 'number', 'string', 'boolean'].includes(rule.type)) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', `Generator 参数 ${key} 定义无效`)
    const normalizedRule: Record<string, unknown> = { type: rule.type }
    if (rule.minimum !== undefined) {
      if (typeof rule.minimum !== 'number' || !Number.isFinite(rule.minimum)) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', `Generator 参数 ${key} 的 minimum 无效`)
      normalizedRule.minimum = rule.minimum
    }
    if (rule.maximum !== undefined) {
      if (typeof rule.maximum !== 'number' || !Number.isFinite(rule.maximum) || typeof normalizedRule.minimum === 'number' && rule.maximum < normalizedRule.minimum) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', `Generator 参数 ${key} 的 maximum 无效`)
      normalizedRule.maximum = rule.maximum
    }
    if (rule.enum !== undefined) {
      if (!Array.isArray(rule.enum) || !rule.enum.length || rule.enum.length > 100) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', `Generator 参数 ${key} 的 enum 无效`)
      normalizedRule.enum = rule.enum
    }
    if (Object.prototype.hasOwnProperty.call(rule, 'default')) normalizedRule.default = rule.default
    const validateValue = (value: unknown) => {
      if (rule.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) return false
      if (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false
      if (rule.type === 'string' && typeof value !== 'string') return false
      if (rule.type === 'boolean' && typeof value !== 'boolean') return false
      if (typeof value === 'number' && (typeof rule.minimum === 'number' && value < rule.minimum || typeof rule.maximum === 'number' && value > rule.maximum)) return false
      return !Array.isArray(rule.enum) || rule.enum.some((candidate: unknown) => Object.is(candidate, value))
    }
    if (Object.prototype.hasOwnProperty.call(normalizedRule, 'default') && !validateValue(normalizedRule.default)) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', `Generator 参数 ${key} 的默认值不符合定义`)
    normalizedSchema[key] = normalizedRule
  }
  for (const profile of normalizedProfiles) for (const [key, value] of Object.entries(profile.params as Record<string, unknown>)) {
    const rule = normalizedSchema[key] as Record<string, unknown> | undefined
    if (!rule) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', `Profile 参数 ${key} 未在 Parameter Schema 中声明`)
    const validType = rule.type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value)
      : rule.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === rule.type
    if (!validType) throw new JudgeProgramError(422, 'GENERATOR_PROTOCOL_CONFIG_INVALID', `Profile 参数 ${key} 类型不匹配`)
  }
  return { profiles: normalizedProfiles, parameterSchema: normalizedSchema } as Prisma.InputJsonValue
}

async function createFixtureSet(tx: Prisma.TransactionClient, input: { problemId: string; programId: string; fixtures: unknown; createdBy: string }) {
  const fixtures = normalizeFixtures(input.fixtures)
  const fixtureHash = crypto.createHash('sha256').update(canonical(fixtures)).digest('hex')
  const existing = await tx.problemJudgeProgramFixtureSet.findFirst({ where: { programId: input.programId, fixtureHash } })
  if (existing) return existing
  const max = await tx.problemJudgeProgramFixtureSet.aggregate({ where: { programId: input.programId }, _max: { revision: true } })
  return tx.problemJudgeProgramFixtureSet.create({ data: { id: crypto.randomUUID(), problemId: input.problemId, programId: input.programId, revision: (max._max.revision || 0) + 1, fixtures: fixtures as Prisma.InputJsonValue, fixtureHash, createdBy: input.createdBy } })
}

async function auditProgram(tx: Prisma.TransactionClient, input: { problemId: string; programId: string; versionId?: string | null; actorUserId: string; action: string; metadata?: Prisma.InputJsonValue }) {
  return tx.problemJudgeProgramAuditLog.create({ data: { id: crypto.randomUUID(), problemId: input.problemId, programId: input.programId, versionId: input.versionId || null, actorUserId: input.actorUserId, action: input.action, metadata: input.metadata } })
}

export async function saveJudgeProgramDraft(input: CreateProgramInput & { draftId?: string; programId?: string; expectedRevision?: number }) {
  await requireProgramProblem(input.user, input.problemId)
  const identity = resolveProgramIdentity(input.kind, input.language, input.protocol)
  const template = verifyTemplate({ templateId: input.templateId, ...identity })
  const name = String(input.name || JUDGE_PROGRAM_CAPABILITIES[identity.kind].title).trim()
  if (!name || name.length > 80) throw new JudgeProgramError(400, 'PROGRAM_NAME_INVALID', '程序名称长度必须为 1～80')
  if (!input.source.trim() || Buffer.byteLength(input.source) > 256 * 1024 || input.source.includes('\0')) throw new JudgeProgramError(422, 'PROGRAM_SOURCE_INVALID', '源码不能为空、不能包含 NUL 且最大 256 KiB')
  const fixtures = normalizeFixtures(input.fixtures)
  const protocolConfig = validateProtocolConfig(identity.kind, input.protocolConfig)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`judge-program-draft:${input.problemId}:${input.user.userId}:${identity.kind}`}, 0)) IS NULL AS locked`
    const current = await tx.problemJudgeProgramDraft.findUnique({ where: { problemId_userId_kind: { problemId: input.problemId, userId: input.user.userId, kind: identity.kind } } })
    if (current && input.expectedRevision !== undefined && current.revision !== input.expectedRevision) throw new JudgeProgramError(409, 'PROGRAM_DRAFT_STALE', '评测程序草稿已在其他页面更新')
    return tx.problemJudgeProgramDraft.upsert({
      where: { problemId_userId_kind: { problemId: input.problemId, userId: input.user.userId, kind: identity.kind } },
      create: { id: crypto.randomUUID(), problemId: input.problemId, programId: input.programId || null, userId: input.user.userId, kind: identity.kind, name, language: identity.language, protocol: identity.protocol, templateId: template?.id || null, templateVersion: input.templateVersion || template?.version || null, source: input.source, protocolConfig, fixtures: fixtures as Prisma.InputJsonValue },
      update: { programId: input.programId || current?.programId || null, name, language: identity.language, protocol: identity.protocol, templateId: template?.id || null, templateVersion: input.templateVersion || template?.version || null, source: input.source, protocolConfig, fixtures: fixtures as Prisma.InputJsonValue, revision: { increment: 1 } },
    })
  })
}

export async function deleteJudgeProgramDraft(user: JwtPayload, problemId: string, draftId: string) {
  await requireProgramProblem(user, problemId)
  const changed = await prisma.problemJudgeProgramDraft.deleteMany({ where: { id: draftId, problemId, userId: user.userId } })
  if (!changed.count) throw new JudgeProgramError(404, 'PROGRAM_DRAFT_NOT_FOUND', '评测程序草稿不存在')
  return { deleted: true }
}

export async function listJudgeProgramDrafts(user: JwtPayload, problemId: string) {
  await requireProgramProblem(user, problemId)
  return prisma.problemJudgeProgramDraft.findMany({ where: { problemId, userId: user.userId }, orderBy: { updatedAt: 'desc' } })
}

export async function createJudgeProgram(input: CreateProgramInput) {
  await requireProgramProblem(input.user, input.problemId)
  const identity = resolveProgramIdentity(input.kind, input.language, input.protocol)
  const template = verifyTemplate({ templateId: input.templateId, ...identity })
  const name = String(input.name || JUDGE_PROGRAM_CAPABILITIES[identity.kind].title).trim()
  if (!name || name.length > 80) throw new JudgeProgramError(400, 'PROGRAM_NAME_INVALID', '程序名称长度必须为 1～80')
  if (!input.source.trim() || Buffer.byteLength(input.source) > 256 * 1024 || input.source.includes('\0')) throw new JudgeProgramError(422, 'PROGRAM_SOURCE_INVALID', '源码不能为空、不能包含 NUL 且最大 256 KiB')
  const sourceSha256 = crypto.createHash('sha256').update(input.source).digest('hex')
  const created = await prisma.$transaction(async tx => {
    const id = crypto.randomUUID(), versionId = crypto.randomUUID()
    const program = await tx.problemJudgeProgram.create({ data: { id, problemId: input.problemId, kind: identity.kind, name, language: identity.language, currentVersionId: null, createdBy: input.user.userId } })
    const fixtureSet = await createFixtureSet(tx, { problemId: input.problemId, programId: id, fixtures: input.fixtures || template?.examples || [], createdBy: input.user.userId })
    const version = await tx.problemJudgeProgramVersion.create({ data: {
      id: versionId, programId: id, problemId: input.problemId, versionNumber: 1, language: identity.language, source: input.source, sourceSha256,
      origin: input.origin || 'manual', aiRequestId: input.aiRequestId || null, compileStatus: 'pending', lifecycleStatus: 'draft',
      protocol: identity.protocol, protocolVersion: 1, templateId: template?.id || null, templateVersion: input.templateVersion || template?.version || null,
      runtimeMetadata: runtimeMetadata(identity.kind, identity.language), protocolConfig: validateProtocolConfig(identity.kind, input.protocolConfig), fixtureSetId: fixtureSet.id, createdBy: input.user.userId,
    } })
    await auditProgram(tx, { problemId: input.problemId, programId: id, versionId, actorUserId: input.user.userId, action: 'version_created', metadata: { kind: identity.kind, language: identity.language, protocol: identity.protocol, sourceSha256 } })
    return { program, version }
  })
  logger.audit('judge_program_version_created', { userId: input.user.userId, role: input.user.accountRole, problemId: input.problemId, programId: created.program.id, versionId: created.version.id, kind: identity.kind, language: identity.language, protocol: identity.protocol, sourceSha256 })
  return created
}

export async function createJudgeProgramVersion(input: Omit<CreateProgramInput, 'kind' | 'name'> & { programId: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId, status: 'active' } })
  if (!program) throw new JudgeProgramError(404, 'PROGRAM_NOT_FOUND', '评测程序不存在')
  const identity = resolveProgramIdentity(program.kind, input.language || program.language, input.protocol)
  const template = verifyTemplate({ templateId: input.templateId, ...identity })
  if (!input.source.trim() || Buffer.byteLength(input.source) > 256 * 1024 || input.source.includes('\0')) throw new JudgeProgramError(422, 'PROGRAM_SOURCE_INVALID', '源码不能为空、不能包含 NUL 且最大 256 KiB')
  const sourceSha256 = crypto.createHash('sha256').update(input.source).digest('hex')
  const version = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`judge-program:${program.id}`}, 0)) IS NULL AS locked`
    const max = await tx.problemJudgeProgramVersion.aggregate({ where: { programId: program.id }, _max: { versionNumber: true } })
    const previous = await tx.problemJudgeProgramVersion.findFirst({ where: { programId: program.id }, orderBy: { versionNumber: 'desc' }, select: { FixtureSet: true } })
    const fixtureSet = await createFixtureSet(tx, { problemId: input.problemId, programId: program.id, fixtures: input.fixtures || previous?.FixtureSet?.fixtures || template?.examples || [], createdBy: input.user.userId })
    const created = await tx.problemJudgeProgramVersion.create({ data: {
      id: crypto.randomUUID(), programId: program.id, problemId: input.problemId, versionNumber: (max._max.versionNumber || 0) + 1,
      language: identity.language, source: input.source, sourceSha256, origin: input.origin || 'manual', aiRequestId: input.aiRequestId || null,
      compileStatus: 'pending', lifecycleStatus: 'draft', protocol: identity.protocol, protocolVersion: 1,
      templateId: template?.id || null, templateVersion: input.templateVersion || template?.version || null,
      runtimeMetadata: runtimeMetadata(identity.kind, identity.language), protocolConfig: validateProtocolConfig(identity.kind, input.protocolConfig), fixtureSetId: fixtureSet.id, createdBy: input.user.userId,
    } })
    await auditProgram(tx, { problemId: input.problemId, programId: program.id, versionId: created.id, actorUserId: input.user.userId, action: 'version_created', metadata: { kind: identity.kind, language: identity.language, protocol: identity.protocol, sourceSha256 } })
    return created
  })
  logger.audit('judge_program_version_created', { userId: input.user.userId, role: input.user.accountRole, problemId: input.problemId, programId: program.id, versionId: version.id, kind: identity.kind, language: identity.language, protocol: identity.protocol, sourceSha256 })
  return version
}

async function queueVerification(input: { user: JwtPayload; problemId: string; programId: string; versionId: string; mode: 'compile' | 'preflight'; fixtureSetId?: string; fixtures?: Fixture[] }) {
  await requireProgramProblem(input.user, input.problemId)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`judge-program:${input.programId}`}, 0)) IS NULL AS locked`
    const program = await tx.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId, status: 'active' } })
    const version = program ? await tx.problemJudgeProgramVersion.findFirst({ where: { id: input.versionId, programId: program.id, problemId: input.problemId } }) : null
    if (!program || !version) throw new JudgeProgramError(404, 'PROGRAM_VERSION_NOT_FOUND', '评测程序版本不存在')
    if (input.mode === 'compile' && !(version.lifecycleStatus === 'draft' && ['pending', 'failed'].includes(version.compileStatus))) throw new JudgeProgramError(409, 'PROGRAM_VERSION_STATE_CONFLICT', '只有尚未成功编译的草稿版本可以编译')
    if (input.mode === 'preflight' && version.lifecycleStatus !== 'compiled') throw new JudgeProgramError(409, 'PROGRAM_VERSION_STATE_CONFLICT', '只有已编译版本可以执行协议预检')
    if (await tx.problemJudgeProgramVerificationJob.count({ where: { versionId: version.id, status: { in: ['queued', 'running'] } } })) throw new JudgeProgramError(409, 'PROGRAM_VERIFICATION_ACTIVE', '该版本已有验证任务正在执行')
    const fixtureSet = input.fixtureSetId
      ? await tx.problemJudgeProgramFixtureSet.findFirst({ where: { id: input.fixtureSetId, programId: program.id, problemId: input.problemId } })
      : input.fixtures
        ? await createFixtureSet(tx, { problemId: input.problemId, programId: program.id, fixtures: input.fixtures, createdBy: input.user.userId })
        : version.fixtureSetId
          ? await tx.problemJudgeProgramFixtureSet.findFirst({ where: { id: version.fixtureSetId, programId: program.id } })
          : null
    if (!fixtureSet) throw new JudgeProgramError(422, 'PROGRAM_FIXTURES_REQUIRED', '请先保存 Fixture Set')
    const fixtures = normalizeFixtures(fixtureSet.fixtures)
    if (input.mode === 'preflight') {
      if (!fixtures.length) throw new JudgeProgramError(422, 'PROGRAM_FIXTURES_REQUIRED', '至少提供一条 Fixture')
      if (program.kind === 'validator' && (!fixtures.some(item => item.expectedExitCode === 0) || !fixtures.some(item => item.expectedExitCode !== undefined && item.expectedExitCode !== 0))) throw new JudgeProgramError(422, 'VALIDATOR_FIXTURES_INCOMPLETE', 'Validator 必须同时包含应通过与应拒绝 Fixture')
      if (program.kind === 'classifier' && fixtures.some(item => !item.expectedSubtasks?.length)) throw new JudgeProgramError(422, 'CLASSIFIER_FIXTURES_INCOMPLETE', 'Classifier Fixture 必须填写预期全部 Subtask')
    }
    const job = await tx.problemJudgeProgramVerificationJob.create({ data: { id: crypto.randomUUID(), problemId: input.problemId, programId: program.id, versionId: version.id, fixtureSetId: fixtureSet.id, mode: input.mode, createdBy: input.user.userId } })
    await tx.problemJudgeProgramVersion.update({ where: { id: version.id }, data: { fixtureSetId: fixtureSet.id, ...(input.mode === 'compile' ? { compileStatus: 'pending', compileMessage: null } : {}) } })
    await auditProgram(tx, { problemId: input.problemId, programId: program.id, versionId: version.id, actorUserId: input.user.userId, action: `${input.mode}_queued`, metadata: { jobId: job.id, fixtureSetId: fixtureSet.id } })
    return job
  })
}

export async function compileJudgeProgramVersion(input: { user: JwtPayload; problemId: string; programId: string; versionId: string }) {
  return queueVerification({ ...input, mode: 'compile' })
}

export async function preflightJudgeProgramVersion(input: { user: JwtPayload; problemId: string; programId: string; versionId: string; fixtureSetId?: string; fixtures?: Fixture[] }) {
  return queueVerification({ ...input, mode: 'preflight' })
}

export async function createJudgeProgramFixtureSet(input: { user: JwtPayload; problemId: string; programId: string; fixtures: Fixture[] }) {
  await requireProgramProblem(input.user, input.problemId)
  return prisma.$transaction(async tx => {
    const program = await tx.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId, status: 'active' } })
    if (!program) throw new JudgeProgramError(404, 'PROGRAM_NOT_FOUND', '评测程序不存在')
    return createFixtureSet(tx, { problemId: input.problemId, programId: input.programId, fixtures: input.fixtures, createdBy: input.user.userId })
  })
}

export async function listJudgeProgramFixtureSets(user: JwtPayload, problemId: string, programId: string) {
  await requireProgramProblem(user, problemId)
  return prisma.problemJudgeProgramFixtureSet.findMany({ where: { problemId, programId }, orderBy: { revision: 'desc' } })
}

export async function getJudgeProgramVerification(user: JwtPayload, problemId: string, programId: string, versionId: string) {
  await requireProgramProblem(user, problemId)
  return prisma.problemJudgeProgramVerificationJob.findMany({ where: { problemId, programId, versionId }, orderBy: { createdAt: 'desc' }, take: 20 })
}

async function activeVersionForKind(tx: Prisma.TransactionClient, problemId: string, kind: string) {
  const program = await tx.problemJudgeProgram.findFirst({ where: { problemId, kind, status: 'active', currentVersionId: { not: null } }, orderBy: { updatedAt: 'desc' } })
  if (!program?.currentVersionId) return null
  return tx.problemJudgeProgramVersion.findFirst({ where: { id: program.currentVersionId, programId: program.id, problemId, lifecycleStatus: 'active', compileStatus: 'passed' } })
}

export async function claimJudgeProgramVerificationJob(judgeId: string) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ProblemJudgeProgramVerificationJob" WHERE status='queued' ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const job = await tx.problemJudgeProgramVerificationJob.findUnique({ where: { id: rows[0].id }, include: { Program: true, Version: true, FixtureSet: true } })
    if (!job || (job.mode === 'compile' ? job.Version.lifecycleStatus !== 'draft' : job.Version.lifecycleStatus !== 'compiled')) {
      if (job) await tx.problemJudgeProgramVerificationJob.update({ where: { id: job.id }, data: { status: 'cancelled', errorCode: 'PROGRAM_VERSION_STATE_CONFLICT', errorMessage: '版本状态已变化', finishedAt: new Date() } })
      return null
    }
    const fencingToken = crypto.randomUUID()
    const changed = await tx.problemJudgeProgramVerificationJob.updateMany({ where: { id: job.id, status: 'queued' }, data: { status: 'running', judgeId, fencingToken, leaseExpiresAt: new Date(Date.now() + 10 * 60_000), startedAt: new Date(), attemptCount: { increment: 1 } } })
    if (!changed.count) return null
    const problem = await tx.problem.findUnique({ where: { id: job.problemId }, include: { LatestTestSetRevision: { select: { judgeConfig: true } } } })
    const problemConfig = yaml.load(problem?.LatestTestSetRevision?.judgeConfig || problem?.judgeConfig || '{}') as any
    const [validator, standard] = job.mode === 'preflight' && ['classifier', 'generator'].includes(job.Program.kind)
      ? await Promise.all([activeVersionForKind(tx, job.problemId, 'validator'), job.Program.kind === 'generator' ? activeVersionForKind(tx, job.problemId, 'standard') : Promise.resolve(null)])
      : [null, null]
    return {
      taskType: 'judge_program_verification' as const,
      jobId: job.id, problemId: job.problemId, programId: job.programId, versionId: job.versionId, fixtureSetId: job.fixtureSetId, fencingToken,
      mode: job.mode as 'compile' | 'preflight', kind: job.Program.kind as JudgeProgramKind, language: job.Version.language as 'cpp17' | 'python3', protocol: job.Version.protocol,
      source: job.Version.source, fixtures: normalizeFixtures(job.FixtureSet.fixtures),
      knownSubtaskIds: (problemConfig?.subtasks || []).map((item: any, index: number) => Number(item.id || index + 1)), problemConfig,
      integration: { validator: validator ? { language: validator.language, source: validator.source } : undefined, standard: standard ? { language: 'cpp17' as const, source: standard.source } : undefined },
    }
  })
}

export async function finalizeJudgeProgramVerificationJob(judgeId: string, payload: any) {
  return prisma.$transaction(async tx => {
    const job = await tx.problemJudgeProgramVerificationJob.findFirst({ where: { id: String(payload?.jobId || ''), judgeId, fencingToken: String(payload?.fencingToken || ''), status: 'running' }, include: { Version: true, Program: true } })
    if (!job) return { stale: true }
    const outcome = String(payload?.outcome || 'infrastructure_error')
    if (outcome === 'infrastructure_error' && job.attemptCount < 3) {
      await tx.problemJudgeProgramVerificationJob.update({ where: { id: job.id }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null, errorCode: String(payload?.code || 'PROGRAM_INFRA_ERROR'), errorMessage: String(payload?.message || '').slice(0, 4000) } })
      return { stale: false, requeued: true }
    }
    const success = outcome === 'success'
    await tx.problemJudgeProgramVerificationJob.update({ where: { id: job.id }, data: { status: success ? 'completed' : 'failed', report: payload?.report || undefined, errorCode: success ? null : String(payload?.code || 'PROGRAM_VERIFICATION_FAILED'), errorMessage: success ? null : String(payload?.message || '').slice(0, 4000), leaseExpiresAt: null, finishedAt: new Date() } })
    if (outcome === 'infrastructure_error') {
      // Exhausting infrastructure retries fails this verification job, not
      // the immutable source version. Keep the version retryable: a compile
      // job remains a draft/pending version and a preflight job remains in
      // the already compiled state.
      if (job.mode === 'compile') {
        await tx.problemJudgeProgramVersion.update({ where: { id: job.versionId }, data: { compileStatus: 'pending', compileMessage: String(payload?.safeMessage || '评测基础设施暂时不可用').slice(0, 4000), lifecycleStatus: 'draft' } })
      }
    } else if (job.mode === 'compile') {
      await tx.problemJudgeProgramVersion.update({ where: { id: job.versionId }, data: { compileStatus: success ? 'passed' : 'failed', compileMessage: success ? null : String(payload?.message || '').slice(0, 4000), lifecycleStatus: success ? 'compiled' : 'draft', runtimeMetadata: { ...(job.Version.runtimeMetadata as any || {}), verifiedByJudge: judgeId } } })
    } else if (success) {
      await tx.problemJudgeProgramVersion.update({ where: { id: job.versionId }, data: { lifecycleStatus: 'verified', preflightReport: payload.report || {}, verifiedAt: new Date() } })
    } else {
      await tx.problemJudgeProgramVersion.update({ where: { id: job.versionId }, data: { preflightReport: payload.report || {} } })
    }
    await auditProgram(tx, { problemId: job.problemId, programId: job.programId, versionId: job.versionId, actorUserId: job.createdBy, action: success ? `${job.mode}_succeeded` : `${job.mode}_failed`, metadata: { jobId: job.id, code: payload?.code, outcome } })
    return { stale: false, requeued: false }
  })
}

export async function recoverJudgeProgramVerificationJobs(judgeId: string) {
  return prisma.problemJudgeProgramVerificationJob.updateMany({ where: { judgeId, status: 'running' }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null } })
}

export async function updateJudgeProgram(input: { user: JwtPayload; problemId: string; programId: string; currentVersionId?: string; name?: string; status?: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId } })
  if (!program) throw new JudgeProgramError(404, 'PROGRAM_NOT_FOUND', '评测程序不存在')
  const selected = input.currentVersionId ? await prisma.problemJudgeProgramVersion.findFirst({ where: { id: input.currentVersionId, programId: program.id } }) : null
  if (input.currentVersionId && !selected) throw new JudgeProgramError(400, 'PROGRAM_VERSION_INVALID', '程序版本不属于当前程序')
  if (selected && selected.lifecycleStatus !== 'verified' && !(selected.lifecycleStatus === 'active' && program.currentVersionId === selected.id)) throw new JudgeProgramError(409, 'PROGRAM_VERSION_STATE_CONFLICT', '只有已完成协议预检的版本可以激活')
  const updated = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`judge-program:${program.id}`}, 0)) IS NULL AS locked`
    if (selected) {
      await tx.problemJudgeProgramVersion.updateMany({ where: { programId: program.id, lifecycleStatus: 'active', id: { not: selected.id } }, data: { lifecycleStatus: 'retired' } })
      await tx.problemJudgeProgramVersion.update({ where: { id: selected.id }, data: { lifecycleStatus: 'active', activatedAt: new Date() } })
      const sourceField = program.kind === 'standard' ? { standardProgramVersionId: selected.id, standardSource: selected.source, standardLanguage: selected.language }
        : program.kind === 'validator' ? { validatorProgramVersionId: selected.id, validatorSource: selected.source, validatorLanguage: selected.language }
          : program.kind === 'classifier' ? { classifierProgramVersionId: selected.id, classifierSource: selected.source, classifierLanguage: selected.language } : {}
      if (program.kind !== 'generator') await tx.problemHackConfig.updateMany({ where: { problemId: input.problemId }, data: { ...sourceField, revision: { increment: 1 }, updatedBy: input.user.userId } })
    }
    const result = await tx.problemJudgeProgram.update({ where: { id: program.id }, data: { ...(selected ? { currentVersionId: selected.id, language: selected.language } : {}), ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...(input.status === 'archived' ? { status: 'archived' } : {}) } })
    await auditProgram(tx, { problemId: input.problemId, programId: program.id, versionId: selected?.id, actorUserId: input.user.userId, action: selected ? 'version_activated' : input.status === 'archived' ? 'program_retired' : 'program_updated', metadata: selected ? { previousVersionId: program.currentVersionId } : undefined })
    return result
  })
  if (selected) logger.audit('judge_program_version_activated', { userId: input.user.userId, role: input.user.accountRole, problemId: input.problemId, programId: program.id, versionId: selected.id, kind: program.kind })
  if (program.kind === 'classifier' || program.kind === 'validator' || program.kind === 'standard') {
    await refreshAdmittedCandidateStages(input.problemId)
    await queueAwaitingCandidateEvaluations(input.problemId)
    if (selected || input.status === 'archived') {
      await import('./problem.quality.service').then(({ enqueueLatestQualityAfterEvidenceChange }) =>
        enqueueLatestQualityAfterEvidenceChange(input.problemId, input.user.userId),
      ).catch(error => logger.warn('quality_evaluation_program_change_enqueue_skipped', {
        userId: input.user.userId,
        problemId: input.problemId,
        programId: program.id,
        error: (error as Error).message,
      }))
    }
  }
  return updated
}
