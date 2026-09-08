import crypto from 'node:crypto'
import { prisma } from '../../../prisma'

async function loadLegacyTrainings(db: typeof prisma | any) {
  return db.training.findMany({
    where: { type: 'training' },
    orderBy: { id: 'asc' },
    include: {
      TrainingProblem: { orderBy: { orderIndex: 'asc' }, include: { Problem: { select: { latestTestSetRevisionId: true } } } },
      TrainingParticipant: { orderBy: { joinedAt: 'asc' } },
      TrainingUserProblemStatus: true,
    },
  })
}

function stableHash(rows: any[]) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => ({
    id: row.id, updatedAt: row.updatedAt, type: row.type, teamId: row.teamId, organizationId: row.organizationId,
    problems: row.TrainingProblem.map((problem: any) => [problem.id, problem.orderIndex, problem.testSetRevisionId, problem.Problem.latestTestSetRevisionId]),
    participants: row.TrainingParticipant.map((participant: any) => [participant.userId, participant.userType, participant.joinedAt]),
    progress: row.TrainingUserProblemStatus.map((item: any) => [item.userId, item.trainingProblemId, item.bestScore, item.bestResult, item.attemptCount, item.updatedAt]),
  })))).digest('hex')
}

function reasonFor(row: any) {
  if (Boolean(row.teamId) === Boolean(row.organizationId)) return '训练必须且只能属于一个团队或学校'
  const missing = row.TrainingProblem.filter((problem: any) => !problem.testSetRevisionId && !problem.Problem.latestTestSetRevisionId)
  if (missing.length) return `${missing.length} 道题没有可固定的 TestSet Revision`
  return null
}

function mappedStatus(row: any, now = new Date()) {
  if (row.endTime <= now || row.status === 'finished') return 'ENDED'
  if (row.startTime <= now || row.status === 'ongoing') return 'RUNNING'
  return 'SCHEDULED'
}

export async function inspectTrainingEngineMigration() {
  const rows = await loadLegacyTrainings(prisma)
  const existing = await prisma.trainingSession.findMany({ where: { legacyTrainingId: { in: rows.map((row: any) => row.id) } }, select: { legacyTrainingId: true } })
  const migrated = new Set(existing.map(item => item.legacyTrainingId))
  const issues = rows.map((row: any) => ({ trainingId: row.id, title: row.title, reason: reasonFor(row) })).filter((item: any) => item.reason)
  return {
    reportHash: stableHash(rows),
    total: rows.length,
    alreadyMigrated: rows.filter((row: any) => migrated.has(row.id)).length,
    migratable: rows.filter((row: any) => !migrated.has(row.id) && !reasonFor(row)).length,
    blocked: issues.length,
    issues: issues.slice(0, 100),
    issuesOmitted: Math.max(0, issues.length - 100),
  }
}

export async function applyTrainingEngineMigration(expectedReportHash: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('training-engine-migration', 0)) IS NULL AS locked`
    const rows = await loadLegacyTrainings(tx)
    const currentHash = stableHash(rows)
    if (!expectedReportHash || currentHash !== expectedReportHash) throw new Error('迁移检查结果已过期，请重新执行 check')
    let migrated = 0, submissionsLinked = 0
    const blocked: Array<{ trainingId: number; reason: string }> = []
    for (const row of rows) {
      if (await tx.trainingSession.findUnique({ where: { legacyTrainingId: row.id }, select: { id: true } })) continue
      const reason = reasonFor(row)
      if (reason) { blocked.push({ trainingId: row.id, reason }); continue }
      const status = mappedStatus(row) as any
      const session = await tx.trainingSession.create({ data: {
        legacyTrainingId: row.id, title: row.title, description: row.description, sessionType: row.format === 'acm' ? 'ACM' : 'OI',
        status, teamId: row.teamId, organizationId: row.organizationId, createdBy: row.createdBy,
        scheduledStartAt: row.startTime, startedAt: status === 'RUNNING' || status === 'ENDED' ? row.startTime : null,
        endedAt: status === 'ENDED' ? row.endTime : null, rankingMode: row.format === 'acm' ? 'ACM_RANKING' : 'SCORE',
        peerVisibility: 'PROGRESS', joinMode: 'FROM_BEGINNING', settings: { migratedFromLegacyTrainingId: row.id },
      } })
      const stage = await tx.trainingSessionStage.create({ data: {
        sessionId: session.id, name: '完整训练', orderIndex: 0, mode: 'FREE', advanceMode: 'TIME',
        durationSeconds: Math.max(60, Math.floor((row.endTime.getTime() - row.startTime.getTime()) / 1000)),
        problemAccessMode: 'ALL', submissionMode: 'ENABLED', status: status === 'ENDED' ? 'completed' : status === 'RUNNING' ? 'running' : 'pending',
        startedAt: status === 'RUNNING' || status === 'ENDED' ? row.startTime : null, endedAt: status === 'ENDED' ? row.endTime : null,
      } })
      await tx.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
      const stageProblems = new Map<string, string>()
      for (const problem of row.TrainingProblem) {
        const revisionId = problem.testSetRevisionId || problem.Problem.latestTestSetRevisionId!
        const created = await tx.trainingSessionStageProblem.create({ data: {
          stageId: stage.id, problemId: problem.problemId, testSetRevisionId: revisionId, alias: problem.alias,
          orderIndex: problem.orderIndex, targetScore: problem.points || (row.format === 'acm' ? 100 : null), judgeConfigProjection: problem.judgeConfigSnapshot,
        } })
        stageProblems.set(problem.id, created.id)
      }
      const participantByUser = new Map<string, string>()
      for (const old of row.TrainingParticipant) {
        if (participantByUser.has(old.userId)) continue
        const participant = await tx.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: old.userId, joinedAt: old.joinedAt, currentStageId: stage.id } })
        participantByUser.set(old.userId, participant.id)
      }
      for (const old of row.TrainingUserProblemStatus) {
        let participantId = participantByUser.get(old.userId)
        if (!participantId) {
          const participant = await tx.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: old.userId, currentStageId: stage.id } })
          participantId = participant.id; participantByUser.set(old.userId, participant.id)
        }
        const stageProblemId = stageProblems.get(old.trainingProblemId)
        if (!stageProblemId) continue
        const accepted = Boolean(old.acAt) || ['accepted', 'ac'].includes(String(old.bestResult || '').toLowerCase())
        await tx.trainingSessionProblemProgress.create({ data: {
          participantId, stageProblemId, status: accepted ? 'COMPLETED' : old.attemptCount ? 'WORKING' : 'NOT_STARTED',
          attemptCount: old.attemptCount, bestScore: old.bestScore, bestVerdict: old.bestResult, acAt: old.acAt,
          lastSubmissionAt: old.attemptCount ? old.updatedAt : null, lastProgressAt: old.updatedAt,
        } })
      }
      for (const [oldProblemId, stageProblemId] of stageProblems) {
        const result = await tx.submission.updateMany({ where: { trainingId: row.id, trainingProblemId: oldProblemId, submitScope: 'training' }, data: { trainingSessionId: session.id, trainingStageProblemId: stageProblemId } })
        submissionsLinked += result.count
      }
      migrated++
    }
    return { reportHash: currentHash, migrated, submissionsLinked, blocked }
  }, { isolationLevel: 'Serializable', maxWait: 15_000, timeout: 120_000 })
}
