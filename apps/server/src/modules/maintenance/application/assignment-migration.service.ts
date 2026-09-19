import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { judgeMaxScoreFromSnapshot } from '../../assignment/assignment-grading'

async function loadLegacyHomeworks(db: typeof prisma | Prisma.TransactionClient | any) {
  return db.training.findMany({
    where: { type: 'homework' },
    orderBy: { id: 'asc' },
    include: {
      Team: { select: { organizationId: true, TeamMember: { where: { status: 'active' }, select: { userId: true } } } },
      TrainingProblem: { orderBy: { orderIndex: 'asc' }, include: { Problem: { select: { latestTestSetRevisionId: true } }, TestSetRevision: { select: { id: true, problemId: true, judgeConfig: true, judgeConfigHash: true, mode: true } } } },
      TrainingParticipant: { orderBy: { joinedAt: 'asc' } },
      TrainingUserProblemStatus: true,
      Submission: { orderBy: { id: 'asc' }, select: {
        id: true, userId: true, trainingProblemId: true, createdAt: true,
        CurrentJudgeRun: { select: { score: true, result: true } },
      } },
    },
  })
}

async function migrationContext(db: typeof prisma | Prisma.TransactionClient | any, rows: any[]) {
  const organizationIds = [...new Set(rows.map(row => row.organizationId || row.Team?.organizationId).filter(Boolean))] as string[]
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId: { in: organizationIds }, status: 'active' },
    select: { id: true, organizationId: true, userId: true, memberRole: true },
  })
  return { memberships }
}

function canonicalRows(rows: any[], memberships: any[]) {
  return rows.map(row => ({
    id: row.id, title: row.title, status: row.status, startTime: row.startTime, endTime: row.endTime,
    updatedAt: row.updatedAt, createdBy: row.createdBy, organizationId: row.organizationId || row.Team?.organizationId || null,
    teamId: row.teamId,
    teamUsers: row.Team?.TeamMember?.map((member: any) => member.userId).sort() || [],
    participants: row.TrainingParticipant.map((participant: any) => [participant.userId, participant.userType, participant.joinedAt]),
    problems: row.TrainingProblem.map((problem: any) => [problem.id, problem.problemId, problem.orderIndex, problem.testSetRevisionId, problem.Problem.latestTestSetRevisionId]),
    progress: row.TrainingUserProblemStatus.map((item: any) => [item.userId, item.trainingProblemId, item.bestScore, item.bestResult, item.attemptCount, item.acAt, item.updatedAt]),
    submissions: row.Submission.map((submission: any) => [
      submission.id, submission.userId, submission.trainingProblemId, submission.createdAt,
      submission.CurrentJudgeRun?.score ?? null, submission.CurrentJudgeRun?.result ?? 'system_error',
    ]),
    memberships: memberships.filter(item => item.organizationId === (row.organizationId || row.Team?.organizationId)).map(item => [item.id, item.userId, item.memberRole]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  }))
}

function reportHash(rows: any[], memberships: any[]) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalRows(rows, memberships))).digest('hex')
}

function membershipMap(memberships: any[], organizationId: string) {
  return new Map(memberships.filter(item => item.organizationId === organizationId).map(item => [item.userId, item]))
}

function recipientUserIds(row: any, memberships: any[], organizationId: string) {
  const memberByUser = membershipMap(memberships, organizationId)
  const explicit = row.TrainingParticipant.map((item: any) => item.userId)
  const submitted = row.Submission.map((item: any) => item.userId)
  const progressed = row.TrainingUserProblemStatus.map((item: any) => item.userId)
  const inferred = explicit.length
    ? explicit
    : row.teamId
      ? row.Team.TeamMember.map((item: any) => item.userId)
      : memberships.filter(item => item.organizationId === organizationId && item.memberRole === 'student').map(item => item.userId)
  return [...new Set([...inferred, ...submitted, ...progressed])].filter(userId => memberByUser.get(userId)?.memberRole === 'student') as string[]
}

