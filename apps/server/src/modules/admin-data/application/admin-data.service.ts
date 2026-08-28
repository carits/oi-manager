import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../../../prisma'
import { createRejudgeBatch, rejudgeSubmissionWithRun } from '../../judge/application/judge-run.service'
import { currentJudgeCompletedWhere } from '../../judge/application/judge-read-projection'

export class AdminDataError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'AdminDataError'
  }
}

export async function rejudgeAllLocalSubmissions(requestedBy: string) {
  const submissions = await prisma.submission.findMany({
    where: {
      problemInternalId: { not: null }, submitMethod: { not: 'archive' },
      OR: [{ submitMethod: { in: ['local', 'demo_scenario'] } }, { oj: 'carits' }],
      AND: [currentJudgeCompletedWhere()],
    },
    select: { id: true },
  })
  const result = await createRejudgeBatch({
    submissionIds: submissions.map(item => item.id), requestedBy,
    scopeType: 'all_local', scopePayload: { source: 'admin-data' },
  })
  return {
    batchId: result.batch.id, requeued: result.queuedCount, skipped: result.skippedCount,
    message: `已将 ${result.queuedCount} 条本地提交重新加入评测队列`,
  }
}

export async function repairLegacyCaritsSubmissions(requestedBy: string) {
  const legacy = await prisma.submission.findMany({
    where: { oj: 'carits', problemInternalId: null, trainingProblemId: { not: null } },
    select: { id: true, trainingProblemId: true },
  })
  const ids = [...new Set(legacy.map(item => item.trainingProblemId).filter((id): id is string => Boolean(id)))]
  const trainingProblems = await prisma.trainingProblem.findMany({ where: { id: { in: ids } }, select: { id: true, problemId: true } })
  const problemIds = new Map(trainingProblems.map(item => [item.id, item.problemId]))
  let requeued = 0
  for (const submission of legacy) {
    const problemInternalId = submission.trainingProblemId ? problemIds.get(submission.trainingProblemId) : undefined
    if (!problemInternalId) continue
    await prisma.submission.update({ where: { id: submission.id }, data: { problemInternalId, submitMethod: 'local' } })
    if (await rejudgeSubmissionWithRun(submission.id, requestedBy)) requeued++
  }
  return { found: legacy.length, requeued, message: `已修复并重新加入 ${requeued} 条旧 Carits 提交` }
}

export async function getSubmissionMaintenanceStats() {
  const byResultPromise = prisma.$queryRaw<Array<{ result: string; count: number }>>`
    SELECT
      CASE
        WHEN run.status = 'QUEUED' THEN 'queuing'
        WHEN run.status = 'RUNNING' THEN 'judging'
        WHEN run.status = 'CANCELLED' THEN COALESCE(run.result, 'judge_failed')
        WHEN run.status = 'FINALIZED' THEN COALESCE(run.result, 'unknown_error')
        ELSE submission.result
      END AS result,
      COUNT(*)::integer AS count
    FROM "Submission" submission
    LEFT JOIN "JudgeRun" run ON run.id = submission."currentJudgeRunId"
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 20
  `
  const [total, carits, caritsNoRemoteId, trainingSubmissions, byResult] = await Promise.all([
    prisma.submission.count(),
    prisma.submission.count({ where: { oj: 'carits' } }),
    prisma.submission.count({ where: { oj: 'carits', ojRemoteId: null } }),
    prisma.submission.count({ where: { submitScope: { in: ['training', 'contest'] } } }),
    byResultPromise,
  ])
  return { total, carits, caritsNoRemoteId, trainingSubmissions, byResult }
}

export async function fixCaritsRemoteIds() {
  const submissions = await prisma.submission.findMany({ where: { oj: 'carits', ojRemoteId: null }, select: { id: true } })
  if (!submissions.length) return { updated: 0, message: '无需修复' }
  let updated = 0
  for (const submission of submissions) {
    await prisma.submission.update({ where: { id: submission.id }, data: { ojRemoteId: String(submission.id) } })
    updated++
  }
  return { updated, message: `已修复 ${updated} 条记录` }
}

