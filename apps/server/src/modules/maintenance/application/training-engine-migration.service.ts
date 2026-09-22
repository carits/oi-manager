import crypto from 'node:crypto'
import { prisma } from '../../../prisma'

async function loadLegacyTrainings(db: typeof prisma | any) {
  return db.training.findMany({
    where: { type: 'training' },
    orderBy: { id: 'asc' },
    include: {
      TrainingProblem: { orderBy: { orderIndex: 'asc' }, include: { Problem: { select: {
        title: true,
        latestTestSetRevisionId: true,
        ProblemStatement: {
          where: { isVisible: true },
          orderBy: [{ type: 'asc' }, { format: 'asc' }, { language: 'asc' }],
          select: { type: true, format: true, language: true, content: true, fileUrl: true },
        },
      } } } },
      TrainingParticipant: { orderBy: { joinedAt: 'asc' } },
      TrainingUserProblemStatus: true,
    },
  })
}

function stableHash(rows: any[], validUserIds: Set<string>) {
  return crypto.createHash('sha256').update(JSON.stringify({ rows: rows.map(row => ({
    id: row.id, updatedAt: row.updatedAt, type: row.type, teamId: row.teamId, organizationId: row.organizationId,
    problems: row.TrainingProblem.map((problem: any) => [
      problem.id,
      problem.orderIndex,
      problem.testSetRevisionId,
      problem.Problem.latestTestSetRevisionId,
      problem.Problem.title,
      problem.Problem.ProblemStatement,
    ]),
    participants: row.TrainingParticipant.map((participant: any) => [participant.userId, participant.userType, participant.joinedAt]),
    progress: row.TrainingUserProblemStatus.map((item: any) => [item.userId, item.trainingProblemId, item.bestScore, item.bestResult, item.attemptCount, item.updatedAt]),
  })), users: [...validUserIds].sort() })).digest('hex')
}

function reasonFor(row: any, validUserIds: Set<string>) {
  if (Boolean(row.teamId) === Boolean(row.organizationId)) return '训练必须且只能属于一个团队或学校'
  const missing = row.TrainingProblem.filter((problem: any) => !problem.testSetRevisionId && !problem.Problem.latestTestSetRevisionId)
  if (missing.length) return `${missing.length} 道题没有可固定的 TestSet Revision`
  const orphanUsers = [...new Set<string>([...row.TrainingParticipant.map((item: any) => item.userId), ...row.TrainingUserProblemStatus.map((item: any) => item.userId)])].filter(id => !validUserIds.has(id))
  if (orphanUsers.length) return `${orphanUsers.length} 个历史参与者已无有效 User 账号`
  return null
}

function mappedStatus(row: any, now = new Date()) {
  if (row.endTime <= now || row.status === 'finished') return 'ENDED'
  if (row.startTime <= now || row.status === 'ongoing') return 'RUNNING'
  return 'SCHEDULED'
}

async function snapshotMigratedStage(tx: any, stageId: string) {
  const stage = await tx.trainingSessionStage.findUniqueOrThrow({
    where: { id: stageId },
    include: {
      Problems: {
        orderBy: { orderIndex: 'asc' },
        include: {
          Plans: { orderBy: { orderIndex: 'asc' } },
          TestSetRevision: { select: { id: true, revisionNumber: true, judgeConfigHash: true, mode: true } },
        },
      },
      Groups: {
        orderBy: { orderIndex: 'asc' },
        include: {
          Assignments: { orderBy: { participantId: 'asc' } },
          ProblemPlans: { orderBy: { orderIndex: 'asc' } },
        },
      },
    },
  })
  const cleanPlan = (plan: any) => {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = plan
    return rest
  }
  const projection = {
    stage: {
      id: stage.id,
      name: stage.name,
      description: stage.description,
      orderIndex: stage.orderIndex,
      kind: stage.kind,
      audienceMode: stage.audienceMode,
      endPolicy: stage.endPolicy,
      accessPolicy: stage.accessPolicy,
      submissionMode: stage.submissionMode,
      plannedDurationSeconds: stage.plannedDurationSeconds,
      defaultTargetScore: stage.defaultTargetScore,
      completionThreshold: stage.completionThreshold,
      minDurationSeconds: stage.minDurationSeconds,
      rules: stage.rules,
      definitionRevision: stage.definitionRevision,
    },
    groups: stage.Groups.map((group: any) => ({
      id: group.id,
      name: group.name,
      orderIndex: group.orderIndex,
      accessPolicy: group.accessPolicy,
      submissionMode: group.submissionMode,
      rules: group.rules,
      assignments: group.Assignments.map((item: any) => ({ participantId: item.participantId })),
      plans: group.ProblemPlans.map(cleanPlan),
    })),
    problems: stage.Problems.map((problem: any) => ({
      id: problem.id,
      problemId: problem.problemId,
      testSetRevisionId: problem.testSetRevisionId,
      revisionNumber: problem.TestSetRevision.revisionNumber,
      judgeConfigHash: problem.TestSetRevision.judgeConfigHash,
      mode: problem.TestSetRevision.mode,
      alias: problem.alias,
      titleSnapshot: problem.titleSnapshot,
      statementsSnapshot: problem.statementsSnapshot,
      plans: problem.Plans.map(cleanPlan),
    })),
  }
  const projectionHash = crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex')
  await tx.trainingSessionStageRuntimeSnapshot.create({
    data: { stageId, definitionRevision: stage.definitionRevision, projection, projectionHash },
  })
}