function issueFor(row: any, memberships: any[]) {
  const organizationId = row.organizationId || row.Team?.organizationId
  if (!organizationId) return '旧作业没有可确认的学校归属'
  if (row.organizationId && row.Team?.organizationId && row.organizationId !== row.Team.organizationId) return '旧作业的学校与团队归属冲突'
  const memberByUser = membershipMap(memberships, organizationId)
  const creator = memberByUser.get(row.createdBy)
  if (!creator || !['teacher', 'school_principal'].includes(creator.memberRole)) return '创建人没有可确认的有效教师成员身份'
  if (!row.TrainingProblem.length) return '旧作业没有题目'
  const missingRevision = row.TrainingProblem.filter((problem: any) => !problem.testSetRevisionId && !problem.Problem.latestTestSetRevisionId)
  if (missingRevision.length) return `${missingRevision.length} 道题没有可固定的 TestSet Revision`
  const invalidPinned = row.TrainingProblem.filter((problem: any) => problem.testSetRevisionId && (!problem.TestSetRevision || problem.TestSetRevision.problemId !== problem.problemId))
  if (invalidPinned.length) return `${invalidPinned.length} 道题的固定 TestSet Revision 与题目不匹配`
  const allHistoricalUsers = [...new Set([...row.TrainingParticipant.map((item: any) => item.userId), ...row.TrainingUserProblemStatus.map((item: any) => item.userId), ...row.Submission.map((item: any) => item.userId)])]
  const invalidUsers = allHistoricalUsers.filter(userId => memberByUser.get(userId)?.memberRole !== 'student')
  if (invalidUsers.length) return `${invalidUsers.length} 名历史参与者没有可确认的有效学生成员身份`
  if (!recipientUserIds(row, memberships, organizationId).length) return '旧作业没有可确认的学生名单'
  return null
}

function mappedStatus(row: any, now = new Date()) {
  if (row.status === 'cancelled') return 'CANCELLED'
  if (row.endTime <= now || row.status === 'finished') return 'CLOSED'
  if (row.startTime <= now || row.status === 'ongoing') return 'OPEN'
  return 'SCHEDULED'
}

export async function inspectAssignmentMigration() {
  const rows = await loadLegacyHomeworks(prisma)
  const { memberships } = await migrationContext(prisma, rows)
  const existing = new Set((await prisma.assignment.findMany({ where: { legacyTrainingId: { in: rows.map((row: any) => row.id) } }, select: { legacyTrainingId: true } })).map(item => item.legacyTrainingId))
  const issues = rows.map((row: any) => ({ trainingId: row.id, title: row.title, reason: issueFor(row, memberships) })).filter((item: { reason: string | null }) => item.reason)
  return {
    reportHash: reportHash(rows, memberships),
    total: rows.length,
    alreadyMigrated: rows.filter((row: any) => existing.has(row.id)).length,
    migratable: rows.filter((row: any) => !existing.has(row.id) && !issueFor(row, memberships)).length,
    blocked: issues.length,
    issues: issues.slice(0, 100),
    issuesOmitted: Math.max(0, issues.length - 100),
  }
}

