import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { logger } from '../../../lib/logger'
import { fileService } from '../../../lib/storage'
import { teamService } from '../../team/team.service'
import {
  canAccessTraining,
  canManageTraining,
  getComputedTrainingStatus,
  isTeamAdmin,
  isTeamMember,
  sortTrainingListForDisplay,
} from '../training.helpers'
import crypto from 'node:crypto'
import { judgeMaxScoreFromSnapshot } from '../../assignment/assignment-grading'
import { listPlatformContestRuntimes } from '../../contest/contest-query.facade'
import {
  createContestRuntimeTx,
  deleteContestRuntimeTx,
  transitionContestLifecycleTx,
  updateContestRuntimeTx,
} from '../../contest/contest-command.service'

export class TrainingCrudError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new TrainingCrudError(statusCode, code, message)
}

function parseDate(value: unknown, field: string) {
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) fail(400, 'INVALID_DATE', `${field}格式无效`)
  return parsed
}

export async function listTeamTrainings(params: {
  teamId: string
  user: any
  typeFilter?: string
}) {
  const team = await teamService.assertTeamScope(params.teamId, params.user)
  if (!await isTeamMember(params.user.userId, params.teamId)) {
    fail(403, 'TRAINING_ACCESS_DENIED', '无权限查看该团队训练')
  }

  const trainings = await prisma.training.findMany({
    where: {
      teamId: params.teamId,
      scope: team.scope,
      ...(params.typeFilter ? { type: params.typeFilter } : {}),
    },
    include: { _count: { select: { TrainingProblem: true } } },
    orderBy: { startTime: 'desc' },
  })
  const participantCounts = new Map<number, number>()
  if (trainings.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ trainingId: number; count: bigint }>>`
      SELECT "trainingId", COUNT(DISTINCT "userId")::int as count
      FROM "Submission"
      WHERE "trainingId" IN (${Prisma.join(trainings.map(training => training.id))})
        AND "submitScope" IN ('training', 'contest')
        AND "workspaceScope" = ${team.scope}
      GROUP BY "trainingId"
    `
    for (const row of rows) participantCounts.set(Number(row.trainingId), Number(row.count))
  }

  const now = new Date()
  return sortTrainingListForDisplay(trainings.map(training => ({
    id: training.id,
    title: training.title,
    description: training.description,
    format: training.format,
    startTime: training.startTime.toISOString(),
    endTime: training.endTime.toISOString(),
    status: getComputedTrainingStatus(training, now),
    createdBy: training.createdBy,
    type: training.type,
    problemCount: training._count.TrainingProblem,
    participantCount: participantCounts.get(training.id) || 0,
    createdAt: training.createdAt.toISOString(),
  })))
}

export async function createTeamTraining(params: {
  teamId: string
  user: any
  input: any
}) {
  const team = await teamService.assertTeamScope(params.teamId, params.user)
  if (!await isTeamAdmin(params.user.userId, params.teamId)) {
    fail(403, 'TRAINING_MANAGE_DENIED', '只有团队管理员可以创建训练')
  }
  const { title, description, format, startTime, endTime, problemIdVisible,
    solutionVisible, includeAdminInRanking, type } = params.input
  if (type === 'homework') {
    fail(410, 'LEGACY_HOMEWORK_API_RETIRED', '旧作业写入接口已退役，请使用 Assignment 作业接口')
  }
  if (type !== undefined && !['training', 'contest'].includes(type)) {
    fail(400, 'TRAINING_TYPE_INVALID', '活动类型无效')
  }
  if (!title || !startTime || !endTime) {
    fail(400, 'TRAINING_FIELDS_REQUIRED', '标题、开始时间、结束时间为必填')
  }
  const start = parseDate(startTime, '开始时间')
  const end = parseDate(endTime, '结束时间')
  if (end <= start) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  if (start <= new Date()) fail(400, 'START_TIME_IN_PAST', '开始时间不能早于当前时间')

  const activityType = type || 'training'
  const training = await prisma.$transaction(async tx => {
    if (activityType === 'contest') {
      return createContestRuntimeTx(tx, {
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
      })
    }
    const row = await tx.training.create({ data: {
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
      type: activityType,
      updatedAt: new Date(),
    } })
    return row
  })
  logger.info('training_created', {
    action: 'trainings', metadata: { trainingId: training.id, teamId: params.teamId },
  })
  return training
}

