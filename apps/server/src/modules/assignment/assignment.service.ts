import crypto from 'node:crypto'
import yaml from 'js-yaml'
import { Prisma, type AssignmentStatus } from '@prisma/client'
import { prisma } from '../../prisma'
import { hasOrganizationCapability, hasTeamCapability } from '../authorization/capabilities'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo } from '../judge/domain/submission-io'
import { calculateAssignmentGrade, judgeMaxScoreFromSnapshot, mapJudgeScore } from './assignment-grading'
import { canManageAssignmentResource } from './assignment.policy'
import { CURRENT_JUDGE_RUN_SELECT, projectSubmissionJudgeResult } from '../judge/application/judge-read-projection'
import { AssignmentError } from './assignment.error'
import {
  ASSIGNMENT_STATUSES,
  COMPLETION_POLICIES,
  PROBLEM_CATEGORIES,
  assignmentCreateInput,
  boundedInteger,
  boundedText,
  clientRevision,
  enumValue,
  optionalDate,
  validateProblemRows,
} from './assignment.input'

export { AssignmentError } from './assignment.error'

const ASSIGNMENT_INCLUDE = {
  CreatorMembership: { select: { id: true, userId: true, memberRole: true } },
  Problems: {
    orderBy: { orderIndex: 'asc' as const },
    include: {
      Problem: { select: { id: true, platform: true, problemId: true, title: true, difficulty: true, allowedLanguages: true } },
      TestSetRevision: { select: { id: true, revisionNumber: true, mode: true, judgeConfigHash: true } },
    },
  },
  Recipients: {
    orderBy: { assignedAt: 'asc' as const },
    include: { User: { select: { id: true, username: true, avatar: true } } },
  },
} satisfies Prisma.AssignmentInclude

type AssignmentShape = Prisma.AssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>
type ValidationIssue = { path: string; code: string; message: string }


function serializeAssignment(item: AssignmentShape, recipients: 'all' | 'none' | string = 'all') {
  const visibleRecipients = recipients === 'all' ? item.Recipients : recipients === 'none' ? [] : item.Recipients.filter(recipient => recipient.userId === recipients)
  return {
    ...item,
    Problems: item.Problems.map(({ judgeConfigSnapshot: _judgeConfigSnapshot, ...problem }) => problem),
    Recipients: visibleRecipients,
    editable: item.status === 'DRAFT',
    problemCount: item.Problems.length,
    recipientCount: item.Recipients.filter(recipient => recipient.status !== 'REMOVED').length,
  }
}

async function globalAccount(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
}

async function actorMembership(userId: string, organizationId: string) {
  return prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { Organization: { include: { School: { select: { directoryStatus: true } } } } },
  })
}

async function assertCreatePermission(userId: string, organizationId: string, teamId: string | null) {
  const membership = await actorMembership(userId, organizationId)
  if (!membership || !await hasOrganizationCapability(userId, organizationId, 'assignment.create', { requireMembership: true })) {
    throw new AssignmentError(403, 'ASSIGNMENT_FORBIDDEN', '需要当前学校的教师或负责人身份')
  }
  if (membership.Organization.status !== 'active' || membership.Organization.School?.directoryStatus === 'legacy') {
    throw new AssignmentError(404, 'ORGANIZATION_NOT_AVAILABLE', '该组织不可用')
  }
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { organizationId: true } })
    if (!team || team.organizationId !== organizationId) throw new AssignmentError(422, 'ASSIGNMENT_SCOPE_INVALID', '团队不属于当前学校')
    if (!await hasTeamCapability(userId, teamId, 'assignment.create')) throw new AssignmentError(403, 'ASSIGNMENT_FORBIDDEN', '需要团队管理员权限')
  }
  return membership
}

async function canManageAssignment(userId: string, assignment: Pick<AssignmentShape, 'organizationId' | 'teamId' | 'createdByMembershipId' | 'CreatorMembership'>) {
  return canManageAssignmentResource(userId, {
    organizationId: assignment.organizationId,
    teamId: assignment.teamId,
    creatorUserId: assignment.CreatorMembership.userId,
  })
}

async function loadAssignment(id: string) {
  return prisma.assignment.findUnique({ where: { id }, include: ASSIGNMENT_INCLUDE })
}

async function assertManage(userId: string, id: string) {
  const assignment = await loadAssignment(id)
  if (!assignment) throw new AssignmentError(404, 'ASSIGNMENT_NOT_FOUND', '作业不存在')
  if (!await canManageAssignment(userId, assignment)) throw new AssignmentError(403, 'ASSIGNMENT_FORBIDDEN', '无权管理该作业')
  return assignment
}

/**
 * Recipient visibility is deliberately stricter than lifecycle status. A
 * scheduled assignment may already be published internally while its
 * publishAt embargo is still active. Managers always bypass the embargo.
 */
export function isAssignmentVisibleToRecipient(
  assignment: Pick<AssignmentShape, 'status' | 'publishAt'>,
  now = new Date(),
) {
  return assignment.status !== 'DRAFT'
    && assignment.status !== 'CANCELLED'
    && (!assignment.publishAt || assignment.publishAt <= now)
}

async function assertAccess(userId: string, id: string) {
  const assignment = await loadAssignment(id)
  if (!assignment) throw new AssignmentError(404, 'ASSIGNMENT_NOT_FOUND', '作业不存在')
  if (await canManageAssignment(userId, assignment)) return assignment
  const recipient = assignment.Recipients.find(item => item.userId === userId && item.status !== 'REMOVED')
  if (!recipient || !isAssignmentVisibleToRecipient(assignment)) throw new AssignmentError(404, 'ASSIGNMENT_NOT_FOUND', '作业不存在')
  return assignment
}

async function appendEvent(tx: Prisma.TransactionClient, assignmentId: string, type: string, actorUserId: string | null, payload?: Prisma.InputJsonValue) {
  const row = await tx.assignment.update({ where: { id: assignmentId }, data: { eventSeq: { increment: 1 } }, select: { eventSeq: true } })
  return tx.assignmentEvent.create({ data: { assignmentId, seq: row.eventSeq, type, actorUserId, payload } })
}

async function recomputeRecipientCompletion(tx: Prisma.TransactionClient, assignmentId: string, recipientId: string) {
  const recipient = await tx.assignmentRecipient.findFirst({
    where: { id: recipientId, assignmentId },
    select: { id: true, status: true },
  })
  if (!recipient || ['REMOVED', 'EXEMPT'].includes(recipient.status)) return
  const [requiredProblems, progress] = await Promise.all([
    tx.assignmentProblem.findMany({ where: { assignmentId, category: 'REQUIRED' }, select: { id: true } }),
    tx.assignmentProblemProgress.findMany({
      where: { assignmentId, recipientId },
      select: { assignmentProblemId: true, learningStatus: true, attemptCount: true },
    }),
  ])
  const progressByProblem = new Map(progress.map(item => [item.assignmentProblemId, item]))
  const completed = requiredProblems.length > 0 && requiredProblems.every(problem => {
    const item = progressByProblem.get(problem.id)
    return Boolean(item && ['COMPLETED', 'EXEMPT'].includes(item.learningStatus))
  })
  if (completed && recipient.status !== 'COMPLETED') {
    await tx.assignmentRecipient.update({ where: { id: recipient.id }, data: { status: 'COMPLETED', completedAt: new Date() } })
  } else if (!completed && recipient.status === 'COMPLETED') {
    const hasAttempt = progress.some(item => item.attemptCount > 0)
    await tx.assignmentRecipient.update({ where: { id: recipient.id }, data: { status: hasAttempt ? 'ACTIVE' : 'ASSIGNED', completedAt: null } })
  }
}