export async function inspectTrainingEngineMigration() {
  const rows = await loadLegacyTrainings(prisma)
  const validUserIds = new Set((await prisma.user.findMany({ select: { id: true } })).map(item => item.id))
  const existing = await prisma.trainingSession.findMany({ where: { legacyTrainingId: { in: rows.map((row: any) => row.id) } }, select: { legacyTrainingId: true } })
  const migrated = new Set(existing.map(item => item.legacyTrainingId))
  const issues = rows.map((row: any) => ({ trainingId: row.id, title: row.title, reason: reasonFor(row, validUserIds) })).filter((item: any) => item.reason)
  return {
    reportHash: stableHash(rows, validUserIds),
    total: rows.length,
    alreadyMigrated: rows.filter((row: any) => migrated.has(row.id)).length,
    migratable: rows.filter((row: any) => !migrated.has(row.id) && !reasonFor(row, validUserIds)).length,
    blocked: issues.length,
    issues: issues.slice(0, 100),
    issuesOmitted: Math.max(0, issues.length - 100),
  }
}

export async function applyTrainingEngineMigration(expectedReportHash: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('training-engine-migration', 0)) IS NULL AS locked`
    const rows = await loadLegacyTrainings(tx)
    const validUserIds = new Set((await tx.user.findMany({ select: { id: true } })).map(item => item.id))
    const currentHash = stableHash(rows, validUserIds)
    if (!expectedReportHash || currentHash !== expectedReportHash) throw new Error('迁移检查结果已过期，请重新执行 check')
    let migrated = 0, submissionsLinked = 0
    const blocked: Array<{ trainingId: number; reason: string }> = []
    for (const row of rows) {
      if (await tx.trainingSession.findUnique({ where: { legacyTrainingId: row.id }, select: { id: true } })) continue
      const reason = reasonFor(row, validUserIds)
      if (reason) { blocked.push({ trainingId: row.id, reason }); continue }
      const status = mappedStatus(row) as 'SCHEDULED' | 'RUNNING' | 'ENDED'
      const historicalDurationSeconds = Math.max(0, Math.floor((row.endTime.getTime() - row.startTime.getTime()) / 1000))
      const session = await tx.trainingSession.create({ data: {
        legacyTrainingId: row.id,
        title: row.title,
        description: row.description,
        sessionType: row.format === 'acm' ? 'ACM' : 'OI',
        status,
        teamId: row.teamId,
        organizationId: row.organizationId,
        createdBy: row.createdBy,
        scheduledStartAt: row.startTime,
        startedAt: status === 'RUNNING' || status === 'ENDED' ? row.startTime : null,
        runningSince: status === 'RUNNING' ? row.startTime : null,
        endedAt: status === 'ENDED' ? row.endTime : null,
        activeElapsedSeconds: status === 'ENDED' ? historicalDurationSeconds : 0,
        currentStageId: null,
        rankingMode: row.format === 'acm' ? 'ACM_RANKING' : 'SCORE',
        peerVisibility: 'PROGRESS',
        joinMode: 'CURRENT_STAGE',
        settings: { migratedFromLegacyTrainingId: row.id },
      } })
      const stage = await tx.trainingSessionStage.create({ data: {
        sessionId: session.id,
        name: '完整训练',
        description: '由旧训练数据迁移生成',
        orderIndex: 0,
        kind: 'TRAINING',
        audienceMode: 'ALL',
        endPolicy: 'TIME',
        plannedDurationSeconds: Math.max(60, historicalDurationSeconds),
        accessPolicy: 'ALL_AT_ONCE',
        submissionMode: 'ENABLED',
        lifecycle: status === 'ENDED' ? 'ENDED' : status === 'RUNNING' ? 'RUNNING' : 'PENDING',
        startedAt: status === 'RUNNING' || status === 'ENDED' ? row.startTime : null,
        runningSince: status === 'RUNNING' ? row.startTime : null,
        endedAt: status === 'ENDED' ? row.endTime : null,
        endReason: status === 'ENDED' ? 'SYSTEM_ENDED' : null,
        endNote: status === 'ENDED' ? '由旧训练迁移为历史结束状态' : null,
        activeElapsedSeconds: status === 'ENDED' ? historicalDurationSeconds : 0,
      } })
      if (status === 'RUNNING') {
        await tx.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
      }
      const stageProblems = new Map<string, string>()
      for (const problem of row.TrainingProblem) {
        const revisionId = problem.testSetRevisionId || problem.Problem.latestTestSetRevisionId!
        const statementSnapshot = problem.Problem.ProblemStatement.map((statement: any) => ({
          type: statement.type,
          format: statement.format,
          language: statement.language,
          content: statement.content,
          fileUrl: statement.fileUrl,
        }))
        const created = await tx.trainingSessionStageProblem.create({ data: {
          stageId: stage.id,
          problemId: problem.problemId,
          testSetRevisionId: revisionId,
          alias: problem.alias,
          orderIndex: problem.orderIndex,
          titleSnapshot: problem.Problem.title,
          statementsSnapshot: statementSnapshot,
          targetScore: problem.points || (row.format === 'acm' ? 100 : null),
          judgeConfigProjection: problem.judgeConfigSnapshot,
        } })
        await tx.trainingSessionStageProblemPlan.create({ data: { stageId: stage.id, stageProblemId: created.id, orderIndex: problem.orderIndex, targetScore: problem.points || (row.format === 'acm' ? 100 : null), judgeConfigProjection: problem.judgeConfigSnapshot } })
        stageProblems.set(problem.id, created.id)
      }
      const participantByUser = new Map<string, string>()
      for (const old of row.TrainingParticipant) {
        if (participantByUser.has(old.userId)) continue
        const participant = await tx.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: old.userId, joinedAt: old.joinedAt, currentStageId: status === 'RUNNING' ? stage.id : null } })
        await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: stage.id, participantId: participant.id, source: 'legacy_migration' } })
        participantByUser.set(old.userId, participant.id)
      }
      for (const old of row.TrainingUserProblemStatus) {
        let participantId = participantByUser.get(old.userId)
        if (!participantId) {
          const participant = await tx.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: old.userId, currentStageId: status === 'RUNNING' ? stage.id : null } })
          await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: stage.id, participantId: participant.id, source: 'legacy_migration' } })
          participantId = participant.id; participantByUser.set(old.userId, participant.id)
        }
        const stageProblemId = stageProblems.get(old.trainingProblemId)
        if (!stageProblemId) continue
        const accepted = Boolean(old.acAt) || ['accepted', 'ac'].includes(String(old.bestResult || '').toLowerCase())
        await tx.trainingSessionProblemProgress.create({ data: {
          participantId, stageProblemId, status: accepted ? 'COMPLETED' : old.attemptCount ? 'WORKING' : 'NOT_STARTED',
          attemptCount: old.attemptCount, bestScore: old.bestScore, bestVerdict: old.bestResult, acAt: old.acAt,
          lastSubmissionAt: old.attemptCount ? old.updatedAt : null, lastScoreImprovedAt: old.bestScore != null ? old.updatedAt : null, lastProgressAt: old.updatedAt,
        } })
      }
      for (const [oldProblemId, stageProblemId] of stageProblems) {
        const result = await tx.submission.updateMany({ where: { trainingId: row.id, trainingProblemId: oldProblemId, submitScope: 'training' }, data: { trainingSessionId: session.id, trainingStageProblemId: stageProblemId } })
        submissionsLinked += result.count
      }
      if (status === 'RUNNING' || status === 'ENDED') await snapshotMigratedStage(tx, stage.id)
      migrated++
    }
    return { reportHash: currentHash, migrated, submissionsLinked, blocked }
  }, { isolationLevel: 'Serializable', maxWait: 15_000, timeout: 120_000 })
}