export async function listPlatformContests(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, status: 'active' }, select: { id: true } })
  if (!user) fail(403, 'PLATFORM_CONTEST_ACCESS_DENIED', '账号不可用')
  const contests = await listPlatformContestRuntimes()
  const now = new Date()
  return sortTrainingListForDisplay(contests.map(contest => ({
    id: contest.id,
    title: contest.title,
    description: contest.description,
    format: contest.format,
    startTime: contest.startTime.toISOString(),
    endTime: contest.endTime.toISOString(),
    status: getComputedTrainingStatus(contest, now),
    createdBy: contest.createdBy,
    type: contest.type,
    scope: contest.scope,
    problemCount: contest._count.TrainingProblem,
    participantCount: contest._count.TrainingParticipant,
    ratingConfig: contest.RatingConfig,
    createdAt: contest.createdAt.toISOString(),
  })))
}

export async function createPlatformContest(params: { user: any; input: any }) {
  if (!['super_admin', 'platform_admin'].includes(params.user.role)) {
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
    const row = await createContestRuntimeTx(tx, {
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
      action: 'platform_contest_created', targetType: 'training', targetId: String(row.id),
      metadata: { format: row.format, startTime: row.startTime, endTime: row.endTime },
    } })
    return row
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  logger.info('platform_contest_created', { action: 'trainings', metadata: { trainingId: contest.id } })
  return contest
}

export async function synchronizeTrainingStatus(training: any, now: Date) {
  const computedStatus = getComputedTrainingStatus(training, now)
  if (computedStatus === training.status) return computedStatus
  const synchronization = await prisma.$transaction(async tx => {
    if (training.type === 'contest') {
      const result = await transitionContestLifecycleTx(tx, {
        runtimeTrainingId: training.id,
        actorUserId: training.createdBy,
        expectedStatus: training.status,
        targetStatus: computedStatus as 'upcoming' | 'ongoing' | 'finished',
      })
      return {
        status: result?.runtime?.status || computedStatus,
        visibleCount: result?.visibleSubmissionCount || 0,
      }
    }
    await tx.training.update({ where: { id: training.id }, data: {
      status: computedStatus,
    } })
    return { status: computedStatus, visibleCount: 0 }
  })
  if (synchronization.status === 'finished' && training.type === 'contest') {
    logger.info('contest_submissions_visible', {
      action: 'training',
      metadata: {
        contestId: training.id,
        updatedCount: synchronization.visibleCount,
        message: '比赛结束，提交记录已公开',
      },
    })
  }
  return synchronization.status
}

export async function getTrainingDetail(id: number, userId: string) {
  const training = await prisma.training.findUnique({
    where: { id },
    include: { RatingConfig: true, _count: { select: { TrainingParticipant: true, TrainingProblem: true } } },
  })
  if (!training) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  if (!await canAccessTraining(userId, training)) {
    fail(403, 'TRAINING_ACCESS_DENIED', '无权限查看该训练')
  }
  const status = await synchronizeTrainingStatus(training, new Date())
  const isAdmin = await canManageTraining(userId, training)
  return {
    id: training.id,
    teamId: training.teamId,
    organizationId: training.organizationId,
    title: training.title,
    description: training.description,
    format: training.format,
    startTime: training.startTime.toISOString(),
    endTime: training.endTime.toISOString(),
    status,
    createdBy: training.createdBy,
    problemIdVisible: training.problemIdVisible,
    solutionVisible: training.solutionVisible,
    includeAdminInRanking: training.includeAdminInRanking,
    type: training.type,
    scope: training.scope,
    sourceTrainingId: training.sourceTrainingId,
    finalizationStatus: training.finalizationStatus,
    finalizedStandingId: training.finalizedStandingId,
    ratingConfig: training.RatingConfig ? {
      scope: training.RatingConfig.scope,
      track: training.RatingConfig.track,
      weight: training.RatingConfig.weightBasisPoints / 10_000,
      lockedAt: training.RatingConfig.lockedAt,
      revision: training.RatingConfig.revision,
    } : null,
    problemCount: training._count.TrainingProblem,
    participantCount: training._count.TrainingParticipant,
    isAdmin,
    createdAt: training.createdAt.toISOString(),
  }
}