export async function applyAssignmentMigration(expectedReportHash: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('assignment-migration-v1', 0)) IS NULL AS locked`
    const rows = await loadLegacyHomeworks(tx)
    const { memberships } = await migrationContext(tx, rows)
    const currentHash = reportHash(rows, memberships)
    if (!expectedReportHash || currentHash !== expectedReportHash) throw new Error('迁移检查结果已过期，请重新执行 check')
    let migrated = 0
    let submissionsLinked = 0
    const blocked: Array<{ trainingId: number; reason: string }> = []
    for (const row of rows) {
      if (await tx.assignment.findUnique({ where: { legacyTrainingId: row.id }, select: { id: true } })) continue
      const issue = issueFor(row, memberships)
      if (issue) { blocked.push({ trainingId: row.id, reason: issue }); continue }
      const organizationId = row.organizationId || row.Team.organizationId
      const memberByUser = membershipMap(memberships, organizationId)
      const recipients = recipientUserIds(row, memberships, organizationId)
      const status = mappedStatus(row)
      const created = await tx.assignment.create({ data: {
        legacyTrainingId: row.id,
        organizationId,
        teamId: row.teamId,
        title: row.title,
        description: row.description,
        status,
        rosterMode: 'SNAPSHOT',
        gradingPolicy: 'BEST_BEFORE_DUE',
        latePolicy: 'DISALLOW',
        correctionPolicy: 'NONE',
        solutionReleasePolicy: row.solutionVisible ? 'AFTER_CLOSE' : 'AFTER_RELEASE',
        publishAt: row.startTime,
        openAt: row.startTime,
        dueAt: row.endTime,
        closeAt: row.endTime,
        createdByMembershipId: memberByUser.get(row.createdBy)!.id,
        publishedAt: row.createdAt,
        closedAt: status === 'CLOSED' ? row.endTime : null,
        cancelledAt: status === 'CANCELLED' ? row.updatedAt : null,
        eventSeq: 1,
      } })
      await tx.assignmentEvent.create({ data: { assignmentId: created.id, seq: 1, type: 'assignment.migrated', actorUserId: null, payload: { legacyTrainingId: row.id } } })
      const problemMap = new Map<string, string>()
      for (const problem of row.TrainingProblem) {
        const revision = problem.TestSetRevision || await tx.problemTestSetRevision.findUniqueOrThrow({ where: { id: problem.Problem.latestTestSetRevisionId! } })
        const assignmentProblem = await tx.assignmentProblem.create({ data: {
          assignmentId: created.id,
          problemId: problem.problemId,
          testSetRevisionId: revision.id,
          orderIndex: problem.orderIndex,
          category: 'REQUIRED',
          required: true,
          maxScore: problem.points || 100,
          judgeMaxScore: judgeMaxScoreFromSnapshot(problem.judgeConfigSnapshot || revision.judgeConfig, revision.mode),
          targetScore: problem.points || 100,
          weight: 100,
          completionPolicy: revision.mode === 'acm' ? 'AC' : 'TARGET_SCORE',
          judgeConfigSnapshot: problem.judgeConfigSnapshot || revision.judgeConfig,
          judgeConfigHash: revision.judgeConfigHash,
          settings: { legacyTrainingProblemId: problem.id },
        } })
        problemMap.set(problem.id, assignmentProblem.id)
      }
      const recipientMap = new Map<string, string>()
      for (const targetUserId of recipients) {
        const oldParticipant = row.TrainingParticipant.find((item: any) => item.userId === targetUserId)
        const recipient = await tx.assignmentRecipient.create({ data: {
          assignmentId: created.id,
          userId: targetUserId,
          membershipId: memberByUser.get(targetUserId)!.id,
          source: oldParticipant ? 'legacy_participant' : row.teamId ? 'legacy_team_snapshot' : 'legacy_organization_snapshot',
          status: 'ASSIGNED',
          assignedAt: oldParticipant?.joinedAt || row.createdAt,
          dueAtEffective: row.endTime,
          closeAtEffective: row.endTime,
        } })
        recipientMap.set(targetUserId, recipient.id)
      }
      for (const [legacyProblemId, assignmentProblemId] of problemMap) {
        for (const targetUserId of recipients) {
          const old = row.TrainingUserProblemStatus.find((item: any) => item.trainingProblemId === legacyProblemId && item.userId === targetUserId)
          const submissions = row.Submission
            .filter((item: any) => item.trainingProblemId === legacyProblemId && item.userId === targetUserId)
            .map((item: any) => ({
              ...item,
              score: item.CurrentJudgeRun?.score ?? null,
              result: item.CurrentJudgeRun?.result ?? 'system_error',
            }))
          const accepted = Boolean(old?.acAt) || ['accepted', 'ac'].includes(String(old?.bestResult || '').toLowerCase())
          const latest = submissions.at(-1)
          const best = submissions.reduce((current: any, item: any) => (Number(item.score ?? 0) > Number(current?.score ?? -1) ? item : current), null)
          await tx.assignmentProblemProgress.create({ data: {
            assignmentId: created.id,
            assignmentProblemId,
            recipientId: recipientMap.get(targetUserId)!,
            learningStatus: accepted ? 'COMPLETED' : (old?.attemptCount || submissions.length) ? 'SUBMITTED' : 'NOT_STARTED',
            attemptCount: old?.attemptCount || submissions.length,
            originalAttemptCount: old?.attemptCount || submissions.length,
            bestScore: old?.bestScore ?? best?.score ?? null,
            bestVerdict: old?.bestResult ?? best?.result ?? null,
            originalScore: old?.bestScore ?? best?.score ?? null,
            finalScore: old?.bestScore ?? best?.score ?? null,
            firstSubmissionId: submissions[0]?.id,
            bestSubmissionId: best?.id,
            latestSubmissionId: latest?.id,
            targetMetAt: old?.acAt,
            completedAt: accepted ? old?.acAt || old?.updatedAt : null,
            firstSubmittedAt: submissions[0]?.createdAt,
            lastSubmittedAt: latest?.createdAt,
          } })
          for (const submission of submissions) {
            const linked = await tx.submission.updateMany({ where: { id: submission.id, assignmentId: null }, data: {
              assignmentId: created.id,
              assignmentProblemId,
              assignmentRecipientId: recipientMap.get(targetUserId)!,
              submissionPhase: submission.createdAt > row.endTime ? 'LATE' : 'ORIGINAL',
            } })
            submissionsLinked += linked.count
          }
        }
      }
      migrated++
    }
    return { reportHash: currentHash, migrated, submissionsLinked, blocked }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15_000, timeout: 120_000 })
}