async function evaluateAutomaticCorrections(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  trigger: 'DUE' | 'CLOSE' | 'REVIEW',
  actorUserId: string | null,
) {
  const assignment = await tx.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      Problems: true,
      Recipients: {
        where: { status: { notIn: ['REMOVED', 'EXEMPT'] } },
        include: {
          Progress: true,
          Overrides: { where: { revokedAt: null }, orderBy: { createdAt: 'desc' } },
        },
      },
    },
  })
  if (!assignment) return 0
  let createdCount = 0
  for (const recipient of assignment.Recipients) {
    const policy = recipient.Overrides[0]?.correctionPolicy ?? assignment.correctionPolicy
    if (policy === 'NONE' || policy === 'TEACHER_ASSIGNED') continue
    const progressByProblem = new Map(recipient.Progress.map(item => [item.assignmentProblemId, item]))
    for (const problem of assignment.Problems) {
      const progress = progressByProblem.get(problem.id)
      const result = String(progress?.bestVerdict || '').toLowerCase()
      const accepted = result === 'accepted' || result === 'ac'
      const incomplete = !progress || !['COMPLETED', 'EXEMPT'].includes(progress.learningStatus)
      const needsCorrection = policy === 'BELOW_TARGET'
        ? (progress?.finalScore ?? progress?.bestScore ?? 0) < problem.targetScore
        : policy === 'NON_AC'
          ? !accepted
          : incomplete
      if (!needsCorrection) continue
      const policyEvaluationKey = `assignment-correction:v1:${assignment.id}:${recipient.id}:${problem.id}:${policy}`
      const existing = await tx.assignmentCorrection.findUnique({ where: { policyEvaluationKey } })
      if (existing) continue
      await tx.assignmentCorrection.create({
        data: {
          assignmentId: assignment.id,
          assignmentProblemId: problem.id,
          recipientId: recipient.id,
          assignedBy: 'system',
          source: 'policy',
          policyCode: policy,
          policyEvaluationKey,
          policyEvaluatedAt: new Date(),
          reason: `由作业订正策略 ${policy} 自动创建`,
          requiredScore: problem.targetScore,
          dueAt: assignment.correctionDueAt,
        },
      })
      await tx.assignmentProblemProgress.upsert({
        where: { assignmentProblemId_recipientId: { assignmentProblemId: problem.id, recipientId: recipient.id } },
        create: {
          assignmentId: assignment.id,
          assignmentProblemId: problem.id,
          recipientId: recipient.id,
          correctionStatus: 'NEEDS_CORRECTION',
        },
        update: { correctionStatus: 'NEEDS_CORRECTION' },
      })
      createdCount++
    }
  }
  if (createdCount > 0) {
    await appendEvent(tx, assignmentId, 'assignment.corrections_evaluated', actorUserId, { trigger, createdCount })
  }
  return createdCount
}