async function requireManagedTraining(id: number, userId: string, deniedMessage: string) {
  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  if (!await canManageTraining(userId, training)) {
    fail(403, 'TRAINING_MANAGE_DENIED', deniedMessage)
  }
  return training
}

export async function updateTraining(id: number, userId: string, input: any) {
  const training = await requireManagedTraining(id, userId, '只有管理员可以编辑训练')
  const now = new Date()
  const isStarted = now >= training.startTime
  if (isStarted && input.format !== undefined && input.format !== training.format) {
    fail(409, 'RATING_CONFIG_FROZEN', '比赛开始后不能修改赛制或 Rating Track')
  }
  if (input.startTime !== undefined && isStarted) {
    fail(400, 'TRAINING_ALREADY_STARTED', '训练已经开始，不能修改开始时间')
  }
  if (!isStarted && input.startTime) {
    const requestedStart = parseDate(input.startTime, '开始时间')
    if (requestedStart <= now) fail(400, 'START_TIME_IN_PAST', '开始时间不能早于当前时间')
  }
  const newStartTime = input.startTime ? parseDate(input.startTime, '开始时间') : training.startTime
  const newEndTime = input.endTime ? parseDate(input.endTime, '结束时间') : training.endTime
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
    if (training.type === 'contest') {
      const result = await updateContestRuntimeTx(tx, {
        runtimeTrainingId: id,
        expected: {
          status: training.status,
          format: training.format,
          startTime: training.startTime,
          endTime: training.endTime,
        },
        patch,
      })
      if (result.conflict === 'rating_locked') fail(409, 'RATING_CONFIG_FROZEN', '比赛开始后不能修改赛制或 Rating Track')
      if (result.conflict) fail(409, 'CONTEST_UPDATE_STALE', '比赛配置已被其他管理员修改，请刷新后重试')
      return result.runtime!
    }
    return tx.training.update({ where: { id }, data: patch })
  })
  logger.info('training_updated', { action: 'trainings', metadata: { trainingId: id } })
  return updated
}

export async function updateTrainingEndTime(id: number, userId: string, endTime: unknown) {
  if (!endTime) fail(400, 'END_TIME_REQUIRED', '结束时间为必填')
  const training = await requireManagedTraining(id, userId, '只有管理员可以修改结束时间')
  const end = parseDate(endTime, '结束时间')
  if (end <= new Date()) fail(400, 'END_TIME_IN_PAST', '结束时间不能早于当前时间')
  if (end <= training.startTime) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  return prisma.$transaction(async tx => {
    if (training.type === 'contest') {
      const result = await updateContestRuntimeTx(tx, {
        runtimeTrainingId: id,
        expected: {
          status: training.status,
          format: training.format,
          startTime: training.startTime,
          endTime: training.endTime,
        },
        patch: { endTime: end },
      })
      if (result.conflict) fail(409, 'CONTEST_UPDATE_STALE', '比赛配置已被其他管理员修改，请刷新后重试')
      return result.runtime!
    }
    return tx.training.update({ where: { id }, data: { endTime: end } })
  })
}

