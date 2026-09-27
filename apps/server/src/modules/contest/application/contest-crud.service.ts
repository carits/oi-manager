import { Prisma } from '@prisma/client'
import { getAccountRole } from '../../../middleware/auth'
import { prisma } from '../../../prisma'
import { logger } from '../../../lib/logger'
import { teamService } from '../../team/team.service'
import {
  canAccessContest,
  canManageContest,
  getComputedContestStatus,
  isTeamAdmin,
  isTeamMember,
  sortContestListForDisplay,
} from '../contest.helpers'
import crypto from 'node:crypto'
import { judgeMaxScoreFromSnapshot } from '../../assignment/assignment-grading'
import {
  findContestForAccess,
  findContestForDetail,
  listTeamContests as listCanonicalTeamContests,
  listPlatformContests as listCanonicalPlatformContests,
} from '../../contest/contest-query.facade'
import { resolveOrganizationAuthorization } from '../../authorization/capabilities'
import {
  createContestTx,
  deleteContestTx,
  transitionContestLifecycleTx,
  updateContestTx,
} from '../../contest/contest-command.service'

export class ContestCrudError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ContestCrudError(statusCode, code, message)
}

function parseDate(value: unknown, field: string) {
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) fail(400, 'INVALID_DATE', `${field}格式无效`)
  return parsed
}

export async function listTeamContests(params: { teamId: string; user: any; typeFilter?: string }) {
  const team = await teamService.assertTeamScope(params.teamId, params.user)
  if (!await isTeamMember(params.user.userId, params.teamId)) {
    fail(403, 'CONTEST_ACCESS_DENIED', '无权限查看该团队比赛')
  }
  const contests = await listCanonicalTeamContests(params.teamId, team.scope)
  const now = new Date()
  return sortContestListForDisplay(contests.map(contest => ({
    id: contest.id,
    title: contest.title,
    description: contest.description,
    format: contest.format,
    startTime: contest.startTime.toISOString(),
    endTime: contest.endTime.toISOString(),
    status: getComputedContestStatus(contest, now),
    createdBy: contest.createdBy,
    type: 'contest',
    problemCount: contest._count.ContestProblem,
    participantCount: contest._count.ContestParticipant,
    createdAt: contest.createdAt.toISOString(),
  })))
}

export async function createTeamContest(params: { teamId: string; user: any; input: any }) {
  const team = await teamService.assertTeamScope(params.teamId, params.user)
  if (!await isTeamAdmin(params.user.userId, params.teamId)) {
    fail(403, 'CONTEST_MANAGE_DENIED', '只有团队管理员可以创建比赛')
  }
  const { title, description, format, startTime, endTime, problemIdVisible,
    solutionVisible, includeAdminInRanking, type } = params.input
  if (type !== undefined && type !== 'contest') {
    fail(400, 'CONTEST_TYPE_INVALID', '该接口只允许创建比赛')
  }
  if (!title || !startTime || !endTime) fail(400, 'CONTEST_FIELDS_REQUIRED', '标题、开始时间、结束时间为必填')
  const start = parseDate(startTime, '开始时间')
  const end = parseDate(endTime, '结束时间')
  if (end <= start) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  if (start <= new Date()) fail(400, 'START_TIME_IN_PAST', '开始时间不能早于当前时间')
  const contest = await prisma.$transaction(tx => createContestTx(tx, {
    teamId: params.teamId,
    organizationId: null,
    scope: team.scope,
    title,
    description: description || null,
    format: format || 'ioi',
    startTime: start,
    endTime: end,
    status: 'upcoming',
    createdBy: params.user.userId,
    problemIdVisible: problemIdVisible ?? false,
    solutionVisible: solutionVisible ?? false,
    includeAdminInRanking: includeAdminInRanking ?? false,
  }))
  logger.info('contest_created', { action: 'contests', metadata: { contestId: contest.id, teamId: params.teamId } })
  return contest
}

