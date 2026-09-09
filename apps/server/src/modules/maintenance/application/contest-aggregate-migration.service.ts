import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'

async function loadRuntimeContests(db: typeof prisma | Prisma.TransactionClient | any) {
  return db.training.findMany({
    where: { type: 'contest' }, orderBy: { id: 'asc' },
    include: {
      TrainingProblem: { orderBy: { orderIndex: 'asc' }, include: { Problem: true, TestSetRevision: true } },
      RatingConfig: { select: { scope: true, track: true, rulesHash: true } },
      ContestAggregate: { select: { id: true, statusRevision: true } },
    },
  })
}

function reportHash(rows: any[]) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => ({
    id: row.id, updatedAt: row.updatedAt, type: row.type, title: row.title, format: row.format,
    startTime: row.startTime, endTime: row.endTime, status: row.status,
    problems: row.TrainingProblem.map((problem: any) => [problem.id, problem.problemId, problem.orderIndex, problem.testSetRevisionId, problem.updatedAt]),
    rating: row.RatingConfig ? [row.RatingConfig.scope, row.RatingConfig.track, row.RatingConfig.rulesHash] : null,
  })))).digest('hex')
}

function issue(row: any) {
  if (row.TrainingProblem.some((problem: any) => !problem.testSetRevisionId || !problem.TestSetRevision)) return '至少一道题没有固定 TestSet Revision'
  if (row.TrainingProblem.some((problem: any) => problem.TestSetRevision.problemId !== problem.problemId)) return '题目与固定 TestSet Revision 不匹配'
  return null
}

export async function inspectContestAggregateMigration() {
  const rows = await loadRuntimeContests(prisma)
  const issues = rows.map((row: any) => ({ trainingId: row.id, title: row.title, reason: issue(row) })).filter((item: any) => item.reason)
  return {
    reportHash: reportHash(rows), total: rows.length,
    alreadyMapped: rows.filter((row: any) => row.ContestAggregate).length,
    migratable: rows.filter((row: any) => !row.ContestAggregate && !issue(row)).length,
    blocked: issues.length, issues: issues.slice(0, 100), issuesOmitted: Math.max(0, issues.length - 100),
  }
}

export async function applyContestAggregateMigration(expectedReportHash: string, actorUserId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('contest-aggregate-migration-v1', 0)) IS NULL AS locked`
    const rows = await loadRuntimeContests(tx)
    if (!expectedReportHash || expectedReportHash !== reportHash(rows)) throw new Error('迁移检查结果已过期，请重新执行 check')
    let created = 0
    const blocked: Array<{ trainingId: number; reason: string }> = []
    for (const row of rows) {
      if (row.ContestAggregate) continue
      const reason = issue(row)
      if (reason) { blocked.push({ trainingId: row.id, reason }); continue }
      const contest = await tx.contest.create({ data: {
        id: crypto.randomUUID(), runtimeTrainingId: row.id, organizationId: row.organizationId,
        title: row.title, description: row.description, contestDate: row.startTime,
        startAt: row.startTime, endAt: row.endTime, format: row.format, status: row.status,
        type: 'judged', teamId: row.teamId, countRating: Boolean(row.RatingConfig && row.RatingConfig.scope !== 'NONE'),
        scope: row.scope,
      } })
      for (const problem of row.TrainingProblem) {
        await tx.contestProblem.create({ data: {
          id: crypto.randomUUID(), contestId: contest.id, runtimeTrainingProblemId: problem.id,
          canonicalProblemId: problem.problemId, testSetRevisionId: problem.testSetRevisionId,
          orderIndex: problem.orderIndex, title: problem.titleSnapshot || problem.Problem.title,
          ojName: problem.sourcePlatformSnapshot || problem.Problem.platform,
          problemId: problem.sourceProblemIdSnapshot || problem.Problem.problemId,
          difficulty: problem.Problem.difficulty, points: problem.points,
          statementType: problem.statementSnapshot ? 'snapshot' : 'none', solutionVisible: row.solutionVisible,
        } })
      }
      created += 1
    }
    await tx.platformAuditLog.create({ data: {
      id: crypto.randomUUID(), actorUserId, action: 'contest_aggregate_migration_applied',
      targetType: 'contest_aggregate', targetId: 'runtime-training-v1',
      metadata: { reportHash: expectedReportHash, created, blocked },
    } })
    return { total: rows.length, created, blocked }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
