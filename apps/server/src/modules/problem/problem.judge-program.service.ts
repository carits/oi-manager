import crypto from 'crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { canModifyProblem } from './problem.access'
import { validateHackCppSource } from './problem.hack.service'
import { refreshAdmittedCandidateStages } from './problem.contribution-readiness.service'

export const JUDGE_PROGRAM_KINDS = ['standard', 'validator', 'classifier', 'generator'] as const
export class JudgeProgramError extends Error { constructor(public statusCode: number, public code: string, message: string) { super(message) } }

export async function requireProgramProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canModifyProblem(user, problem)) throw new JudgeProgramError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  return problem
}

function validateKindLanguage(kind: string, language: string) {
  if (!JUDGE_PROGRAM_KINDS.includes(kind as any)) throw new JudgeProgramError(400, 'PROGRAM_KIND_INVALID', '评测程序类型无效')
  if (!(kind === 'generator' ? ['cpp17', 'python3'] : ['cpp17']).includes(language)) throw new JudgeProgramError(400, 'PROGRAM_LANGUAGE_INVALID', `${kind} 不支持 ${language}`)
}

export async function compileJudgeProgram(source: string, language: string, label = '评测程序') {
  if (!source.trim()) throw new JudgeProgramError(400, 'PROGRAM_SOURCE_EMPTY', `${label}源码不能为空`)
  if (Buffer.byteLength(source, 'utf8') > 256 * 1024) throw new JudgeProgramError(413, 'PROGRAM_SOURCE_TOO_LARGE', `${label}源码不能超过 256 KiB`)
  if (source.includes('\0')) throw new JudgeProgramError(400, 'PROGRAM_SOURCE_INVALID', '源码不能包含 NUL 字符')
  if (language === 'cpp17') {
    try { await validateHackCppSource(source, label) }
    catch (error) { throw new JudgeProgramError(422, 'PROGRAM_COMPILE_ERROR', error instanceof Error ? error.message : `${label}编译失败`) }
    return
  }
  if (language !== 'python3') throw new JudgeProgramError(400, 'PROGRAM_LANGUAGE_INVALID', '不支持的程序语言')
  const response = await fetch(`${process.env.SANDBOX_HOST || 'http://127.0.0.1:5050'}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: [{
      args: ['python3', '-m', 'py_compile', 'main.py'], copyIn: { 'main.py': { content: source } }, copyOut: ['stderr?'],
      cpuLimit: 10_000_000_000, clockLimit: 15_000_000_000, memoryLimit: 268_435_456, procLimit: 20,
    }] }),
  })
  if (!response.ok) throw new JudgeProgramError(503, 'SANDBOX_UNAVAILABLE', `沙箱返回 HTTP ${response.status}`)
  const result = (await response.json() as any[])?.[0]
  if (!result || result.exitStatus !== 0) throw new JudgeProgramError(422, 'PROGRAM_COMPILE_ERROR', String(result?.files?.stderr || result?.status || 'Python 语法检查失败').slice(0, 4000))
}

export async function listJudgePrograms(user: JwtPayload, problemId: string) {
  await requireProgramProblem(user, problemId)
  const programs = await prisma.problemJudgeProgram.findMany({ where: { problemId, status: 'active' }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] })
  const versions = await prisma.problemJudgeProgramVersion.findMany({ where: { programId: { in: programs.map(item => item.id) } }, orderBy: { versionNumber: 'desc' } })
  return programs.map(program => ({ ...program, versions: versions.filter(version => version.programId === program.id) }))
}

export async function createJudgeProgram(input: { user: JwtPayload; problemId: string; kind: string; name?: string; language?: string; source: string; origin?: string; aiRequestId?: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const language = input.language || 'cpp17'; validateKindLanguage(input.kind, language)
  const name = String(input.name || ({ standard: 'STD', validator: 'Validator', classifier: 'Classifier', generator: 'Generator' } as any)[input.kind]).trim()
  if (!name || name.length > 80) throw new JudgeProgramError(400, 'PROGRAM_NAME_INVALID', '程序名称长度必须为 1～80')
  await compileJudgeProgram(input.source, language, name)
  const sourceSha256 = crypto.createHash('sha256').update(input.source).digest('hex')
  const created = await prisma.$transaction(async tx => {
    const id = crypto.randomUUID(), versionId = crypto.randomUUID()
    const program = await tx.problemJudgeProgram.create({ data: { id, problemId: input.problemId, kind: input.kind, name, language, currentVersionId: versionId, createdBy: input.user.userId } })
    const version = await tx.problemJudgeProgramVersion.create({ data: { id: versionId, programId: id, problemId: input.problemId, versionNumber: 1, language, source: input.source, sourceSha256, origin: input.origin || 'manual', aiRequestId: input.aiRequestId || null, compileStatus: 'passed', createdBy: input.user.userId } })
    return { program, version }
  })
  if (input.kind === 'classifier' || input.kind === 'validator' || input.kind === 'standard') await refreshAdmittedCandidateStages(input.problemId)
  return created
}

export async function createJudgeProgramVersion(input: { user: JwtPayload; problemId: string; programId: string; language?: string; source: string; origin?: string; aiRequestId?: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId, status: 'active' } })
  if (!program) throw new JudgeProgramError(404, 'PROGRAM_NOT_FOUND', '评测程序不存在')
  const language = input.language || program.language; validateKindLanguage(program.kind, language); await compileJudgeProgram(input.source, language, program.name)
  const version = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`judge-program:${program.id}`}, 0)) IS NULL AS locked`
    const max = await tx.problemJudgeProgramVersion.aggregate({ where: { programId: program.id }, _max: { versionNumber: true } })
    const created = await tx.problemJudgeProgramVersion.create({ data: { id: crypto.randomUUID(), programId: program.id, problemId: input.problemId, versionNumber: (max._max.versionNumber || 0) + 1, language, source: input.source, sourceSha256: crypto.createHash('sha256').update(input.source).digest('hex'), origin: input.origin || 'manual', aiRequestId: input.aiRequestId || null, compileStatus: 'passed', createdBy: input.user.userId } })
    await tx.problemJudgeProgram.update({ where: { id: program.id }, data: { currentVersionId: created.id, language } })
    return created
  })
  if (program.kind === 'classifier' || program.kind === 'validator' || program.kind === 'standard') await refreshAdmittedCandidateStages(input.problemId)
  return version
}

export async function updateJudgeProgram(input: { user: JwtPayload; problemId: string; programId: string; currentVersionId?: string; name?: string; status?: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const program = await prisma.problemJudgeProgram.findFirst({ where: { id: input.programId, problemId: input.problemId } })
  if (!program) throw new JudgeProgramError(404, 'PROGRAM_NOT_FOUND', '评测程序不存在')
  if (input.currentVersionId && !await prisma.problemJudgeProgramVersion.findFirst({ where: { id: input.currentVersionId, programId: program.id } })) throw new JudgeProgramError(400, 'PROGRAM_VERSION_INVALID', '程序版本不属于当前程序')
  const updated = await prisma.problemJudgeProgram.update({ where: { id: program.id }, data: { ...(input.currentVersionId ? { currentVersionId: input.currentVersionId } : {}), ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...(input.status === 'archived' ? { status: 'archived' } : {}) } })
  if (program.kind === 'classifier' || program.kind === 'validator' || program.kind === 'standard') await refreshAdmittedCandidateStages(input.problemId)
  return updated
}