export async function listPlatformContests(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, status: 'active' }, select: { id: true } })
  if (!user) fail(403, 'PLATFORM_CONTEST_ACCESS_DENIED', '账号不可用')
  const contests = await listCanonicalPlatformContests()
  const now = new Date()
  return sortContestListForDisplay(contests.map(contest => ({
    id: contest.id,
    title: contest.title,
    description: contest.description,
    format: contest.format,
    startTime: contest.startTime.toISOString(),
    endTime: contest.endTime.toISOString(),
    status: getComputedContestStatus(contest, now),
    createdBy: contest.createdBy,
    type: contest.type,
    scope: contest.scope,
    problemCount: contest._count.ContestProblem,
    participantCount: contest._count.ContestParticipant,
    ratingConfig: contest.RatingConfig,
    createdAt: contest.createdAt.toISOString(),
  })))
}

export async function createPlatformContest(params: { user: any; input: any }) {
  if (!['super_admin', 'platform_admin'].includes(getAccountRole(params.user) || '')) {
    fail(403, 'PLATFORM_CONTEST_MANAGE_DENIED', '只有平台管理员可以创建平台比赛')
  }
  const title = typeof params.input.title === 'string' ? params.input.title.trim() : ''
  const format = typeof params.input.format === 'string' ? params.input.format.toLowerCase() : 'ioi'
  if (!['oi', 'ioi', 'icpc'].includes(format)) fail(400, 'TRAINING_FORMAT_INVALID', '比赛赛制无效')
  if (!title || !params.input.startTime || !params.input.endTime) {
    fail(400, 'TRAINING_FIELDS_REQUIRED', '标题、开始时间、结束时间为必填')
  }
  const startTime = parseDate(params.input.startTime, '开始时间')
  const endTime = parseDate(params.input.endTime, '结束时间')
  if (endTime <= startTime) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  if (startTime <= new Date()) fail(400, 'START_TIME_IN_PAST', '开始时间不能早于当前时间')

  const contest = await prisma.$transaction(async tx => {
    const row = await createContestTx(tx, {
      teamId: null,
      organizationId: null,
      scope: 'platform',
      title,
      description: typeof params.input.description === 'string' ? params.input.description.trim() || null : null,
      format,
      startTime,
      endTime,
      status: 'upcoming',
      createdBy: params.user.userId,
      problemIdVisible: params.input.problemIdVisible ?? false,
      solutionVisible: params.input.solutionVisible ?? false,
      includeAdminInRanking: params.input.includeAdminInRanking ?? false,
    })
    await tx.platformAuditLog.create({ data: {
      id: crypto.randomUUID(), actorUserId: params.user.userId,
      action: 'platform_contest_created', targetType: 'contest', targetId: String(row.id),
      metadata: { format: row.format, startTime: row.startTime, endTime: row.endTime },
    } })
    return row
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  logger.info('platform_contest_created', { action: 'contests', metadata: { contestId: contest.id } })
  return contest
}

export async function synchronizeContestStatus(contest: any, now: Date) {
  const computedStatus = getComputedContestStatus(contest, now)
  if (computedStatus === contest.status) return computedStatus
  const synchronization = await prisma.$transaction(async tx => {
    const result = await transitionContestLifecycleTx(tx, {
      publicId: contest.id,
      actorUserId: contest.createdBy,
      expectedStatus: contest.status,
      targetStatus: computedStatus as 'upcoming' | 'ongoing' | 'finished',
    })
    return { status: result?.contest?.status || computedStatus, visibleCount: result?.visibleSubmissionCount || 0 }
  })
  if (synchronization.status === 'finished') logger.info('contest_submissions_visible', {
    action: 'contest', metadata: { contestId: contest.id, updatedCount: synchronization.visibleCount },
  })
  return synchronization.status
}

export async function getContestDetail(id: number, userId: string) {
  const contest = await findContestForDetail(id)
  if (!contest) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  if (!await canAccessContest(userId, contest)) {
    fail(403, 'CONTEST_ACCESS_DENIED', '无权限查看该比赛')
  }
  const status = await synchronizeContestStatus(contest, new Date())
  const isAdmin = await canManageContest(userId, contest)
  return {
    id: contest.id,
    teamId: contest.teamId,
    organizationId: contest.organizationId,
    title: contest.title,
    description: contest.description,
    format: contest.format,
    startTime: contest.startTime.toISOString(),
    endTime: contest.endTime.toISOString(),
    status,
    createdBy: contest.createdBy,
    problemIdVisible: contest.problemIdVisible,
    solutionVisible: contest.solutionVisible,
    includeAdminInRanking: contest.includeAdminInRanking,
    type: contest.type,
    scope: contest.scope,
    finalizationStatus: contest.finalizationStatus,
    finalizedStandingId: contest.finalizedStandingId,
    ratingConfig: contest.RatingConfig ? {
      scope: contest.RatingConfig.scope,
      track: contest.RatingConfig.track,
      weight: contest.RatingConfig.weightBasisPoints / 10_000,
      lockedAt: contest.RatingConfig.lockedAt,
      revision: contest.RatingConfig.revision,
    } : null,
    problemCount: contest._count.ContestProblem,
    participantCount: contest._count.ContestParticipant,
    isAdmin,
    createdAt: contest.createdAt.toISOString(),
  }
}

async function requireManagedContest(id: number, userId: string, deniedMessage: string) {
  const contest = (await findContestForAccess(id))?.contest
  if (!contest) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  if (!await canManageContest(userId, contest)) {
    fail(403, 'CONTEST_MANAGE_DENIED', deniedMessage)
  }
  return contest
}

export async function updateContest(id: number, userId: string, input: any) {
  const contest = await requireManagedContest(id, userId, '只有管理员可以编辑比赛')
  const now = new Date()
  const isStarted = now >= contest.startTime
  if (isStarted && input.format !== undefined && input.format !== contest.format) {
    fail(409, 'RATING_CONFIG_FROZEN', '比赛开始后不能修改赛制或 Rating Track')
  }
  if (input.startTime !== undefined && isStarted) {
    fail(400, 'TRAINING_ALREADY_STARTED', '比赛已经开始，不能修改开始时间')
  }
  if (!isStarted && input.startTime) {
    const requestedStart = parseDate(input.startTime, '开始时间')
    if (requestedStart <= now) fail(400, 'START_TIME_IN_PAST', '开始时间不能早于当前时间')
  }
  const newStartTime = input.startTime ? parseDate(input.startTime, '开始时间') : contest.startTime
  const newEndTime = input.endTime ? parseDate(input.endTime, '结束时间') : contest.endTime
  if (newEndTime <= newStartTime) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  if (newEndTime <= now) fail(400, 'END_TIME_IN_PAST', '结束时间不能早于当前时间')

  const updated = await prisma.$transaction(async tx => {
    const patch = {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.format !== undefined && { format: input.format }),
      ...(input.startTime !== undefined && { startTime: newStartTime }),
      ...(input.endTime !== undefined && { endTime: newEndTime }),
      ...(input.problemIdVisible !== undefined && { problemIdVisible: input.problemIdVisible }),
      ...(input.solutionVisible !== undefined && { solutionVisible: input.solutionVisible }),
      ...(input.includeAdminInRanking !== undefined && {
        includeAdminInRanking: input.includeAdminInRanking,
      }),
    }
    const result = await updateContestTx(tx, {
      publicId: id,
      expected: {
        status: contest.status,
        format: contest.format,
        startTime: contest.startTime,
        endTime: contest.endTime,
      },
      patch,
    })
    if (result.conflict === 'rating_locked') fail(409, 'RATING_CONFIG_FROZEN', '比赛开始后不能修改赛制或 Rating Track')
    if (result.conflict) fail(409, 'CONTEST_UPDATE_STALE', '比赛配置已被其他管理员修改，请刷新后重试')
    return result.contest!
  })
  logger.info('contest_updated', { action: 'contests', metadata: { contestId: id } })
  return updated
}

export async function updateContestEndTime(id: number, userId: string, endTime: unknown) {
  if (!endTime) fail(400, 'END_TIME_REQUIRED', '结束时间为必填')
  const contest = await requireManagedContest(id, userId, '只有管理员可以修改结束时间')
  const end = parseDate(endTime, '结束时间')
  if (end <= new Date()) fail(400, 'END_TIME_IN_PAST', '结束时间不能早于当前时间')
  if (end <= contest.startTime) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  return prisma.$transaction(async tx => {
    const result = await updateContestTx(tx, {
      publicId: id,
      expected: {
        status: contest.status,
        format: contest.format,
        startTime: contest.startTime,
        endTime: contest.endTime,
      },
      patch: { endTime: end },
    })
    if (result.conflict) fail(409, 'CONTEST_UPDATE_STALE', '比赛配置已被其他管理员修改，请刷新后重试')
    return result.contest!
  })
}

export async function startContest(id: number, userId: string) {
  const contest = await requireManagedContest(id, userId, '只有管理员可以立即开始比赛')
  const now = new Date()
  if (contest.status === 'finished' || now >= contest.endTime) {
    fail(400, 'TRAINING_ALREADY_FINISHED', '比赛已经结束，不能开始')
  }
  if (contest.status === 'ongoing' || now >= contest.startTime) {
    return { contest, message: '比赛已经开始' }
  }
  const started = await prisma.$transaction(async tx => {
    const result = await transitionContestLifecycleTx(tx, {
      publicId: id,
      actorUserId: userId,
      expectedStatus: contest.status,
      targetStatus: 'ongoing',
      startTime: now,
    })
    return result?.contest || contest
  })
  logger.info('contest_started_early', { action: 'contests', metadata: { contestId: id, userId } })
  return { contest: started, message: '比赛已开始' }
}

export async function finishContest(id: number, userId: string) {
  const contest = await requireManagedContest(id, userId, '只有管理员可以提前结束比赛')
  const now = new Date()
  if (contest.status === 'finished' || now >= contest.endTime) {
    return { contest, message: '比赛已经结束' }
  }
  if (now < contest.startTime) fail(400, 'TRAINING_NOT_STARTED', '比赛尚未开始，不能提前结束')
  const finished = await prisma.$transaction(async tx => {
    const result = await transitionContestLifecycleTx(tx, {
      publicId: id,
      actorUserId: userId,
      expectedStatus: contest.status,
      targetStatus: 'finished',
      endTime: now,
    })
    return result?.contest || contest
  })
  logger.info('contest_finished_early', { action: 'contests', metadata: { contestId: id, userId } })
  return { contest: finished, message: '比赛已结束' }
}

export async function deleteContest(id: number, userId: string) {
  const contest = (await findContestForAccess(id))?.contest
  if (!contest) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  const isAdmin = await canManageContest(userId, contest)
  if (contest.createdBy !== userId && !isAdmin) {
    fail(403, 'CONTEST_DELETE_DENIED', '只有创建者或管理员可以删除比赛')
  }
  if (contest.finalizedStandingId) {
    fail(409, 'FINALIZED_CONTEST_DELETE_FORBIDDEN', '已生成最终榜单的比赛必须永久保留')
  }
  const deleted = await prisma.$transaction(tx => deleteContestTx(tx, id))
  if (deleted.conflict === 'missing') fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  if (deleted.conflict === 'finalized') {
    fail(409, 'FINALIZED_CONTEST_DELETE_FORBIDDEN', '已生成最终榜单的比赛必须永久保留')
  }
  logger.info('contest_deleted', { action: 'contests', metadata: { contestId: id } })
}

export async function createMakeupHomework(id: number, userId: string, input: any) {
  const contest = await prisma.contest.findUnique({
    where: { publicId: id },
    include: {
      Team: { select: { organizationId: true } },
      ContestProblem: {
        orderBy: { orderIndex: 'asc' },
        include: { CanonicalProblem: { include: { TestSetSlots: { where: { slot: 'STABLE' } } } } },
      },
    },
  })
  if (!contest) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  const activity = (await findContestForAccess(id))?.contest
  if (!activity || !await canManageContest(userId, activity)) fail(403, 'CONTEST_MANAGE_DENIED', '只有管理员可以创建补题作业')
  const now = new Date()
  const endAt = contest.endAt || contest.contestDate
  if (now <= endAt && contest.status !== 'finished') fail(400, 'CONTEST_NOT_FINISHED', '只有已结束的比赛才能创建补题作业')
  if (!input.endTime) fail(400, 'END_TIME_REQUIRED', '结束时间为必填')
  const startTime = input.startTime ? parseDate(input.startTime, '开始时间') : now
  const endTime = parseDate(input.endTime, '结束时间')
  if (endTime <= startTime) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  const organizationId = contest.organizationId || contest.Team?.organizationId || null
  if (!organizationId) fail(422, 'ASSIGNMENT_SCOPE_REQUIRED', '补题作业必须属于学校组织')
  const creatorAuthorization = await resolveOrganizationAuthorization(userId, organizationId)
  if (!creatorAuthorization?.capabilities.has('assignment.create')) fail(403, 'ASSIGNMENT_CREATE_DENIED', '当前身份没有创建作业的权限')
  if (!contest.ContestProblem.length) fail(422, 'ASSIGNMENT_PROBLEMS_REQUIRED', '原比赛没有可加入补题作业的题目')

  const assignment = await prisma.$transaction(async tx => {
    const created = await tx.assignment.create({ data: {
      teamId: contest.teamId,
      organizationId,
      title: input.title || `${contest.title} - 补题练习`,
      description: contest.description,
      rosterMode: 'DYNAMIC', gradingPolicy: 'BEST_BEFORE_DUE', latePolicy: 'DISALLOW',
      correctionPolicy: 'NONE', solutionReleasePolicy: 'AFTER_RELEASE',
      openAt: startTime, dueAt: endTime, closeAt: endTime,
      createdByMembershipId: creatorAuthorization.membershipId, eventSeq: 1,
    } })
    const seen = new Set<string>()
    for (const [index, problem] of contest.ContestProblem.entries()) {
      const canonical = problem.CanonicalProblem
      if (!canonical || seen.has(canonical.id)) continue
      seen.add(canonical.id)
      const stable = canonical.TestSetSlots[0]
      if (!stable) fail(422, 'ASSIGNMENT_STABLE_REQUIRED', `题目 ${problem.title || canonical.problemId} 尚无 Stable 测试数据`)
      const maxScore = problem.points && problem.points > 0 ? problem.points : 100
      await tx.assignmentProblem.create({ data: {
        assignmentId: created.id, problemId: canonical.id,
        orderIndex: index, category: 'REQUIRED', required: true, maxScore,
        judgeMaxScore: judgeMaxScoreFromSnapshot(stable.judgeConfig, stable.mode), targetScore: maxScore,
        weight: 100, completionPolicy: stable.mode === 'acm' ? 'AC' : 'TARGET_SCORE',
        judgeConfigSnapshot: stable.judgeConfig, judgeConfigHash: stable.judgeConfigHash,
        settings: { sourceContestId: contest.id, sourceContestProblemId: problem.id, alias: problem.alias },
      } })
    }
    await tx.assignmentEvent.create({ data: {
      assignmentId: created.id, seq: 1, type: 'assignment.created_from_contest', actorUserId: userId,
      payload: { sourceContestId: contest.id, problemCount: seen.size },
    } })
    return created
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  logger.info('makeup_homework_created', { action: 'contest', metadata: { sourceContestId: contest.id, assignmentId: assignment.id, teamId: contest.teamId } })
  return { id: assignment.id, title: assignment.title, type: 'assignment', sourceContestId: contest.id,
    startTime: assignment.openAt.toISOString(), endTime: assignment.closeAt.toISOString(),
    teamId: assignment.teamId, organizationId: assignment.organizationId, problemCount: contest.ContestProblem.length }
}