export async function createAssignment(userId: string, body: any) {
  const organizationId = String(body?.organizationId || '')
  if (!organizationId) throw new AssignmentError(422, 'ASSIGNMENT_SCOPE_REQUIRED', '必须选择学校')
  const teamId = body?.teamId ? String(body.teamId) : null
  const membership = await assertCreatePermission(userId, organizationId, teamId)
  const data = assignmentCreateInput(body)
  const assignment = await prisma.$transaction(async tx => {
    const created = await tx.assignment.create({
      data: { ...data as any, organizationId, teamId, createdByMembershipId: membership.id, eventSeq: 1 },
      include: ASSIGNMENT_INCLUDE,
    })
    await tx.assignmentEvent.create({ data: { assignmentId: created.id, seq: 1, type: 'assignment.created', actorUserId: userId, payload: { organizationId, teamId } } })
    return created
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return serializeAssignment(assignment)
}

export async function listAssignments(userId: string, query: any) {
  const page = Math.max(1, Number(query?.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize) || 20))
  const organizationId = query?.organizationId ? String(query.organizationId) : undefined
  const teamId = query?.teamId ? String(query.teamId) : undefined
  const rawStatus = query?.status ? String(query.status).toUpperCase() : undefined
  if (rawStatus && !ASSIGNMENT_STATUSES.has(rawStatus)) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_STATUS', '作业状态筛选不受支持')
  const status = rawStatus as AssignmentStatus | undefined
  const [managedOrganizations, managedTeams, account] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { userId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } },
      select: { organizationId: true, memberRole: true },
    }),
    prisma.teamMember.findMany({
      where: { userId, status: 'active', role: { in: ['owner', 'admin'] } },
      select: { teamId: true },
    }),
    globalAccount(userId),
  ])
  const principalOrgIds = managedOrganizations.filter(item => item.memberRole === 'school_principal').map(item => item.organizationId)
  const teacherOrgIds = managedOrganizations.filter(item => item.memberRole === 'teacher').map(item => item.organizationId)
  const managedTeamIds = managedTeams.map(item => item.teamId)
  const now = new Date()
  const where: Prisma.AssignmentWhereInput = {
    ...(organizationId ? { organizationId } : {}), ...(teamId ? { teamId } : {}), ...(status ? { status } : {}),
    ...(account?.role === 'super_admin' ? {} : {
      OR: [
        { organizationId: { in: principalOrgIds } },
        { organizationId: { in: teacherOrgIds }, CreatorMembership: { userId } },
        { teamId: { in: managedTeamIds } },
        {
          Recipients: { some: { userId, status: { not: 'REMOVED' } } },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          OR: [{ publishAt: null }, { publishAt: { lte: now } }],
        },
      ],
    }),
  }
  const [total, rows, statusGroups] = await Promise.all([
    prisma.assignment.count({ where }),
    prisma.assignment.findMany({ where, include: ASSIGNMENT_INCLUDE, orderBy: [{ openAt: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.assignment.groupBy({ by: ['status'], where, _count: { _all: true } }),
  ])
  return {
    items: rows.map(row => serializeAssignment(row, 'none')),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    statusCounts: Object.fromEntries(statusGroups.map(item => [item.status, item._count._all])),
  }
}

export async function getAssignment(userId: string, assignmentId: string) {
  const assignment = await assertAccess(userId, assignmentId)
  return serializeAssignment(assignment, await canManageAssignment(userId, assignment) ? 'all' : userId)
}

export async function getAssignmentWorkspace(userId: string, assignmentId: string) {
  const assignment = await assertAccess(userId, assignmentId)
  const manager = await canManageAssignment(userId, assignment)
  const recipient = manager ? null : assignment.Recipients.find(item => item.userId === userId && item.status !== 'REMOVED')
  const recipientIds = manager ? assignment.Recipients.map(item => item.id) : recipient ? [recipient.id] : []
  const [progress, corrections, feedback, gradeSnapshots, adjustments] = await Promise.all([
    prisma.assignmentProblemProgress.findMany({ where: { assignmentId, recipientId: { in: recipientIds } }, orderBy: { updatedAt: 'desc' } }),
    prisma.assignmentCorrection.findMany({ where: { assignmentId, recipientId: { in: recipientIds } }, orderBy: { createdAt: 'desc' } }),
    prisma.assignmentFeedback.findMany({ where: { assignmentId, recipientId: { in: recipientIds }, ...(manager ? {} : { visibility: 'recipient' }) }, orderBy: { createdAt: 'desc' } }),
    prisma.assignmentGradeSnapshot.findMany({ where: { assignmentId, recipientId: { in: recipientIds } }, orderBy: [{ createdAt: 'desc' }, { revision: 'desc' }] }),
    manager
      ? prisma.assignmentScoreAdjustment.findMany({ where: { assignmentId }, orderBy: { createdAt: 'asc' } })
      : Promise.resolve([]),
  ])
  const managerProgress = manager
    ? summarizeAssignmentProgress(assignment, progress, adjustments)
    : null
  return { canManage: manager, assignment: serializeAssignment(assignment, manager ? 'all' : userId), progress, managerProgress, corrections, feedback, gradeSnapshots }
}

function summarizeAssignmentProgress(
  assignment: AssignmentShape,
  progress: Awaited<ReturnType<typeof prisma.assignmentProblemProgress.findMany>>,
  adjustments: Awaited<ReturnType<typeof prisma.assignmentScoreAdjustment.findMany>>,
) {
  const adjustmentsByRecipient = new Map<string, number>()
  for (const adjustment of adjustments) adjustmentsByRecipient.set(adjustment.recipientId, (adjustmentsByRecipient.get(adjustment.recipientId) || 0) + adjustment.delta)
  const progressByRecipient = new Map<string, typeof progress>()
  for (const item of progress) progressByRecipient.set(item.recipientId, [...(progressByRecipient.get(item.recipientId) || []), item])
  return {
    problems: assignment.Problems.map(problem => ({
      id: problem.id,
      orderIndex: problem.orderIndex,
      problem: problem.Problem,
      maxScore: problem.maxScore,
      targetScore: problem.targetScore,
      weight: problem.weight,
      category: problem.category,
      completionPolicy: problem.completionPolicy,
    })),
    recipients: assignment.Recipients.map(recipient => {
      const items = progressByRecipient.get(recipient.id) || []
      const grade = calculateAssignmentGrade(assignment, assignment.Problems, items)
      const rawScore = grade.rawScore
      const adjustment = adjustmentsByRecipient.get(recipient.id) || 0
      return {
        id: recipient.id, user: recipient.User, status: recipient.status,
        dueAtEffective: recipient.dueAtEffective, closeAtEffective: recipient.closeAtEffective,
        score: Math.max(0, rawScore + adjustment), rawScore, maxScore: grade.maxScore, gradeComponents: grade.components, adjustment,
        completedProblems: items.filter(item => item.learningStatus === 'COMPLETED').length,
        lateProblems: items.filter(item => item.timelinessStatus === 'LATE').length,
        correctionProblems: items.filter(item => ['NEEDS_CORRECTION', 'CORRECTING'].includes(item.correctionStatus)).length,
        progress: items,
      }
    }),
  }
}

export async function updateAssignment(userId: string, assignmentId: string, body: any) {
  const assignment = await assertManage(userId, assignmentId)
  if (assignment.status !== 'DRAFT') throw new AssignmentError(409, 'ASSIGNMENT_FROZEN', '作业发布后不能修改基本配置')
  const expectedRevision = clientRevision(body)
  const merged = assignmentCreateInput({
    title: body?.title ?? assignment.title,
    description: body?.description === undefined ? assignment.description : body.description,
    learningObjectives: body?.learningObjectives === undefined ? assignment.learningObjectives : body.learningObjectives,
    rosterMode: body?.rosterMode ?? assignment.rosterMode,
    gradingPolicy: body?.gradingPolicy ?? assignment.gradingPolicy,
    latePolicy: body?.latePolicy ?? assignment.latePolicy,
    correctionPolicy: body?.correctionPolicy ?? assignment.correctionPolicy,
    solutionReleasePolicy: body?.solutionReleasePolicy ?? assignment.solutionReleasePolicy,
    latePenaltyPercent: body?.latePenaltyPercent ?? assignment.latePenaltyPercent,
    baseScoreMax: body?.baseScoreMax ?? assignment.baseScoreMax,
    optionalScoringPolicy: body?.optionalScoringPolicy ?? assignment.optionalScoringPolicy,
    optionalBestCount: body?.optionalBestCount ?? assignment.optionalBestCount,
    optionalBonusMax: body?.optionalBonusMax ?? assignment.optionalBonusMax,
    challengeScoringPolicy: body?.challengeScoringPolicy ?? assignment.challengeScoringPolicy,
    challengeBonusMax: body?.challengeBonusMax ?? assignment.challengeBonusMax,
    publishAt: body?.publishAt === undefined ? assignment.publishAt : body.publishAt,
    openAt: body?.openAt ?? assignment.openAt,
    dueAt: body?.dueAt ?? assignment.dueAt,
    closeAt: body?.closeAt ?? assignment.closeAt,
    correctionDueAt: body?.correctionDueAt === undefined ? assignment.correctionDueAt : body.correctionDueAt,
  })
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${assignmentId}`}, 0)) IS NULL AS locked`
    const updated = await tx.assignment.updateMany({ where: { id: assignmentId, status: 'DRAFT', statusRevision: expectedRevision }, data: { ...merged as any, statusRevision: { increment: 1 } } })
    if (updated.count !== 1) throw new AssignmentError(409, 'ASSIGNMENT_STALE', '作业已被其他管理员修改，请刷新')
    await appendEvent(tx, assignmentId, 'assignment.updated', userId)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return serializeAssignment((await loadAssignment(assignmentId))!)
}

export async function replaceAssignmentProblems(userId: string, assignmentId: string, body: any) {
  const assignment = await assertManage(userId, assignmentId)
  if (assignment.status !== 'DRAFT') throw new AssignmentError(409, 'ASSIGNMENT_FROZEN', '作业发布后不能修改题目')
  const expectedRevision = clientRevision(body)
  const rows = body?.problems
  const problemIds = validateProblemRows(rows)
  const requestedRevisionIds = rows.map((row: any) => row?.testSetRevisionId ? String(row.testSetRevisionId) : null).filter(Boolean) as string[]
  const [problems, revisions] = await Promise.all([
    prisma.problem.findMany({ where: { id: { in: problemIds }, status: { not: 'archived' } }, include: { LatestTestSetRevision: true } }),
    prisma.problemTestSetRevision.findMany({ where: { id: { in: requestedRevisionIds } } }),
  ])
  const problemMap = new Map(problems.map(problem => [problem.id, problem]))
  const revisionMap = new Map(revisions.map(revision => [revision.id, revision]))
  const account = await globalAccount(userId)
  const normalized = rows.map((row: any, index: number) => {
    const problem = problemMap.get(String(row.problemId))
    if (!problem || (account?.role !== 'super_admin' && problem.ownerId !== userId && !(problem.libraryScope === 'platform' && problem.status === 'published') && !(problem.libraryScope === 'school' && problem.organizationId === assignment.organizationId && problem.status === 'published'))) {
      throw new AssignmentError(422, 'ASSIGNMENT_PROBLEM_UNAVAILABLE', `第 ${index + 1} 道题不可用`)
    }
    const revision = row.testSetRevisionId ? revisionMap.get(String(row.testSetRevisionId)) : problem.LatestTestSetRevision
    if (!revision || revision.problemId !== problem.id) throw new AssignmentError(422, 'ASSIGNMENT_REVISION_INVALID', `第 ${index + 1} 道题没有合法 TestSet Revision`)
    const maxScore = boundedInteger(row.maxScore, 1, 1000, `第 ${index + 1} 道题满分`, 100)
    const targetScore = boundedInteger(row.targetScore, 0, maxScore, `第 ${index + 1} 道题目标分`, maxScore)
    return {
      id: row.id ? String(row.id) : null,
      problemId: problem.id,
      testSetRevisionId: revision.id,
      orderIndex: index,
      category: enumValue(row.category, PROBLEM_CATEGORIES, 'REQUIRED', '题目分类'),
      required: row.required === undefined ? String(row.category || 'REQUIRED').toUpperCase() === 'REQUIRED' : Boolean(row.required),
      maxScore, targetScore,
      judgeMaxScore: judgeMaxScoreFromSnapshot(revision.judgeConfig, revision.mode),
      weight: boundedInteger(row.weight, 1, 10_000, `第 ${index + 1} 道题权重`, 100),
      completionPolicy: enumValue(row.completionPolicy, COMPLETION_POLICIES, revision.mode === 'acm' ? 'AC' : 'TARGET_SCORE', '完成条件'),
      judgeConfigSnapshot: revision.judgeConfig,
      judgeConfigHash: revision.judgeConfigHash,
      settings: row.settings === undefined ? undefined : JSON.parse(JSON.stringify(row.settings)),
    }
  })
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${assignmentId}`}, 0)) IS NULL AS locked`
    const current = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { status: true, statusRevision: true } })
    if (!current || current.status !== 'DRAFT') throw new AssignmentError(409, 'ASSIGNMENT_FROZEN', '作业发布后不能修改题目')
    if (current.statusRevision !== expectedRevision) throw new AssignmentError(409, 'ASSIGNMENT_STALE', '作业已被其他管理员修改，请刷新')
    const existing = await tx.assignmentProblem.findMany({ where: { assignmentId }, select: { id: true, problemId: true } })
    const existingByProblem = new Map(existing.map(item => [item.problemId, item.id]))
    const kept = new Set<string>()
    if (existing.length) await tx.assignmentProblem.updateMany({ where: { assignmentId }, data: { orderIndex: { increment: 10_000 } } })
    for (const row of normalized) {
      const id = row.id && existing.some(item => item.id === row.id) ? row.id : existingByProblem.get(row.problemId)
      const { id: _clientId, ...data } = row
      if (id) {
        kept.add(id)
        await tx.assignmentProblem.update({ where: { id }, data })
      } else {
        const created = await tx.assignmentProblem.create({ data: { ...data, assignmentId } })
        kept.add(created.id)
      }
    }
    await tx.assignmentProblem.deleteMany({ where: { assignmentId, id: { notIn: [...kept] } } })
    await tx.assignment.update({ where: { id: assignmentId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, assignmentId, 'assignment.problems_replaced', userId, { problemIds })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return serializeAssignment((await loadAssignment(assignmentId))!)
}

export async function replaceAssignmentRoster(userId: string, assignmentId: string, body: any) {
  const assignment = await assertManage(userId, assignmentId)
  if (assignment.status !== 'DRAFT') throw new AssignmentError(409, 'ASSIGNMENT_FROZEN', '作业发布后不能修改名单')
  const expectedRevision = clientRevision(body)
  const userIds: string[] = [...new Set<string>((Array.isArray(body?.userIds) ? body.userIds : []).map((id: unknown) => String(id)).filter(Boolean))]
  if (!userIds.length || userIds.length > 5000) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_ROSTER', '作业名单必须包含 1～5000 名成员')
  const memberships = await prisma.organizationMembership.findMany({ where: { organizationId: assignment.organizationId, userId: { in: userIds }, status: 'active', memberRole: 'student' }, select: { id: true, userId: true } })
  if (memberships.length !== userIds.length) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_ROSTER', '名单包含不属于当前学校的有效学生')
  if (assignment.teamId) {
    const teamUsers = new Set((await prisma.teamMember.findMany({ where: { teamId: assignment.teamId, userId: { in: userIds }, status: 'active' }, select: { userId: true } })).map(item => item.userId))
    if (teamUsers.size !== userIds.length) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_ROSTER', '名单包含不属于当前团队的学生')
  }
  const membershipByUser = new Map(memberships.map(item => [item.userId, item.id]))
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${assignmentId}`}, 0)) IS NULL AS locked`
    const current = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { status: true, statusRevision: true } })
    if (!current || current.status !== 'DRAFT') throw new AssignmentError(409, 'ASSIGNMENT_FROZEN', '作业发布后不能修改名单')
    if (current.statusRevision !== expectedRevision) throw new AssignmentError(409, 'ASSIGNMENT_STALE', '作业已被其他管理员修改，请刷新')
    const existing = await tx.assignmentRecipient.findMany({ where: { assignmentId }, select: { id: true, userId: true } })
    const existingByUser = new Map(existing.map(item => [item.userId, item.id]))
    for (const targetUserId of userIds) {
      const data = { membershipId: membershipByUser.get(targetUserId)!, source: 'explicit', status: 'ASSIGNED' as const, dueAtEffective: assignment.dueAt, closeAtEffective: assignment.closeAt, exemptReason: null }
      const id = existingByUser.get(targetUserId)
      if (id) await tx.assignmentRecipient.update({ where: { id }, data })
      else await tx.assignmentRecipient.create({ data: { assignmentId, userId: targetUserId, ...data } })
    }
    await tx.assignmentRecipient.deleteMany({ where: { assignmentId, userId: { notIn: userIds } } })
    await tx.assignment.update({ where: { id: assignmentId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, assignmentId, 'assignment.roster_replaced', userId, { recipientCount: userIds.length })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return serializeAssignment((await loadAssignment(assignmentId))!)
}

async function dynamicRecipients(tx: Prisma.TransactionClient, assignment: AssignmentShape) {
  if (assignment.teamId) {
    const members = await tx.teamMember.findMany({ where: { teamId: assignment.teamId, status: 'active' }, select: { userId: true } })
    const ids = [...new Set(members.map(item => item.userId))]
    return tx.organizationMembership.findMany({ where: { organizationId: assignment.organizationId, userId: { in: ids }, status: 'active', memberRole: 'student' }, select: { id: true, userId: true } })
  }
  return tx.organizationMembership.findMany({ where: { organizationId: assignment.organizationId, status: 'active', memberRole: 'student' }, select: { id: true, userId: true } })
}

export function validateAssignmentForPublish(assignment: AssignmentShape): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!assignment.Problems.length) issues.push({ path: 'problems', code: 'PROBLEMS_REQUIRED', message: '至少配置一道题' })
  if (!assignment.Problems.some(problem => problem.category === 'REQUIRED')) issues.push({ path: 'problems', code: 'REQUIRED_PROBLEM_REQUIRED', message: '至少配置一道必做题，作为基础成绩分母' })
  if (assignment.optionalScoringPolicy !== 'NONE' && !assignment.Problems.some(problem => problem.category === 'OPTIONAL')) issues.push({ path: 'optionalScoringPolicy', code: 'OPTIONAL_PROBLEM_REQUIRED', message: '已启用选做题计分，但没有配置选做题' })
  if (assignment.optionalScoringPolicy === 'BEST_N' && (!assignment.optionalBestCount || assignment.optionalBestCount > assignment.Problems.filter(problem => problem.category === 'OPTIONAL').length)) issues.push({ path: 'optionalBestCount', code: 'OPTIONAL_BEST_COUNT_INVALID', message: '最佳选做题数量必须在现有选做题数量范围内' })
  if (assignment.challengeScoringPolicy !== 'NONE' && !assignment.Problems.some(problem => problem.category === 'CHALLENGE')) issues.push({ path: 'challengeScoringPolicy', code: 'CHALLENGE_PROBLEM_REQUIRED', message: '已启用挑战题加分，但没有配置挑战题' })
  if (assignment.rosterMode === 'SNAPSHOT' && !assignment.Recipients.length) issues.push({ path: 'recipients', code: 'RECIPIENTS_REQUIRED', message: '快照名单至少包含一名学生' })
  if (assignment.openAt >= assignment.dueAt) issues.push({ path: 'dueAt', code: 'TIMELINE_INVALID', message: '截止时间必须晚于开放时间' })
  if (assignment.dueAt > assignment.closeAt) issues.push({ path: 'closeAt', code: 'TIMELINE_INVALID', message: '关闭时间不能早于截止时间' })
  for (const [index, problem] of assignment.Problems.entries()) {
    if (problem.TestSetRevision.id !== problem.testSetRevisionId || problem.TestSetRevision.judgeConfigHash !== problem.judgeConfigHash) {
      issues.push({ path: `problems.${index}.testSetRevisionId`, code: 'REVISION_SNAPSHOT_INVALID', message: '题目版本快照不一致' })
    }
  }
  return issues
}

export async function validateAssignmentStructure(userId: string, assignmentId: string) {
  const assignment = await assertManage(userId, assignmentId)
  const issues = validateAssignmentForPublish(assignment)
  return { assignmentId, statusRevision: assignment.statusRevision, valid: issues.length === 0, issues }
}

export async function publishAssignment(userId: string, assignmentId: string, expectedRevision: number) {
  await assertManage(userId, assignmentId)
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new AssignmentError(422, 'ASSIGNMENT_REVISION_REQUIRED', '必须提供有效的 expectedRevision')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${assignmentId}`}, 0)) IS NULL AS locked`
    let assignment = await tx.assignment.findUnique({ where: { id: assignmentId }, include: ASSIGNMENT_INCLUDE })
    if (!assignment) throw new AssignmentError(404, 'ASSIGNMENT_NOT_FOUND', '作业不存在')
    if (assignment.status !== 'DRAFT') throw new AssignmentError(409, 'ASSIGNMENT_FROZEN', '作业已经发布或取消')
    if (assignment.statusRevision !== expectedRevision) throw new AssignmentError(409, 'ASSIGNMENT_STALE', '作业已被其他管理员修改，请刷新')
    if (assignment.rosterMode === 'DYNAMIC') {
      const recipients = await dynamicRecipients(tx, assignment)
      if (!recipients.length) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_STRUCTURE', '动态名单当前没有可分配学生')
      await tx.assignmentRecipient.createMany({ data: recipients.map(recipient => ({ assignmentId, userId: recipient.userId, membershipId: recipient.id, source: 'dynamic_publish', dueAtEffective: assignment!.dueAt, closeAtEffective: assignment!.closeAt })), skipDuplicates: true })
      assignment = (await tx.assignment.findUnique({ where: { id: assignmentId }, include: ASSIGNMENT_INCLUDE }))!
    }
    const issues = validateAssignmentForPublish(assignment)
    if (issues.length) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_STRUCTURE', '作业发布检查未通过', { issues })
    await tx.assignmentProblemProgress.createMany({ data: assignment.Recipients.map(recipient => assignment!.Problems.map(problem => ({ assignmentId, assignmentProblemId: problem.id, recipientId: recipient.id }))).flat(), skipDuplicates: true })
    const now = new Date()
    const status: AssignmentStatus = now < assignment.openAt ? 'SCHEDULED' : now < assignment.dueAt ? 'OPEN' : now < assignment.closeAt ? 'OVERDUE' : 'CLOSED'
    const claimed = await tx.assignment.updateMany({ where: { id: assignmentId, status: 'DRAFT', statusRevision: expectedRevision }, data: { status, publishedAt: now, ...(status === 'CLOSED' ? { closedAt: now } : {}), statusRevision: { increment: 1 } } })
    if (claimed.count !== 1) throw new AssignmentError(409, 'ASSIGNMENT_STALE', '作业已被其他管理员修改，请刷新')
    await appendEvent(tx, assignmentId, 'assignment.published', userId, { status, problemCount: assignment.Problems.length, recipientCount: assignment.Recipients.length })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 })
  return serializeAssignment((await loadAssignment(assignmentId))!)
}

