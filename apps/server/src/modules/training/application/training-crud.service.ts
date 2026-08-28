import crypto from 'node:crypto'
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
  if (!title || !startTime || !endTime) {
    fail(400, 'TRAINING_FIELDS_REQUIRED', '标题、开始时间、结束时间为必填')
  }
  const start = parseDate(startTime, '开始时间')
  const end = parseDate(endTime, '结束时间')
  if (end <= start) fail(400, 'INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  if (start <= new Date()) fail(400, 'START_TIME_IN_PAST', '开始时间不能早于当前时间')

  const training = await prisma.training.create({
    data: {
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
      type: type || 'training',
      updatedAt: new Date(),
    },
  })
  logger.info('training_created', {
    action: 'trainings', metadata: { trainingId: training.id, teamId: params.teamId },
  })
  return training
}

export async function synchronizeTrainingStatus(training: any, now: Date) {
  const computedStatus = getComputedTrainingStatus(training, now)
  if (computedStatus === training.status) return computedStatus
  const visibleCount = await prisma.$transaction(async tx => {
    await tx.training.update({ where: { id: training.id }, data: { status: computedStatus } })
    if (computedStatus !== 'finished' || training.type !== 'contest') return 0
    const result = await tx.submission.updateMany({
      where: {
        submitScope: 'contest', contestId: training.id, isGlobalVisible: false,
      },
      data: { isGlobalVisible: true },
    })
    return result.count
  })
  if (computedStatus === 'finished' && training.type === 'contest') {
    logger.info('contest_submissions_visible', {
      action: 'training',
      metadata: {
        contestId: training.id,
        updatedCount: visibleCount,
        message: '比赛结束，提交记录已公开',
      },
    })
  }
  return computedStatus
}

export async function getTrainingDetail(id: number, userId: string) {
  const training = await prisma.training.findUnique({
    where: { id },
    include: { _count: { select: { TrainingParticipant: true, TrainingProblem: true } } },
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

  const updated = await prisma.training.update({
    where: { id },
    data: {
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
    },
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
  return prisma.training.update({ where: { id }, data: { endTime: end } })
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
  const started = await prisma.training.update({
    where: { id }, data: { status: 'ongoing', startTime: now },
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
    const updated = await tx.training.update({
      where: { id }, data: { status: 'finished', endTime: now },
    })
    if (training.type === 'contest') {
      await tx.submission.updateMany({
        where: { submitScope: 'contest', contestId: id, isGlobalVisible: false },
        data: { isGlobalVisible: true },
      })
    }
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
  const snapshotFiles = await prisma.trainingProblemContentSnapshot.findMany({
    where: { TrainingProblem: { trainingId: id }, snapshotFileId: { not: null } },
    select: { snapshotFileId: true },
  })
  await prisma.training.delete({ where: { id } })
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
        include: { ContentSnapshot: { orderBy: [{ revision: 'desc' }, { selectedAt: 'desc' }] } },
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

  const copiedFileIds: string[] = []
  let makeupTraining: any = null
  try {
    makeupTraining = await prisma.training.create({
      data: {
        teamId: training.teamId,
        organizationId: training.organizationId,
        scope: training.scope,
        title: input.title || `${training.title} - 补题练习`,
        description: training.description,
        format: training.format,
        startTime,
        endTime,
        status: startTime <= now ? 'ongoing' : 'upcoming',
        createdBy: userId,
        problemIdVisible: true,
        solutionVisible: true,
        includeAdminInRanking: false,
        type: 'homework',
        sourceTrainingId: id,
      },
    })

    for (const problem of training.TrainingProblem) {
      const trainingProblemId = `makeup-${makeupTraining.id}-${problem.orderIndex}-${crypto.randomUUID()}`
      await prisma.trainingProblem.create({
        data: {
          id: trainingProblemId,
          trainingId: makeupTraining.id,
          problemId: problem.problemId,
          alias: problem.alias,
          orderIndex: problem.orderIndex,
          points: problem.points,
          titleSnapshot: problem.titleSnapshot,
          statementSnapshot: problem.statementSnapshot,
          statementsSnapshotJson: problem.statementsSnapshotJson,
          timeLimitSnapshot: problem.timeLimitSnapshot,
          memoryLimitSnapshot: problem.memoryLimitSnapshot,
          judgeConfigSnapshot: problem.judgeConfigSnapshot,
          testSetRevisionId: problem.testSetRevisionId,
          allowedLanguagesSnapshot: problem.allowedLanguagesSnapshot,
          sourcePlatformSnapshot: problem.sourcePlatformSnapshot,
          sourceProblemIdSnapshot: problem.sourceProblemIdSnapshot,
          sourceUrlSnapshot: problem.sourceUrlSnapshot,
          snapshotCreatedAt: problem.snapshotCreatedAt ? new Date(problem.snapshotCreatedAt) : new Date(),
          dataVersion: problem.dataVersion || '1',
        },
      })
      for (const kind of ['statement', 'solution'] as const) {
        const source = problem.ContentSnapshot.find(snapshot => snapshot.kind === kind)
        if (!source) continue
        const snapshotId = crypto.randomUUID()
        let snapshotFileId: string | null = null
        if (source.snapshotFileId) {
          const file = await fileService.download(source.snapshotFileId)
          const copied = await fileService.upload(file.buffer, {
            category: 'pdf',
            ownerType: 'training_content',
            ownerId: snapshotId,
            originalName: file.originalName,
            mimeType: file.mimeType,
            isPublic: false,
          })
          snapshotFileId = copied.id
          copiedFileIds.push(copied.id)
        }
        await prisma.trainingProblemContentSnapshot.create({
          data: {
            id: snapshotId,
            trainingProblemId,
            kind: source.kind,
            revision: 1,
            sourceType: source.sourceType,
            sourceContentId: source.sourceContentId,
            sourceRevision: source.sourceRevision,
            format: source.format,
            language: source.language,
            title: source.title,
            content: source.content,
            snapshotFileId,
            fileName: source.fileName,
            authorUserId: source.authorUserId,
            authorUsernameSnapshot: source.authorUsernameSnapshot,
            selectedBy: userId,
          },
        })
      }
    }
  } catch (error) {
    if (makeupTraining) await prisma.training.delete({ where: { id: makeupTraining.id } }).catch(() => {})
    await Promise.all(copiedFileIds.map(fileId => fileService.softDelete(fileId).catch(() => {})))
    throw error
  }

  logger.info('makeup_homework_created', {
    action: 'training',
    metadata: { sourceTrainingId: id, makeupTrainingId: makeupTraining.id, teamId: training.teamId },
  })
  return {
    id: makeupTraining.id,
    title: makeupTraining.title,
    type: makeupTraining.type,
    sourceTrainingId: makeupTraining.sourceTrainingId,
    startTime: makeupTraining.startTime.toISOString(),
    endTime: makeupTraining.endTime.toISOString(),
    format: makeupTraining.format,
    teamId: makeupTraining.teamId,
    organizationId: makeupTraining.organizationId,
    problemCount: training.TrainingProblem.length,
  }
}