export async function startTraining(id: number, userId: string) {
  const training = await requireManagedTraining(id, userId, '只有管理员可以立即开始比赛')
  const now = new Date()
  if (training.status === 'finished' || now >= training.endTime) {
    fail(400, 'TRAINING_ALREADY_FINISHED', '比赛已经结束，不能开始')
  }
  if (training.status === 'ongoing' || now >= training.startTime) {
    return { training, message: '比赛已经开始' }
  }
  const started = await prisma.$transaction(async tx => {
    if (training.type === 'contest') {
      const result = await transitionContestLifecycleTx(tx, {
        runtimeTrainingId: id,
        actorUserId: userId,
        expectedStatus: training.status,
        targetStatus: 'ongoing',
        startTime: now,
      })
      return result?.runtime || training
    }
    const row = await tx.training.update({ where: { id }, data: { status: 'ongoing', startTime: now } })
    return row
  })
  logger.info('training_started_early', { action: 'trainings', metadata: { trainingId: id, userId } })
  return { training: started, message: '比赛已开始' }
}

export async function finishTraining(id: number, userId: string) {
  const training = await requireManagedTraining(id, userId, '只有管理员可以提前结束比赛')
  const now = new Date()
  if (training.status === 'finished' || now >= training.endTime) {
    return { training, message: '比赛已经结束' }
  }
  if (now < training.startTime) fail(400, 'TRAINING_NOT_STARTED', '比赛尚未开始，不能提前结束')
  const finished = await prisma.$transaction(async tx => {
    if (training.type === 'contest') {
      const result = await transitionContestLifecycleTx(tx, {
        runtimeTrainingId: id,
        actorUserId: userId,
        expectedStatus: training.status,
        targetStatus: 'finished',
        endTime: now,
      })
      return result?.runtime || training
    }
    const updated = await tx.training.update({
      where: { id }, data: { status: 'finished', endTime: now },
    })
    return updated
  })
  logger.info('training_finished_early', { action: 'trainings', metadata: { trainingId: id, userId } })
  return { training: finished, message: '比赛已结束' }
}

export async function deleteTraining(id: number, userId: string) {
  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  const isAdmin = await canManageTraining(userId, training)
  if (training.createdBy !== userId && !isAdmin) {
    fail(403, 'TRAINING_DELETE_DENIED', '只有创建者或管理员可以删除训练')
  }
  if (training.type === 'contest' && training.finalizedStandingId) {
    fail(409, 'FINALIZED_CONTEST_DELETE_FORBIDDEN', '已生成最终榜单的比赛必须永久保留；如需隐藏请使用归档能力')
  }
  const snapshotFiles = await prisma.trainingProblemContentSnapshot.findMany({
    where: { TrainingProblem: { trainingId: id }, snapshotFileId: { not: null } },
    select: { snapshotFileId: true },
  })
  if (training.type === 'contest') {
    const deleted = await prisma.$transaction(tx => deleteContestRuntimeTx(tx, id))
    if (deleted.conflict === 'missing') fail(404, 'TRAINING_NOT_FOUND', '比赛不存在')
    if (deleted.conflict === 'finalized') {
      fail(409, 'FINALIZED_CONTEST_DELETE_FORBIDDEN', '已生成最终榜单的比赛必须永久保留；如需隐藏请使用归档能力')
    }
  } else {
    await prisma.training.delete({ where: { id } })
  }
  await Promise.all(snapshotFiles.map(({ snapshotFileId }) => snapshotFileId
    ? fileService.softDelete(snapshotFileId).catch(error => {
        logger.warn('training_snapshot_file_cleanup_failed', {
          action: 'training', metadata: { trainingId: id, fileId: snapshotFileId, error: String(error) },
        })
      })
    : Promise.resolve()))
  logger.info('training_deleted', { action: 'trainings', metadata: { trainingId: id } })
}