const MANUAL_TRANSITIONS: Record<string, { from: AssignmentStatus[]; to: AssignmentStatus }> = {
  close: { from: ['OPEN', 'OVERDUE'], to: 'CLOSED' },
  review: { from: ['CLOSED'], to: 'REVIEWING' },
  release: { from: ['CLOSED', 'REVIEWING'], to: 'RELEASED' },
  archive: { from: ['RELEASED'], to: 'ARCHIVED' },
  cancel: { from: ['DRAFT', 'SCHEDULED', 'OPEN', 'OVERDUE'], to: 'CANCELLED' },
}

export async function transitionAssignment(userId: string, assignmentId: string, action: string, expectedRevision: number) {
  await assertManage(userId, assignmentId)
  const transition = MANUAL_TRANSITIONS[action]
  if (!transition) throw new AssignmentError(422, 'ASSIGNMENT_TRANSITION_INVALID', '不支持的作业状态操作')
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new AssignmentError(422, 'ASSIGNMENT_REVISION_REQUIRED', '必须提供有效的 expectedRevision')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${assignmentId}`}, 0)) IS NULL AS locked`
    const current = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { status: true, statusRevision: true } })
    if (!current) throw new AssignmentError(404, 'ASSIGNMENT_NOT_FOUND', '作业不存在')
    if (current.statusRevision !== expectedRevision) throw new AssignmentError(409, 'ASSIGNMENT_STALE', '作业状态已变化，请刷新')
    if (!transition.from.includes(current.status)) throw new AssignmentError(409, 'ASSIGNMENT_TRANSITION_INVALID', `当前状态 ${current.status} 不能执行该操作`)
    const now = new Date()
    const timestamps = transition.to === 'CLOSED' ? { closedAt: now } : transition.to === 'RELEASED' ? { releasedAt: now } : transition.to === 'ARCHIVED' ? { archivedAt: now } : transition.to === 'CANCELLED' ? { cancelledAt: now } : {}
    await tx.assignment.update({ where: { id: assignmentId }, data: { status: transition.to, ...timestamps, statusRevision: { increment: 1 } } })
    if (transition.to === 'CLOSED') {
      await evaluateAutomaticCorrections(tx, assignmentId, 'CLOSE', userId)
      await createGradeSnapshots(tx, assignmentId, 'CLOSE', userId)
    }
    if (transition.to === 'REVIEWING') await evaluateAutomaticCorrections(tx, assignmentId, 'REVIEW', userId)
    if (transition.to === 'RELEASED') await createGradeSnapshots(tx, assignmentId, 'FINAL_RELEASE', userId)
    await appendEvent(tx, assignmentId, `assignment.${action}`, userId, { from: current.status, to: transition.to })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return serializeAssignment((await loadAssignment(assignmentId))!)
}

