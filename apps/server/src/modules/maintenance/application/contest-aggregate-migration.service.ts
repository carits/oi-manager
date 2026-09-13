import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'

async function loadRuntimeContests(db: typeof prisma | Prisma.TransactionClient | any) {
  return db.training.findMany({
    where: { type: 'contest' }, orderBy: { id: 'asc' },
    include: {
      TrainingProblem: { orderBy: { orderIndex: 'asc' }, include: { Problem: true, TestSetRevision: true } },
      ContestAggregate: { select: { id: true, statusRevision: true } },
    },
  })
}

function reportHash(rows: any[]) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => ({
    id: row.id, updatedAt: row.updatedAt, type: row.type, title: row.title, format: row.format,
    startTime: row.startTime, endTime: row.endTime, status: row.status,
    problems: row.TrainingProblem.map((problem: any) => [problem.id, problem.problemId, problem.orderIndex, problem.testSetRevisionId, problem.updatedAt]),
  })))).digest('hex')
}

function issue(row: any) {
  if (row.TrainingProblem.some((problem: any) => !problem.testSetRevisionId || !problem.TestSetRevision)) return '至少一道题没有固定 TestSet Revision'
  if (row.TrainingProblem.some((problem: any) => problem.TestSetRevision.problemId !== problem.problemId)) return '题目与固定 TestSet Revision 不匹配'
  return null
}

async function inspectCanonicalRatingIdentities(db: typeof prisma | Prisma.TransactionClient | any) {
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "TrainingRatingConfig") AS configs,
      (SELECT COUNT(*) FROM "ContestStandingSnapshot") AS snapshots,
      (SELECT COUNT(*) FROM "RatingBatch") AS batches,
      (SELECT COUNT(*) FROM (
        SELECT c."id" FROM "TrainingRatingConfig" c LEFT JOIN "Contest" x ON x."id" = c."contestId" WHERE x."id" IS NULL
        UNION ALL
        SELECT s."id" FROM "ContestStandingSnapshot" s LEFT JOIN "Contest" x ON x."id" = s."contestId" WHERE x."id" IS NULL
        UNION ALL
        SELECT b."id" FROM "RatingBatch" b LEFT JOIN "Contest" x ON x."id" = b."contestId" WHERE x."id" IS NULL
      ) missing_rows) AS missing,
      0::bigint AS mismatched
  `) as Array<{ configs: bigint; snapshots: bigint; batches: bigint; missing: bigint; mismatched: bigint }>
  const [row] = rows
  return {
    configs: Number(row?.configs || 0), snapshots: Number(row?.snapshots || 0),
    batches: Number(row?.batches || 0), missing: Number(row?.missing || 0),
    mismatched: Number(row?.mismatched || 0),
  }
}

async function inspectCanonicalSubmissionIdentities(db: typeof prisma | Prisma.TransactionClient | any) {
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "Submission" WHERE "submitScope" = 'contest') AS submissions,
      (SELECT COUNT(*) FROM "ContestUserProblemStatus") AS statuses,
      (SELECT COUNT(*) FROM "ContestRecord" r JOIN "Training" t ON t."id" = r."trainingId" WHERE t."type" = 'contest') AS records,
      (SELECT COUNT(*) FROM (
        SELECT s."id"::text FROM "Submission" s
          WHERE s."submitScope" = 'contest'
            AND (s."canonicalContestId" IS NULL OR s."canonicalContestProblemId" IS NULL)
        UNION ALL
        SELECT s."id" FROM "ContestUserProblemStatus" s
          WHERE s."canonicalContestId" IS NULL OR s."canonicalContestProblemId" IS NULL
        UNION ALL
        SELECT r."id" FROM "ContestRecord" r JOIN "Training" t ON t."id" = r."trainingId"
          WHERE t."type" = 'contest' AND r."canonicalContestId" IS NULL
      ) missing_rows) AS missing,
      (SELECT COUNT(*) FROM (
        SELECT s."id"::text FROM "Submission" s
          JOIN "Contest" c ON c."id" = s."canonicalContestId"
          JOIN "ContestProblem" p ON p."id" = s."canonicalContestProblemId"
          WHERE s."submitScope" <> 'contest'
             OR c."runtimeTrainingId" IS DISTINCT FROM COALESCE(s."contestId", s."trainingId")
             OR p."contestId" IS DISTINCT FROM c."id"
             OR p."runtimeTrainingProblemId" IS DISTINCT FROM COALESCE(s."contestProblemId", s."trainingProblemId")
        UNION ALL
        SELECT s."id" FROM "ContestUserProblemStatus" s
          JOIN "Contest" c ON c."id" = s."canonicalContestId"
          JOIN "ContestProblem" p ON p."id" = s."canonicalContestProblemId"
          WHERE (s."contestId" IS NOT NULL AND c."runtimeTrainingId" IS DISTINCT FROM s."contestId")
             OR p."contestId" IS DISTINCT FROM c."id"
             OR (s."contestProblemId" IS NOT NULL AND p."runtimeTrainingProblemId" IS DISTINCT FROM s."contestProblemId")
        UNION ALL
        SELECT r."id" FROM "ContestRecord" r
          JOIN "Training" t ON t."id" = r."trainingId"
          LEFT JOIN "Contest" c ON c."id" = r."canonicalContestId"
          WHERE (t."type" = 'contest' AND c."runtimeTrainingId" IS DISTINCT FROM r."trainingId")
             OR (t."type" <> 'contest' AND r."canonicalContestId" IS NOT NULL)
      ) mismatched_rows) AS mismatched
  `) as Array<{ submissions: bigint; statuses: bigint; records: bigint; missing: bigint; mismatched: bigint }>
  const [row] = rows
  return {
    submissions: Number(row?.submissions || 0), statuses: Number(row?.statuses || 0),
    records: Number(row?.records || 0), missing: Number(row?.missing || 0),
    mismatched: Number(row?.mismatched || 0),
  }
}

export async function inspectContestAggregateMigration() {
  const [rows, ratingIdentity, submissionIdentity] = await Promise.all([
    loadRuntimeContests(prisma),
    inspectCanonicalRatingIdentities(prisma),
    inspectCanonicalSubmissionIdentities(prisma),
  ])
  const issues = rows.map((row: any) => ({ trainingId: row.id, title: row.title, reason: issue(row) })).filter((item: any) => item.reason)
  return {
    reportHash: reportHash(rows), total: rows.length,
    alreadyMapped: rows.filter((row: any) => row.ContestAggregate).length,
    migratable: rows.filter((row: any) => !row.ContestAggregate && !issue(row)).length,
    blocked: issues.length, issues: issues.slice(0, 100), issuesOmitted: Math.max(0, issues.length - 100),
    ratingIdentity, submissionIdentity,
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
        id: crypto.randomUUID(), runtimeTrainingId: row.id, createdBy: row.createdBy,
        organizationId: row.organizationId,
        title: row.title, description: row.description, contestDate: row.startTime,
        startAt: row.startTime, endAt: row.endTime, format: row.format, status: row.status,
        type: 'judged', teamId: row.teamId, countRating: false,
        scope: row.scope,
        problemIdVisible: row.problemIdVisible,
        solutionVisible: row.solutionVisible,
        includeAdminInRanking: row.includeAdminInRanking,
        finalizationStatus: row.finalizationStatus,
        finalizedStandingId: row.finalizedStandingId,
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
    return {
      total: rows.length,
      created,
      blocked,
      ratingIdentity: await inspectCanonicalRatingIdentities(tx),
      submissionIdentity: await inspectCanonicalSubmissionIdentities(tx),
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