export async function createMakeupHomework(id: number, userId: string, input: any) {
  const training = await prisma.training.findUnique({
    where: { id },
    include: {
      TrainingProblem: {
        orderBy: { orderIndex: 'asc' },
        include: { TestSetRevision: true, Problem: { include: { LatestTestSetRevision: true } } },
      },
    },
  })
  if (!training) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  if (!await canManageTraining(userId, training)) {
    fail(403, 'TRAINING_MANAGE_DENIED', '只有管理员可以创建补题作业')
  }
  const now = new Date()
  if (now <= training.endTime && training.status !== 'finished') {
    fail(400, 'TRAINING_NOT_FINISHED', '只有已结束的比赛/训练才能创建补题作业')
  }
  if (!input.endTime) fail(400, 'END_TIME_REQUIRED', '结束时间为必填')
  const startTime = input.startTime ? parseDate(input.startTime, '开始时间') : now
  const endTime = parseDate(input.endTime, '结束时间')
  if (endTime <= startTime) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  if (!training.organizationId) fail(422, 'ASSIGNMENT_SCOPE_REQUIRED', '补题作业必须属于学校组织')
  const creatorMembership = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId: training.organizationId, userId } },
    select: { id: true, status: true, memberRole: true },
  })
  if (!creatorMembership || creatorMembership.status !== 'active' || !['teacher', 'school_principal'].includes(creatorMembership.memberRole)) {
    fail(403, 'ASSIGNMENT_CREATE_DENIED', '需要当前学校的有效教师或负责人身份')
  }
  if (!training.TrainingProblem.length) fail(422, 'ASSIGNMENT_PROBLEMS_REQUIRED', '原活动没有可加入补题作业的题目')

  const assignment = await prisma.$transaction(async tx => {
    const created = await tx.assignment.create({ data: {
      teamId: training.teamId,
      organizationId: training.organizationId!,
      title: input.title || `${training.title} - 补题练习`,
      description: training.description,
      rosterMode: 'DYNAMIC',
      gradingPolicy: 'BEST_BEFORE_DUE',
      latePolicy: 'DISALLOW',
      correctionPolicy: 'NONE',
      solutionReleasePolicy: 'AFTER_RELEASE',
      openAt: startTime,
      dueAt: endTime,
      closeAt: endTime,
      createdByMembershipId: creatorMembership.id,
      eventSeq: 1,
    } })
    const seen = new Set<string>()
    for (const [index, problem] of training.TrainingProblem.entries()) {
      if (seen.has(problem.problemId)) continue
      seen.add(problem.problemId)
      const revision = problem.TestSetRevision || problem.Problem.LatestTestSetRevision
      if (!revision) fail(422, 'ASSIGNMENT_REVISION_REQUIRED', `题目 ${problem.titleSnapshot || problem.problemId} 没有可固定的 TestSet Revision`)
      const maxScore = problem.points && problem.points > 0 ? problem.points : 100
      await tx.assignmentProblem.create({ data: {
        assignmentId: created.id,
        problemId: problem.problemId,
        testSetRevisionId: revision.id,
        orderIndex: index,
        category: 'REQUIRED',
        required: true,
        maxScore,
        judgeMaxScore: judgeMaxScoreFromSnapshot(revision.judgeConfig, revision.mode),
        targetScore: maxScore,
        weight: 100,
        completionPolicy: revision.mode === 'acm' ? 'AC' : 'TARGET_SCORE',
        judgeConfigSnapshot: revision.judgeConfig,
        judgeConfigHash: revision.judgeConfigHash,
        settings: { sourceTrainingId: training.id, sourceTrainingProblemId: problem.id, alias: problem.alias },
      } })
    }
    await tx.assignmentEvent.create({ data: {
      assignmentId: created.id,
      seq: 1,
      type: 'assignment.created_from_activity',
      actorUserId: userId,
      payload: { sourceTrainingId: training.id, problemCount: seen.size },
    } })
    return created
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  logger.info('makeup_homework_created', {
    action: 'training',
    metadata: { sourceTrainingId: id, assignmentId: assignment.id, teamId: training.teamId },
  })
  return {
    id: assignment.id,
    title: assignment.title,
    type: 'assignment',
    sourceTrainingId: training.id,
    startTime: assignment.openAt.toISOString(),
    endTime: assignment.closeAt.toISOString(),
    teamId: assignment.teamId,
    organizationId: assignment.organizationId,
    problemCount: training.TrainingProblem.length,
  }
}
