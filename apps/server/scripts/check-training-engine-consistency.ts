import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type ConsistencyIssue = {
  code: string
  message: string
  sessionId?: string
  stageId?: string
  participantId?: string
  detail?: Record<string, unknown>
}

async function scanTrainingEngineConsistency(): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = []

  const runningWithoutCurrent = await prisma.trainingSession.findMany({
    where: { status: 'RUNNING', currentStageId: null },
    select: { id: true },
  })
  for (const session of runningWithoutCurrent) {
    issues.push({
      code: 'RUNNING_SESSION_WITHOUT_CURRENT_STAGE',
      sessionId: session.id,
      message: 'RUNNING Session 没有 current Stage',
    })
  }

  const runningStages = await prisma.trainingSessionStage.findMany({
    where: { lifecycle: 'RUNNING' },
    select: { id: true, sessionId: true },
    orderBy: [{ sessionId: 'asc' }, { orderIndex: 'asc' }],
  })
  const runningBySession = new Map<string, string[]>()
  for (const stage of runningStages) {
    runningBySession.set(stage.sessionId, [...(runningBySession.get(stage.sessionId) || []), stage.id])
  }
  for (const [sessionId, stageIds] of runningBySession) {
    if (stageIds.length <= 1) continue
    issues.push({
      code: 'MULTIPLE_RUNNING_STAGES',
      sessionId,
      message: '同一个 Session 存在多个 RUNNING Stage',
      detail: { stageIds },
    })
  }

  const endedWithRunning = await prisma.trainingSession.findMany({
    where: { status: { in: ['ENDED', 'ARCHIVED'] }, Stages: { some: { lifecycle: 'RUNNING' } } },
    select: { id: true, status: true, Stages: { where: { lifecycle: 'RUNNING' }, select: { id: true } } },
  })
  for (const session of endedWithRunning) {
    issues.push({
      code: 'TERMINAL_SESSION_WITH_RUNNING_STAGE',
      sessionId: session.id,
      message: 'ENDED/ARCHIVED Session 仍有 RUNNING Stage',
      detail: { status: session.status, stageIds: session.Stages.map(stage => stage.id) },
    })
  }

  const groupedStages = await prisma.trainingSessionStage.findMany({
    where: {
      audienceMode: 'GROUPED',
      lifecycle: { in: ['PENDING', 'RUNNING'] },
      Session: { status: { in: ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED'] } },
    },
    select: {
      id: true,
      sessionId: true,
      Session: { select: { Participants: { where: { status: 'active' }, select: { id: true } } } },
      ParticipantAssignments: { select: { participantId: true, groupId: true } },
    },
  })
  for (const stage of groupedStages) {
    const assignmentByParticipant = new Map(stage.ParticipantAssignments.map(item => [item.participantId, item.groupId]))
    for (const participant of stage.Session.Participants) {
      if (assignmentByParticipant.get(participant.id)) continue
      issues.push({
        code: 'GROUPED_STAGE_UNASSIGNED_PARTICIPANT',
        sessionId: stage.sessionId,
        stageId: stage.id,
        participantId: participant.id,
        message: 'GROUPED Stage 存在未分组 active participant',
      })
    }
  }

  const assignments = await prisma.trainingSessionStageParticipantAssignment.findMany({
    where: { groupId: { not: null } },
    select: { id: true, stageId: true, participantId: true, groupId: true, Group: { select: { stageId: true } } },
  })
  for (const assignment of assignments) {
    if (!assignment.Group || assignment.Group.stageId === assignment.stageId) continue
    issues.push({
      code: 'STAGE_ASSIGNMENT_CROSS_STAGE_GROUP',
      stageId: assignment.stageId,
      participantId: assignment.participantId,
      message: 'StageAssignment 指向其他 Stage 的 Group',
      detail: { assignmentId: assignment.id, groupId: assignment.groupId, groupStageId: assignment.Group.stageId },
    })
  }

  const currentStageMismatches = await prisma.trainingSession.findMany({
    where: { currentStageId: { not: null }, status: { in: ['RUNNING', 'PAUSED'] } },
    select: { id: true, currentStageId: true, Stages: { where: { lifecycle: 'RUNNING' }, select: { id: true } } },
  })
  for (const session of currentStageMismatches) {
    if (session.Stages.length === 1 && session.Stages[0].id === session.currentStageId) continue
    issues.push({
      code: 'CURRENT_STAGE_LIFECYCLE_MISMATCH',
      sessionId: session.id,
      stageId: session.currentStageId || undefined,
      message: 'Session.currentStageId 与唯一 RUNNING Stage 不一致',
      detail: { runningStageIds: session.Stages.map(stage => stage.id) },
    })
  }

  const orphanProgress = await prisma.$queryRaw<Array<{ id: string; participantId: string; stageProblemId: string }>>`
    SELECT p."id", p."participantId", p."stageProblemId"
    FROM "TrainingSessionProblemProgress" p
    LEFT JOIN "TrainingSessionStageProblem" sp ON sp."id" = p."stageProblemId"
    WHERE sp."id" IS NULL
  `
  for (const progress of orphanProgress) {
    issues.push({
      code: 'PROGRESS_WITHOUT_STAGE_PROBLEM',
      participantId: progress.participantId,
      message: 'Progress 指向不存在的 StageProblem',
      detail: { progressId: progress.id, stageProblemId: progress.stageProblemId },
    })
  }

  return issues
}

async function main() {
  const json = process.argv.includes('--json')
  const issues = await scanTrainingEngineConsistency()
  const result = {
    checkedAt: new Date().toISOString(),
    errorCount: issues.length,
    ok: issues.length === 0,
    issues,
  }

  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`Training Engine consistency: ${issues.length === 0 ? 'OK' : `${issues.length} error(s)`}`)
    for (const issue of issues) {
      console.error(`[${issue.code}] ${issue.message}`, {
        sessionId: issue.sessionId,
        stageId: issue.stageId,
        participantId: issue.participantId,
        ...issue.detail,
      })
    }
  }

  if (issues.length) process.exitCode = 1
}

main()
  .catch(error => {
    console.error('Training Engine consistency scan failed:', error)
    process.exitCode = 2
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
