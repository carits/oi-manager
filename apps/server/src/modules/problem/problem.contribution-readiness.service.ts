import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { canModifyProblem, canViewProblem } from './problem.access'
import { parseJudgeConfig, resolveJudgeMode } from './problem.hack.service'
import { parseSubtaskIds, resolveCorpusMode } from './problem.oi-candidate-policy'
import { resolveSubtaskReadiness } from './problem.subtask-readiness.service'

export type ContributionAssetStatus = 'none' | 'draft' | 'verifying' | 'failed' | 'ready' | 'active'

export class ContributionReadinessError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

type AssetKind = 'standard' | 'validator' | 'classifier' | 'generator'

export async function resolveActiveProgramVersion(problemId: string, kind: AssetKind) {
  const config = await prisma.problemHackConfig.findUnique({
    where: { problemId },
    select: {
      standardProgramVersionId: true,
      validatorProgramVersionId: true,
      classifierProgramVersionId: true,
    },
  })
  const configuredId = kind === 'standard'
    ? config?.standardProgramVersionId
    : kind === 'validator'
      ? config?.validatorProgramVersionId
      : kind === 'classifier'
        ? config?.classifierProgramVersionId
        : null
  if (configuredId) {
    const version = await prisma.problemJudgeProgramVersion.findFirst({
      where: { id: configuredId, problemId, compileStatus: 'passed', lifecycleStatus: 'active' },
    })
    if (version) {
      const program = await prisma.problemJudgeProgram.findFirst({
        where: { id: version.programId, problemId, kind, status: 'active' },
      })
      if (program) return { version, program }
    }
  }
  const programs = await prisma.problemJudgeProgram.findMany({
    where: { problemId, kind, status: 'active', currentVersionId: { not: null } },
    orderBy: { updatedAt: 'desc' },
  })
  for (const program of programs) {
    const version = await prisma.problemJudgeProgramVersion.findFirst({
      where: { id: program.currentVersionId!, programId: program.id, problemId, compileStatus: 'passed', lifecycleStatus: 'active' },
    })
    if (version) return { version, program }
  }
  return null
}

