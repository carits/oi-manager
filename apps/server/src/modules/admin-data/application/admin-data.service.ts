import bcrypt from 'bcryptjs'
import { prisma } from '../../../prisma'
import { createRejudgeBatch } from '../../judge/application/judge-run.service'
import { currentJudgeCompletedWhere } from '../../judge/application/judge-read-projection'
import { listFinishedContestIds } from '../../contest/contest-query.facade'

export class AdminDataError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'AdminDataError'
  }
}

export async function rejudgeAllLocalSubmissions(requestedBy: string) {
  const submissions = await prisma.submission.findMany({
    where: {
      problemInternalId: { not: null },
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

export async function getSubmissionMaintenanceStats() {
  const byResultPromise = prisma.$queryRaw<Array<{ result: string; count: number }>>`
    SELECT
      CASE
        WHEN run.status = 'QUEUED' THEN 'queuing'
        WHEN run.status = 'RUNNING' THEN 'judging'
        WHEN run.status = 'CANCELLED' THEN COALESCE(run.result, 'judge_failed')
        WHEN run.status = 'FINALIZED' THEN COALESCE(run.result, 'unknown_error')
        ELSE 'system_error'
      END AS result,
      COUNT(*)::integer AS count
    FROM "Submission" submission
    JOIN "JudgeRun" run ON run.id = submission."currentJudgeRunId"
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 20
  `
  const [total, carits, caritsNoRemoteId, trainingSubmissions, byResult] = await Promise.all([
    prisma.submission.count(),
    prisma.submission.count({ where: { oj: 'carits' } }),
    prisma.submission.count({ where: { oj: 'carits', ojRemoteId: null } }),
    prisma.submission.count({ where: { submitScope: 'contest' } }),
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
  const runs = await prisma.judgeRun.findMany({
    where: { status: 'FINALIZED', memoryUsed: null, Submission: { oj: 'hdu' } },
    select: { id: true },
  })
  if (!runs.length) return { updated: 0, message: '\u65e0\u9700\u4fee\u590d' }
  const result = await prisma.judgeRun.updateMany({ where: { id: { in: runs.map(item => item.id) } }, data: { memoryUsed } })
  return { updated: result.count, message: '\u5df2\u4fee\u590d ' + result.count + ' \u6761\u8bb0\u5f55' }

}

export async function resetUserPassword(userId: unknown, newPassword: unknown) {
  if (typeof userId !== 'string' || typeof newPassword !== 'string' || !userId || !newPassword) {
    throw new AdminDataError(400, '缺少 userId 或 newPassword')
  }
  if (newPassword.length < 6) throw new AdminDataError(400, '密码至少 6 位')
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), sessionVersion: { increment: 1 } },
    select: { id: true, username: true },
  })
  return { userId: user.id, username: user.username, message: '密码已重置' }
}

export async function fixSubmissionVisibility() {
  const contestIds = await listFinishedContestIds()
  const contestResult = contestIds.length ? await prisma.submission.updateMany({
    where: { submitScope: 'contest', isGlobalVisible: false, canonicalContestId: { in: contestIds } },
    data: { isGlobalVisible: true },
  }) : { count: 0 }
  return {
    contestUpdated: contestResult.count,
    totalUpdated: contestResult.count,
    message: `已修复 ${contestResult.count} 条比赛提交`,
  }
}