function allowedLanguageList(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch { return null }
}

export async function submitAssignmentSolution(userId: string, assignmentId: string, body: any) {
  const assignment = await assertAccess(userId, assignmentId)
  const recipient = assignment.Recipients.find(item => item.userId === userId && ['ASSIGNED', 'ACTIVE'].includes(item.status))
  if (!recipient) throw new AssignmentError(403, 'ASSIGNMENT_RECIPIENT_REQUIRED', '当前账号不在作业名单中')
  const assignmentProblemId = String(body?.assignmentProblemId || '')
  const problem = assignment.Problems.find(item => item.id === assignmentProblemId)
  if (!problem) throw new AssignmentError(404, 'ASSIGNMENT_PROBLEM_NOT_FOUND', '作业题目不存在')
  const now = new Date()
  if (assignment.status === 'CANCELLED' || assignment.status === 'DRAFT' || now < assignment.openAt) throw new AssignmentError(409, 'ASSIGNMENT_NOT_OPEN', '作业尚未开放')
  if (['CLOSED', 'REVIEWING', 'RELEASED', 'ARCHIVED'].includes(assignment.status) || now > recipient.closeAtEffective) throw new AssignmentError(409, 'ASSIGNMENT_CLOSED', '作业已关闭提交')
  const correction = await prisma.assignmentCorrection.findFirst({ where: { assignmentId, assignmentProblemId, recipientId: recipient.id, status: { in: ['NEEDS_CORRECTION', 'CORRECTING'] }, OR: [{ dueAt: null }, { dueAt: { gte: now } }] }, orderBy: { createdAt: 'desc' } })
  const submissionPhase = correction ? 'CORRECTION' : now > recipient.dueAtEffective ? 'LATE' : 'ORIGINAL'
  if (submissionPhase === 'LATE' && assignment.latePolicy === 'DISALLOW') throw new AssignmentError(409, 'ASSIGNMENT_LATE_SUBMISSION_DISALLOWED', '本作业不允许迟交')
  const language = boundedText(body?.language, 30, '语言', 1)
  const languages = allowedLanguageList(problem.Problem.allowedLanguages)
  if (languages?.length && !languages.includes(language)) throw new AssignmentError(422, 'ASSIGNMENT_LANGUAGE_NOT_ALLOWED', '该题不允许使用所选语言')
  const code = String(body?.code || '')
  if (!code.trim() || Buffer.byteLength(code, 'utf8') > 1024 * 1024) throw new AssignmentError(422, 'INVALID_SUBMISSION_CODE', '代码不能为空且不能超过 1 MiB')
  const config = yaml.load(problem.judgeConfigSnapshot) as any
  const io = normalizeSubmissionIo({ inputFilename: body?.inputFilename, outputFilename: body?.outputFilename, problemType: config?.type })
  const created = await createQueuedSubmissionWithRun({
    userId, workspaceScope: 'campus', organizationId: assignment.organizationId,
    oj: problem.Problem.platform, problemId: problem.Problem.problemId, language, code,
    codeLength: Buffer.byteLength(code, 'utf8'), result: 'queuing', submitMethod: 'local', problemInternalId: problem.problemId,
    submitScope: 'assignment', assignmentId, assignmentProblemId, assignmentRecipientId: recipient.id, submissionPhase,
    testSetRevisionId: problem.testSetRevisionId, judgeConfigHash: problem.judgeConfigHash, judgeConfigSnapshot: problem.judgeConfigSnapshot,
    ...io, isGlobalVisible: true,
  }, { requestedBy: userId })
  if (recipient.status === 'ASSIGNED') await prisma.assignmentRecipient.updateMany({ where: { id: recipient.id, status: 'ASSIGNED' }, data: { status: 'ACTIVE', startedAt: now } })
  if (correction?.status === 'NEEDS_CORRECTION') await prisma.assignmentCorrection.updateMany({ where: { id: correction.id, status: 'NEEDS_CORRECTION' }, data: { status: 'CORRECTING' } })
  return created
}

function normalizedScore(submission: { score: number | null; result: string | null }, problem: { maxScore: number; judgeMaxScore: number }) {
  return mapJudgeScore({
    score: submission.score,
    result: submission.result,
    judgeMaxScore: problem.judgeMaxScore,
    assignmentMaxScore: problem.maxScore,
  })
}