async function assetStatus(problemId: string, kind: AssetKind, active: Awaited<ReturnType<typeof resolveActiveProgramVersion>>) {
  if (active) return { status: 'active' as const, versionId: active.version.id }
  const versions = await prisma.problemJudgeProgramVersion.findMany({
    where: { problemId, ...(kind ? { programId: { in: (await prisma.problemJudgeProgram.findMany({ where: { problemId, kind }, select: { id: true } })).map(item => item.id) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { compileStatus: true, lifecycleStatus: true },
  })
  const status = versions[0]?.lifecycleStatus === 'verified'
    ? 'ready'
    : versions[0]?.compileStatus === 'failed'
    ? 'failed'
    : versions[0]?.compileStatus === 'verifying' || versions[0]?.compileStatus === 'pending'
      ? 'verifying'
      : versions.length
        ? 'draft'
        : 'none'
  return { status: status as ContributionAssetStatus }
}

export async function resolveContributionContext(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: { TestSetSlots: { where: { slot: { in: ['EVOLVING', 'STABLE'] } }, select: { slot: true, judgeConfig: true } } },
  })
  if (!problem) throw new ContributionReadinessError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  const canManage = canModifyProblem(user, problem)
  const canAccess = canManage || (problem.status === 'published' && canViewProblem(user, problem))
  if (!canAccess) throw new ContributionReadinessError(404, 'PROBLEM_NOT_FOUND', '题目不存在或当前身份不能贡献数据')

  const selectedSlot = problem.TestSetSlots.find(item => item.slot === 'EVOLVING') || problem.TestSetSlots.find(item => item.slot === 'STABLE')
  const judgeConfig = selectedSlot?.judgeConfig || problem.judgeConfig || ''
  const mode = resolveJudgeMode(parseJudgeConfig(judgeConfig))
  const [standardProgram, validatorProgram, classifierProgram, hackConfig, corpus, validatorSpec, subtaskReadiness] = await Promise.all([
    resolveActiveProgramVersion(problemId, 'standard'),
    resolveActiveProgramVersion(problemId, 'validator'),
    resolveActiveProgramVersion(problemId, 'classifier'),
    prisma.problemHackConfig.findUnique({ where: { problemId }, select: { enabled: true, standardProgramVersionId: true, validatorProgramVersionId: true, classifierProgramVersionId: true } }),
    prisma.wrongCorpusRevision.findFirst({ where: { problemId, status: 'active' }, orderBy: { revisionNumber: 'desc' } }),
    prisma.validatorSpec.findFirst({ where: { problemId }, orderBy: { versionNumber: 'desc' }, select: { status: true, compileStatus: true } }),
    mode === 'oi' ? resolveSubtaskReadiness(problemId) : Promise.resolve([]),
  ])
  const [standard, validatorBase, classifier] = await Promise.all([
    assetStatus(problemId, 'standard', standardProgram),
    assetStatus(problemId, 'validator', validatorProgram),
    assetStatus(problemId, 'classifier', classifierProgram),
  ])
  const validator = validatorProgram
    ? { ...validatorBase, source: validatorProgram.version.origin === 'validator_dsl' ? 'dsl' as const : 'custom' as const }
    : validatorSpec?.status === 'active'
      ? { status: 'ready' as const, source: 'dsl' as const }
      : validatorSpec?.compileStatus === 'passed'
        ? { status: 'ready' as const, source: 'dsl' as const }
        : validatorBase

  const blockers: Array<{ code: string; message: string }> = []
  if (!canManage && problem.status !== 'published') blockers.push({ code: 'CONTRIBUTION_NOT_AVAILABLE', message: '当前题目尚未发布，暂不能贡献数据' })
  if (!standardProgram) blockers.push({ code: 'STD_NOT_ACTIVE', message: '当前题目尚未启用标准答案程序' })
  if (!validatorProgram) blockers.push({ code: 'VALIDATOR_NOT_ACTIVE', message: '当前题目尚未启用输入校验规则' })
  if (!canManage && mode === 'oi' && subtaskReadiness.length > 0 && subtaskReadiness.every(item => item.contributionMode === 'closed')) {
    blockers.push({ code: 'WRONG_CORPUS_REQUIRED', message: '当前题目正在建立错误程序样本，暂时无法可靠评估新增数据价值' })
  }

  const warnings: Array<{ code: string; message: string }> = []
  if (mode === 'oi' && !classifierProgram) warnings.push({ code: 'CLASSIFIER_NOT_ACTIVE', message: '子任务分类程序尚未启用；候选数据会先完成输入校验，然后等待分类，不会进入正式数据' })
  const wrongCorpusStatus: 'none' | 'bootstrap' | 'ready' = !corpus ? 'none' : corpus.corpusHash?.startsWith('ready:') ? 'ready' : 'bootstrap'
  if (wrongCorpusStatus !== 'ready') warnings.push({ code: 'WRONG_CORPUS_NOT_READY', message: '错误程序评估样本仍在准备；候选数据可以提交，但不会自动进入正式数据' })
  if (mode === 'oi' && subtaskReadiness.some(item => item.contributionMode === 'limited')) warnings.push({ code: 'WRONG_CORPUS_INSUFFICIENT_FOR_AUTO_SELECTION', message: '部分子任务仍在观察阶段，可以接收候选数据，但暂不会自动替换正式数据' })
  const hackAssetsSelected = Boolean(hackConfig?.standardProgramVersionId === standardProgram?.version.id && hackConfig?.validatorProgramVersionId === validatorProgram?.version.id && (mode !== 'oi' || hackConfig?.classifierProgramVersionId === classifierProgram?.version.id))
  if (hackConfig?.enabled && !hackAssetsSelected) warnings.push({ code: 'HACK_ASSET_SELECTION_REQUIRED', message: 'Hack 配置尚未固定到当前激活的评测程序版本，请由管理员重新保存 Hack 设置' })

  return {
    problem,
    canManage,
    mode,
    standardProgram,
    validatorProgram,
    classifierProgram,
    public: {
      canContribute: blockers.length === 0,
      canHack: blockers.filter(item => item.code !== 'WRONG_CORPUS_REQUIRED').length === 0 && Boolean(hackConfig?.enabled) && (mode !== 'oi' || Boolean(classifierProgram)) && hackAssetsSelected,
      canManage,
      mode,
      standard,
      validator,
      classifier: { ...classifier, requiredForHack: mode === 'oi', requiredForPromotion: mode === 'oi' },
      wrongCorpus: {
        status: wrongCorpusStatus,
        mode: mode === 'oi'
          ? subtaskReadiness.some(item => item.contributionMode === 'open') ? 'open' : subtaskReadiness.some(item => item.contributionMode === 'limited') ? 'limited' : 'closed'
          : resolveCorpusMode(corpus?.sampleCount || 0, corpus?.clusterCount || 0),
      },
      ...(canManage ? { subtasks: subtaskReadiness } : {}),
      blockers,
      warnings,
    },
  }
}

export async function requireContributionReady(user: JwtPayload, problemId: string) {
  const context = await resolveContributionContext(user, problemId)
  const blocker = context.public.blockers[0]
  if (blocker) throw new ContributionReadinessError(409, blocker.code, blocker.message)
  return context
}

export async function refreshAdmittedCandidateStages(problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId }, include: { TestSetSlots: { where: { slot: { in: ['EVOLVING', 'STABLE'] } }, select: { slot: true, judgeConfig: true } } } })
  if (!problem) return { updated: 0 }
  const selectedSlot = problem.TestSetSlots.find(item => item.slot === 'EVOLVING') || problem.TestSetSlots.find(item => item.slot === 'STABLE')
  const mode = resolveJudgeMode(parseJudgeConfig(selectedSlot?.judgeConfig || problem.judgeConfig || ''))
  const [classifier, corpus, subtasks] = await Promise.all([
    mode === 'oi' ? resolveActiveProgramVersion(problemId, 'classifier') : Promise.resolve(null),
    prisma.wrongCorpusRevision.findFirst({ where: { problemId, status: 'active' } }),
    mode === 'oi' ? resolveSubtaskReadiness(problemId) : Promise.resolve([]),
  ])
  const candidates = await prisma.testcaseCandidate.findMany({ where: { problemId, status: 'ADMITTED', evaluationStage: { in: ['awaiting_classifier', 'awaiting_corpus', 'awaiting_evaluator'] } }, select: { id: true, affectedSubtaskIds: true } })
  let updated = 0
  for (const candidate of candidates) {
    const affected = parseSubtaskIds(candidate.affectedSubtaskIds)
    const eligibleSubtask = mode !== 'oi' || subtasks.some(item => affected.includes(item.subtaskId) && item.contributionMode !== 'closed')
    const evaluationStage = mode === 'oi' && !classifier ? 'awaiting_classifier' : !eligibleSubtask || !corpus?.clusterCount ? 'awaiting_corpus' : 'awaiting_evaluator'
    const changed = await prisma.testcaseCandidate.updateMany({ where: { id: candidate.id, status: 'ADMITTED' }, data: { evaluationStage } })
    updated += changed.count
  }
  return { updated }
}