export async function fixHduMemory(defaultKB: unknown) {
  const memoryUsed = Number(defaultKB ?? 1280)
  if (!Number.isFinite(memoryUsed) || memoryUsed < 0) throw new AdminDataError(400, 'defaultKB 必须是非负数')
  const submissions = await prisma.submission.findMany({ where: { oj: 'hdu', memoryUsed: null, result: { not: 'queuing' } }, select: { id: true } })
  if (!submissions.length) return { updated: 0, message: '无需修复' }
  const result = await prisma.submission.updateMany({ where: { id: { in: submissions.map(item => item.id) } }, data: { memoryUsed } })
  return { updated: result.count, message: `已修复 ${result.count} 条记录` }
}

export async function cleanTrainingSubmissions(trainingId: unknown) {
  const id = Number(trainingId)
  if (!Number.isInteger(id) || id <= 0) throw new AdminDataError(400, '缺少 trainingId')
  const result = await prisma.submission.deleteMany({ where: { submitScope: { in: ['training', 'contest'] }, trainingId: id } })
  return { deleted: result.count, message: `已删除 ${result.count} 条提交` }
}

export async function resetUserPassword(userId: unknown, newPassword: unknown) {
  if (typeof userId !== 'string' || typeof newPassword !== 'string' || !userId || !newPassword) {
    throw new AdminDataError(400, '缺少 userId 或 newPassword')
  }
  if (newPassword.length < 6) throw new AdminDataError(400, '密码至少 6 位')
  const user = await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, 10) }, select: { id: true, username: true } })
  return { userId: user.id, username: user.username, message: '密码已重置' }
}

export async function backfillTrainingParticipants(trainingId: unknown) {
  const parsedId = trainingId === undefined || trainingId === null || trainingId === '' ? undefined : Number(trainingId)
  if (parsedId !== undefined && (!Number.isInteger(parsedId) || parsedId <= 0)) throw new AdminDataError(400, 'trainingId 无效')
  const trainings = await prisma.training.findMany({ where: parsedId ? { id: parsedId } : {}, select: { id: true, teamId: true, title: true } })
  if (!trainings.length) throw new AdminDataError(404, '没有找到训练')
  let totalCreated = 0
  const details: Array<{ trainingId: number; title: string; created: number }> = []
  for (const training of trainings) {
    if (!training.teamId) {
      details.push({ trainingId: training.id, title: training.title, created: 0 })
      continue
    }
    const members = await prisma.teamMember.findMany({ where: { teamId: training.teamId, userType: 'student', status: 'active' }, select: { userId: true } })
    if (!members.length) {
      details.push({ trainingId: training.id, title: training.title, created: 0 })
      continue
    }
    const result = await prisma.trainingParticipant.createMany({
      data: members.map(member => ({ id: crypto.randomUUID(), trainingId: training.id, userId: member.userId, userType: 'student' })),
      skipDuplicates: true,
    })
    totalCreated += result.count
    details.push({ trainingId: training.id, title: training.title, created: result.count })
  }
  return { totalTrainings: trainings.length, totalCreated, details }
}

export async function fixSubmissionVisibility() {
  const trainingResult = await prisma.submission.updateMany({ where: { submitScope: 'training', isGlobalVisible: false }, data: { isGlobalVisible: true } })
  const contests = await prisma.training.findMany({ where: { type: 'contest', status: 'finished' }, select: { id: true } })
  const contestResult = contests.length ? await prisma.submission.updateMany({
    where: { submitScope: 'contest', isGlobalVisible: false, contestId: { in: contests.map(item => item.id) } },
    data: { isGlobalVisible: true },
  }) : { count: 0 }
  return {
    trainingUpdated: trainingResult.count, contestUpdated: contestResult.count,
    totalUpdated: trainingResult.count + contestResult.count,
    message: `已修复 ${trainingResult.count} 条训练提交，${contestResult.count} 条比赛提交`,
  }
}