export async function syncAssignmentSubmission(submission: { id: number; userId: string; assignmentId: string | null; assignmentProblemId: string | null; assignmentRecipientId: string | null }) {
  if (!submission.assignmentId || !submission.assignmentProblemId || !submission.assignmentRecipientId) return
  const lockKey = `assignment-progress:${submission.assignmentProblemId}:${submission.assignmentRecipientId}`
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS locked`
    const [assignment, problem, recipient] = await Promise.all([
      tx.assignment.findUnique({ where: { id: submission.assignmentId! } }),
      tx.assignmentProblem.findUnique({ where: { id: submission.assignmentProblemId! } }),
      tx.assignmentRecipient.findUnique({ where: { id: submission.assignmentRecipientId! } }),
    ])
    if (!assignment || !problem || !recipient || problem.assignmentId !== assignment.id || recipient.assignmentId !== assignment.id || recipient.userId !== submission.userId) return
    const existingProgress = await tx.assignmentProblemProgress.findUnique({
      where: { assignmentProblemId_recipientId: { assignmentProblemId: problem.id, recipientId: recipient.id } },
    })
    const rawSubmissions = await tx.submission.findMany({
      where: { assignmentProblemId: problem.id, assignmentRecipientId: recipient.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true, result: true, score: true, submissionPhase: true, createdAt: true,
        submitMethod: true, problemInternalId: true,
        CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
      },
    })
    const submissions = rawSubmissions.map(projectSubmissionJudgeResult)
      .filter(item => !['queuing', 'judging', 'compiling'].includes(item.result))
    if (!submissions.length) return
    const originals = submissions.filter(item => item.submissionPhase !== 'CORRECTION')
    const corrections = submissions.filter(item => item.submissionPhase === 'CORRECTION')
    const scoreOf = (item: typeof submissions[number]) => normalizedScore(item, problem)
    const bestOf = (items: typeof submissions) => items.reduce<typeof submissions[number] | null>((best, item) => !best || scoreOf(item) > scoreOf(best) ? item : best, null)
    let selectedOriginal: typeof submissions[number] | null = null
    if (assignment.gradingPolicy === 'LATEST') selectedOriginal = originals.at(-1) || null
    else if (assignment.gradingPolicy === 'FIRST_TARGET_MET') selectedOriginal = originals.find(item => scoreOf(item) >= problem.targetScore) || bestOf(originals)
    else if (assignment.gradingPolicy === 'BEST_BEFORE_DUE') selectedOriginal = bestOf(originals.filter(item => item.submissionPhase === 'ORIGINAL'))
    else selectedOriginal = bestOf(originals)
    const activeCorrection = await tx.assignmentCorrection.findFirst({
      where: { assignmentId: assignment.id, assignmentProblemId: problem.id, recipientId: recipient.id, status: { in: ['NEEDS_CORRECTION', 'CORRECTING'] } },
      orderBy: { createdAt: 'desc' },
    })
    const correctionAttempts = activeCorrection ? corrections.filter(item => item.createdAt >= activeCorrection.createdAt) : corrections
    const selectedCorrection = bestOf(correctionAttempts)
    let originalScore = selectedOriginal ? scoreOf(selectedOriginal) : null
    if (originalScore !== null && selectedOriginal?.submissionPhase === 'LATE' && assignment.latePolicy === 'ALLOW_WITH_PENALTY') originalScore = Math.floor(originalScore * (100 - (assignment.latePenaltyPercent || 0)) / 100)
    const correctionScore = selectedCorrection ? scoreOf(selectedCorrection) : null
    const finalScore = assignment.gradingPolicy === 'MANUAL' ? null : Math.max(originalScore ?? 0, correctionScore ?? 0)
    const bestSubmission = bestOf(submissions)
    const targetMet = (finalScore ?? 0) >= problem.targetScore
    const accepted = submissions.some(item => ['accepted', 'ac'].includes(String(item.result || '').toLowerCase()))
    const completed = problem.completionPolicy === 'ATTEMPT'
      ? true
      : problem.completionPolicy === 'MANUAL'
        ? Boolean(existingProgress?.manualCompletedAt)
        : problem.completionPolicy === 'AC'
          ? accepted
          : targetMet
    const common = {
      learningStatus: completed ? 'COMPLETED' as const : targetMet ? 'TARGET_MET' as const : 'SUBMITTED' as const,
      timelinessStatus: originals.some(item => item.submissionPhase === 'LATE') ? 'LATE' as const : 'ON_TIME' as const,
      attemptCount: submissions.length, originalAttemptCount: originals.length, correctionAttemptCount: corrections.length,
      bestScore: bestSubmission ? scoreOf(bestSubmission) : null, bestVerdict: bestSubmission?.result,
      originalScore, correctionScore, finalScore, firstSubmissionId: submissions[0].id,
      bestSubmissionId: bestSubmission?.id, latestSubmissionId: submissions.at(-1)!.id,
      targetMetAt: targetMet ? submissions.find(item => scoreOf(item) >= problem.targetScore)?.createdAt || new Date() : null,
      completedAt: completed ? existingProgress?.completedAt || new Date() : null, firstSubmittedAt: submissions[0].createdAt, lastSubmittedAt: submissions.at(-1)!.createdAt,
    }
    const correctionSatisfied = Boolean(activeCorrection && selectedCorrection && correctionScore !== null && correctionScore >= (activeCorrection.requiredScore ?? problem.targetScore))
    const previousCorrection = await tx.assignmentCorrection.findFirst({
      where: { assignmentId: assignment.id, assignmentProblemId: problem.id, recipientId: recipient.id, status: { in: ['CORRECTED', 'WAIVED', 'EXPIRED'] } },
      orderBy: { updatedAt: 'desc' },
    })
    const correctionStatus = correctionSatisfied ? 'CORRECTED' : activeCorrection && selectedCorrection ? 'CORRECTING' : activeCorrection ? activeCorrection.status : previousCorrection?.status || 'NONE'
    await tx.assignmentProblemProgress.upsert({
      where: { assignmentProblemId_recipientId: { assignmentProblemId: problem.id, recipientId: recipient.id } },
      create: { assignmentId: assignment.id, assignmentProblemId: problem.id, recipientId: recipient.id, correctionStatus, ...common },
      update: { correctionStatus, ...common },
    })
    if (correctionSatisfied && activeCorrection) await tx.assignmentCorrection.update({ where: { id: activeCorrection.id }, data: { status: 'CORRECTED', completedAt: new Date() } })
    await recomputeRecipientCompletion(tx, assignment.id, recipient.id)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

const ASSIGNMENT_PROGRESS_STATES = [
  'NOT_STARTED', 'BELOW_TARGET', 'LATE', 'NEEDS_CORRECTION', 'CORRECTED', 'MANUAL_PENDING', 'COMPLETED',
] as const

type AssignmentProgressState = typeof ASSIGNMENT_PROGRESS_STATES[number]

function progressStates(problem: AssignmentShape['Problems'][number], item?: Awaited<ReturnType<typeof prisma.assignmentProblemProgress.findMany>>[number]) {
  const states = new Set<AssignmentProgressState>()
  if (!item || item.attemptCount === 0) states.add('NOT_STARTED')
  if (item && item.attemptCount > 0 && (item.finalScore ?? item.bestScore ?? 0) < problem.targetScore) states.add('BELOW_TARGET')
  if (item?.timelinessStatus === 'LATE') states.add('LATE')
  if (item && ['NEEDS_CORRECTION', 'CORRECTING'].includes(item.correctionStatus)) states.add('NEEDS_CORRECTION')
  if (item?.correctionStatus === 'CORRECTED') states.add('CORRECTED')
  if (problem.completionPolicy === 'MANUAL' && item && item.attemptCount > 0 && !item.manualCompletedAt) states.add('MANUAL_PENDING')
  if (item?.learningStatus === 'COMPLETED') states.add('COMPLETED')
  return [...states]
}

export async function getAssignmentProgress(userId: string, assignmentId: string, query?: any) {
  const assignment = await assertManage(userId, assignmentId)
  const [progress, corrections, adjustments] = await Promise.all([
    prisma.assignmentProblemProgress.findMany({ where: { assignmentId }, orderBy: { updatedAt: 'desc' } }),
    prisma.assignmentCorrection.findMany({ where: { assignmentId }, orderBy: { createdAt: 'desc' } }),
    prisma.assignmentScoreAdjustment.findMany({ where: { assignmentId }, orderBy: { createdAt: 'asc' } }),
  ])
  const summary = summarizeAssignmentProgress(assignment, progress, adjustments)
  const hasMatrixQuery = query && ['page', 'pageSize', 'q', 'problemId', 'state'].some(key => query[key] !== undefined)
  if (hasMatrixQuery) {
    const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '40'), 10) || 40))
    const search = String(query.q || '').trim().toLocaleLowerCase().slice(0, 120)
    const problemId = String(query.problemId || '').trim()
    if (problemId && !assignment.Problems.some(problem => problem.id === problemId)) {
      throw new AssignmentError(422, 'ASSIGNMENT_PROGRESS_FILTER_INVALID', '筛选题目不属于当前作业')
    }
    const requestedStates = String(query.state || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean)
    const unknownState = requestedStates.find(value => !ASSIGNMENT_PROGRESS_STATES.includes(value as AssignmentProgressState))
    if (unknownState) throw new AssignmentError(422, 'ASSIGNMENT_PROGRESS_FILTER_INVALID', `未知进度状态：${unknownState}`)
    const progressByCell = new Map(progress.map(item => [`${item.recipientId}:${item.assignmentProblemId}`, item]))
    const actorIds = [...new Set(progress.map(item => item.manualCompletedByUserId).filter(Boolean) as string[])]
    const actors = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true } })
      : []
    const actorById = new Map(actors.map(actor => [actor.id, actor]))
    const selectedProblems = problemId ? assignment.Problems.filter(problem => problem.id === problemId) : assignment.Problems
    const matrixRows = summary.recipients.map(recipient => {
      const cells = assignment.Problems.map(problem => {
        const item = progressByCell.get(`${recipient.id}:${problem.id}`)
        return {
          id: item?.id || null,
          assignmentProblemId: problem.id,
          learningStatus: item?.learningStatus || 'NOT_STARTED',
          timelinessStatus: item?.timelinessStatus || 'ON_TIME',
          correctionStatus: item?.correctionStatus || 'NONE',
          attemptCount: item?.attemptCount || 0,
          bestScore: item?.bestScore ?? null,
          bestVerdict: item?.bestVerdict ?? null,
          finalScore: item?.finalScore ?? null,
          firstSubmissionId: item?.firstSubmissionId ?? null,
          bestSubmissionId: item?.bestSubmissionId ?? null,
          latestSubmissionId: item?.latestSubmissionId ?? null,
          firstSubmittedAt: item?.firstSubmittedAt ?? null,
          lastSubmittedAt: item?.lastSubmittedAt ?? null,
          manualCompletionVersion: item?.manualCompletionVersion || 0,
          manualCompletedAt: item?.manualCompletedAt ?? null,
          manualCompletionReason: item?.manualCompletionReason ?? null,
          manualCompletedBy: item?.manualCompletedByUserId ? actorById.get(item.manualCompletedByUserId) || null : null,
          states: progressStates(problem, item),
        }
      })
      return { ...recipient, cells }
    })
    const searched = matrixRows.filter(row => !search || row.user.username.toLocaleLowerCase().includes(search))
    const counts = Object.fromEntries(ASSIGNMENT_PROGRESS_STATES.map(state => [state, searched.filter(row => selectedProblems.some(problem => row.cells.find(cell => cell.assignmentProblemId === problem.id)?.states.includes(state))).length]))
    const filtered = requestedStates.length
      ? searched.filter(row => selectedProblems.some(problem => {
          const cell = row.cells.find(item => item.assignmentProblemId === problem.id)
          return requestedStates.some(state => cell?.states.includes(state as AssignmentProgressState))
        }))
      : searched
    const total = filtered.length
    return {
      assignment: { id: assignment.id, title: assignment.title, status: assignment.status, statusRevision: assignment.statusRevision },
      problems: summary.problems,
      recipients: filtered.slice((page - 1) * pageSize, page * pageSize),
      corrections,
      statusCounts: counts,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }
  return {
    assignment: { id: assignment.id, title: assignment.title, status: assignment.status, statusRevision: assignment.statusRevision },
    ...summary,
    corrections,
  }
}

export async function setManualAssignmentProblemCompletion(userId: string, assignmentId: string, progressId: string, body: any) {
  const assignment = await assertManage(userId, assignmentId)
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(assignment.status)) {
    throw new AssignmentError(409, 'ASSIGNMENT_REVIEW_UNAVAILABLE', '当前作业状态不能人工确认完成情况')
  }
  const completed = body?.completed
  if (typeof completed !== 'boolean') throw new AssignmentError(422, 'MANUAL_COMPLETION_INVALID', 'completed 必须是布尔值')
  const expectedVersion = Number(body?.expectedVersion)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new AssignmentError(422, 'MANUAL_COMPLETION_VERSION_REQUIRED', '必须提供有效的 expectedVersion')
  const reason = boundedText(body?.reason, 2000, '人工完成说明', 1)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment-review:${assignmentId}`}, 0)) IS NULL AS locked`
    const progress = await tx.assignmentProblemProgress.findFirst({
      where: { id: progressId, assignmentId },
      include: { AssignmentProblem: { select: { completionPolicy: true } } },
    })
    if (!progress) throw new AssignmentError(404, 'ASSIGNMENT_PROGRESS_NOT_FOUND', '作业进度不存在')
    if (progress.AssignmentProblem.completionPolicy !== 'MANUAL') {
      throw new AssignmentError(422, 'MANUAL_COMPLETION_UNSUPPORTED', '该题未使用人工完成条件')
    }
    if (progress.attemptCount < 1) {
      throw new AssignmentError(409, 'MANUAL_COMPLETION_REQUIRES_SUBMISSION', '学生首次提交后才能人工确认完成')
    }
    const fallbackStatus = progress.targetMetAt
      ? 'TARGET_MET' as const
      : progress.attemptCount > 0
        ? 'SUBMITTED' as const
        : 'NOT_STARTED' as const
    const updated = await tx.assignmentProblemProgress.updateMany({
      where: { id: progress.id, manualCompletionVersion: expectedVersion },
      data: {
        learningStatus: completed ? 'COMPLETED' : fallbackStatus,
        completedAt: completed ? new Date() : null,
        manualCompletedAt: completed ? new Date() : null,
        manualCompletedByUserId: userId,
        manualCompletionReason: reason,
        manualCompletionVersion: { increment: 1 },
      },
    })
    if (updated.count !== 1) throw new AssignmentError(409, 'ASSIGNMENT_PROGRESS_STALE', '完成状态已被其他管理员修改，请刷新')
    await recomputeRecipientCompletion(tx, assignmentId, progress.recipientId)
    await appendEvent(tx, assignmentId, completed ? 'assignment.progress_manually_completed' : 'assignment.progress_manual_completion_revoked', userId, {
      progressId: progress.id,
      assignmentProblemId: progress.assignmentProblemId,
      recipientId: progress.recipientId,
      expectedVersion,
      reason,
    })
    return tx.assignmentProblemProgress.findUniqueOrThrow({ where: { id: progress.id } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function createAssignmentCorrection(userId: string, assignmentId: string, body: any) {
  const assignment = await assertManage(userId, assignmentId)
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(assignment.status)) throw new AssignmentError(409, 'ASSIGNMENT_REVIEW_UNAVAILABLE', '当前作业状态不能布置订正')
  const assignmentProblemId = String(body?.assignmentProblemId || '')
  const recipientId = String(body?.recipientId || '')
  const dueAt = optionalDate(body?.dueAt, '订正截止时间')
  const reason = body?.reason ? boundedText(body.reason, 2000, '订正说明') : null
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment-review:${assignmentId}`}, 0)) IS NULL AS locked`
    const [problem, recipient] = await Promise.all([
      tx.assignmentProblem.findFirst({ where: { id: assignmentProblemId, assignmentId } }),
      tx.assignmentRecipient.findFirst({ where: { id: recipientId, assignmentId, status: { not: 'REMOVED' } } }),
    ])
    if (!problem || !recipient) throw new AssignmentError(422, 'ASSIGNMENT_TARGET_INVALID', '订正对象不属于当前作业')
    const requiredScore = boundedInteger(body?.requiredScore, 0, problem.maxScore, '订正目标分', problem.targetScore)
    const active = await tx.assignmentCorrection.findFirst({ where: { assignmentId, assignmentProblemId, recipientId, status: { in: ['NEEDS_CORRECTION', 'CORRECTING'] } } })
    if (active) throw new AssignmentError(409, 'ASSIGNMENT_CORRECTION_ACTIVE', '该学生在此题已有未完成的订正任务')
    const correction = await tx.assignmentCorrection.create({ data: {
      assignmentId, assignmentProblemId, recipientId, assignedBy: userId, reason, dueAt, requiredScore,
    } })
    await tx.assignmentProblemProgress.updateMany({ where: { assignmentProblemId, recipientId }, data: { correctionStatus: 'NEEDS_CORRECTION' } })
    await appendEvent(tx, assignmentId, 'assignment.correction_assigned', userId, { correctionId: correction.id, assignmentProblemId, recipientId, requiredScore })
    return correction
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function createAssignmentFeedback(userId: string, assignmentId: string, body: any) {
  const assignment = await assertManage(userId, assignmentId)
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(assignment.status)) throw new AssignmentError(409, 'ASSIGNMENT_REVIEW_UNAVAILABLE', '当前作业状态不能创建反馈')
  const recipientId = String(body?.recipientId || '')
  const assignmentProblemId = body?.assignmentProblemId ? String(body.assignmentProblemId) : null
  const visibility = enumValue(body?.visibility, new Set(['RECIPIENT', 'INTERNAL']), 'RECIPIENT', '反馈可见性').toLowerCase()
  const content = boundedText(body?.content, 10_000, '反馈内容', 1)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment-review:${assignmentId}`}, 0)) IS NULL AS locked`
    const [recipient, problem] = await Promise.all([
      tx.assignmentRecipient.findFirst({ where: { id: recipientId, assignmentId, status: { not: 'REMOVED' } } }),
      assignmentProblemId ? tx.assignmentProblem.findFirst({ where: { id: assignmentProblemId, assignmentId } }) : Promise.resolve(null),
    ])
    if (!recipient || (assignmentProblemId && !problem)) throw new AssignmentError(422, 'ASSIGNMENT_TARGET_INVALID', '反馈对象不属于当前作业')
    const feedback = await tx.assignmentFeedback.create({ data: {
      assignmentId, assignmentProblemId, recipientId, authorUserId: userId, visibility, content,
    } })
    await appendEvent(tx, assignmentId, 'assignment.feedback_created', userId, { feedbackId: feedback.id, assignmentProblemId, recipientId, visibility: feedback.visibility })
    return feedback
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function adjustAssignmentScore(userId: string, assignmentId: string, body: any) {
  const assignment = await assertManage(userId, assignmentId)
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(assignment.status)) throw new AssignmentError(409, 'ASSIGNMENT_REVIEW_UNAVAILABLE', '当前作业状态不能人工调分')
  const recipientId = String(body?.recipientId || '')
  if (!await prisma.assignmentRecipient.findFirst({ where: { id: recipientId, assignmentId, status: { not: 'REMOVED' } } })) throw new AssignmentError(422, 'ASSIGNMENT_TARGET_INVALID', '调分对象不属于当前作业')
  const assignmentProblemId = body?.assignmentProblemId ? String(body.assignmentProblemId) : null
  if (assignmentProblemId && !await prisma.assignmentProblem.findFirst({ where: { id: assignmentProblemId, assignmentId } })) throw new AssignmentError(422, 'ASSIGNMENT_TARGET_INVALID', '调分题目不属于当前作业')
  const delta = boundedInteger(body?.delta, -1000, 1000, '调分值')
  if (delta === 0) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_ADJUSTMENT', '调分值不能为 0')
  const reason = boundedText(body?.reason, 2000, '调分原因', 1)
  return prisma.$transaction(async tx => {
    const created = await tx.assignmentScoreAdjustment.create({ data: { assignmentId, assignmentProblemId, recipientId, delta, reason, createdBy: userId } })
    await appendEvent(tx, assignmentId, 'assignment.score_adjusted', userId, { adjustmentId: created.id, assignmentProblemId, recipientId, delta })
    return created
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function reverseAssignmentScoreAdjustment(userId: string, assignmentId: string, adjustmentId: string, body: any) {
  await assertManage(userId, assignmentId)
  const original = await prisma.assignmentScoreAdjustment.findFirst({ where: { id: adjustmentId, assignmentId } })
  if (!original) throw new AssignmentError(404, 'ASSIGNMENT_ADJUSTMENT_NOT_FOUND', '调分记录不存在')
  if (await prisma.assignmentScoreAdjustment.findFirst({ where: { reversedAdjustmentId: adjustmentId } })) throw new AssignmentError(409, 'ASSIGNMENT_ADJUSTMENT_ALREADY_REVERSED', '调分记录已经冲正')
  const reason = boundedText(body?.reason, 2000, '冲正原因', 1)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment-adjustment:${adjustmentId}`}, 0)) IS NULL AS locked`
    if (await tx.assignmentScoreAdjustment.findFirst({ where: { reversedAdjustmentId: adjustmentId } })) throw new AssignmentError(409, 'ASSIGNMENT_ADJUSTMENT_ALREADY_REVERSED', '调分记录已经冲正')
    const created = await tx.assignmentScoreAdjustment.create({ data: { assignmentId, assignmentProblemId: original.assignmentProblemId, recipientId: original.recipientId, delta: -original.delta, reason, createdBy: userId, reversedAdjustmentId: original.id } })
    await appendEvent(tx, assignmentId, 'assignment.score_adjustment_reversed', userId, { adjustmentId: original.id, reversalId: created.id })
    return created
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

async function createGradeSnapshots(tx: Prisma.TransactionClient, assignmentId: string, type: 'DUE' | 'CLOSE' | 'POST_CORRECTION' | 'FINAL_RELEASE' | 'REGRADE', createdBy: string) {
  const assignment = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { Problems: true, Recipients: { include: { Progress: true, ScoreAdjustments: true } } } })
  for (const recipient of assignment.Recipients.filter(item => item.status !== 'REMOVED')) {
    const grade = calculateAssignmentGrade(assignment, assignment.Problems, recipient.Progress)
    const rawScore = grade.rawScore
    const maxScore = grade.maxScore
    const adjustment = recipient.ScoreAdjustments.reduce((sum, item) => sum + item.delta, 0)
    const totalScore = Math.max(0, rawScore + adjustment)
    const latest = await tx.assignmentGradeSnapshot.findFirst({ where: { assignmentId, recipientId: recipient.id, type }, orderBy: { revision: 'desc' }, select: { revision: true } })
    await tx.assignmentGradeSnapshot.create({ data: {
      assignmentId, recipientId: recipient.id, type, revision: (latest?.revision || 0) + 1,
      totalScore, maxScore, createdBy,
      gradeData: { gradingVersion: assignment.gradingVersion, rawScore, adjustment, components: grade.components, evidence: grade.evidence, problems: recipient.Progress.map(progress => ({ assignmentProblemId: progress.assignmentProblemId, finalScore: progress.finalScore, learningStatus: progress.learningStatus, timelinessStatus: progress.timelinessStatus, correctionStatus: progress.correctionStatus })) },
    } })
  }
}

export async function processDueAssignments(now = new Date()) {
  const candidates = await prisma.assignment.findMany({
    where: { OR: [{ status: 'SCHEDULED', openAt: { lte: now } }, { status: 'OPEN', dueAt: { lte: now } }, { status: { in: ['OPEN', 'OVERDUE'] }, closeAt: { lte: now } }] },
    select: { id: true }, take: 200,
  })
  const result = { opened: 0, overdue: 0, closed: 0 }
  for (const candidate of candidates) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${candidate.id}`}, 0)) IS NULL AS locked`
      const current = await tx.assignment.findUnique({ where: { id: candidate.id }, select: { status: true, openAt: true, dueAt: true, closeAt: true } })
      if (!current) return
      let next: AssignmentStatus | null = null
      if (['OPEN', 'OVERDUE'].includes(current.status) && current.closeAt <= now) next = 'CLOSED'
      else if (current.status === 'OPEN' && current.dueAt <= now) next = 'OVERDUE'
      else if (current.status === 'SCHEDULED' && current.openAt <= now) next = now >= current.closeAt ? 'CLOSED' : now >= current.dueAt ? 'OVERDUE' : 'OPEN'
      if (!next || next === current.status) return
      await tx.assignment.update({ where: { id: candidate.id }, data: { status: next, ...(next === 'CLOSED' ? { closedAt: now } : {}), statusRevision: { increment: 1 } } })
      if (next === 'OVERDUE') {
        await evaluateAutomaticCorrections(tx, candidate.id, 'DUE', null)
        await createGradeSnapshots(tx, candidate.id, 'DUE', 'system')
      }
      if (next === 'CLOSED') {
        await evaluateAutomaticCorrections(tx, candidate.id, 'CLOSE', null)
        await createGradeSnapshots(tx, candidate.id, 'CLOSE', 'system')
      }
      await appendEvent(tx, candidate.id, `assignment.${next.toLowerCase()}`, null, { automatic: true, at: now.toISOString() })
      if (next === 'OPEN') result.opened++
      else if (next === 'OVERDUE') result.overdue++
      else result.closed++
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }
  return result
}

export function hashLegacyAssignments(rows: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}
