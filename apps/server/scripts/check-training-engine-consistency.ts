import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
type Issue = { code: string; message: string; detail?: Record<string, unknown> }

async function scan(): Promise<Issue[]> {
  const issues: Issue[] = []
  const add = (code: string, message: string, values: any[]) => values.forEach(detail => issues.push({ code, message, detail }))

  const sessions = await prisma.$queryRawUnsafe<any[]>(`
    SELECT session.id, session.status, session."currentStageId",
      stage."sessionId" AS "currentStageSessionId", stage.lifecycle AS "currentStageLifecycle"
    FROM "TrainingSession" session
    LEFT JOIN "TrainingSessionStage" stage ON stage.id = session."currentStageId"
  `)
  add('CURRENT_STAGE_CROSS_SESSION', 'currentStage 必须属于当前 Session', sessions
    .filter(row => row.currentStageId && row.currentStageSessionId !== row.id)
    .map(row => ({ sessionId: row.id, currentStageId: row.currentStageId })))
  add('CURRENT_STAGE_NOT_RUNNING', 'currentStage 必须处于 RUNNING', sessions
    .filter(row => row.currentStageId && row.currentStageLifecycle !== 'RUNNING')
    .map(row => ({ sessionId: row.id, currentStageId: row.currentStageId, lifecycle: row.currentStageLifecycle })))
  add('RUNNING_SESSION_WITHOUT_STAGE', 'RUNNING/PAUSED Session 必须拥有 currentStage', sessions
    .filter(row => ['RUNNING', 'PAUSED'].includes(row.status) && !row.currentStageId)
    .map(row => ({ sessionId: row.id, status: row.status })))

  const stages = await prisma.$queryRawUnsafe<any[]>(`
    SELECT stage.id, stage."sessionId", stage.lifecycle, stage."startedAt", stage."runningSince",
      stage."endedAt", stage."definitionRevision"
    FROM "TrainingSessionStage" stage
  `)
  add('RUNNING_STAGE_MISSING_START', 'RUNNING Stage 必须具有 startedAt', stages
    .filter(row => row.lifecycle === 'RUNNING' && !row.startedAt)
    .map(row => ({ stageId: row.id })))
  add('TERMINAL_STAGE_HAS_RUNNING_CLOCK', '已结束 Stage 不得保留 runningSince', stages
    .filter(row => ['ENDED', 'SKIPPED'].includes(row.lifecycle) && row.runningSince)
    .map(row => ({ stageId: row.id, lifecycle: row.lifecycle })))
  add('TERMINAL_STAGE_MISSING_END', '已结束 Stage 必须具有 endedAt', stages
    .filter(row => ['ENDED', 'SKIPPED'].includes(row.lifecycle) && !row.endedAt)
    .map(row => ({ stageId: row.id, lifecycle: row.lifecycle })))

  const runningCounts = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "sessionId", array_agg(id ORDER BY "orderIndex") AS ids
    FROM "TrainingSessionStage"
    WHERE lifecycle = 'RUNNING'
    GROUP BY "sessionId"
    HAVING count(*) > 1
  `)
  add('SESSION_HAS_MULTIPLE_RUNNING_STAGES', '一个 Session 最多只能有一个 RUNNING Stage', runningCounts)

  const participants = await prisma.$queryRawUnsafe<any[]>(`
    SELECT participant.id, participant."sessionId", participant."groupId", participant.status,
      group_row."sessionId" AS "groupSessionId"
    FROM "TrainingSessionParticipant" participant
    LEFT JOIN "TrainingSessionGroup" group_row ON group_row.id = participant."groupId"
  `)
  add('ACTIVE_PARTICIPANT_WITHOUT_GROUP', 'active Participant 必须属于 Stable Group', participants
    .filter(row => row.status === 'active' && !row.groupId)
    .map(row => ({ participantId: row.id })))
  add('PARTICIPANT_CROSS_SESSION_GROUP', 'Participant.groupId 必须属于同一 Session', participants
    .filter(row => row.groupId && row.sessionId !== row.groupSessionId)
    .map(row => ({ participantId: row.id, groupId: row.groupId })))

  const plans = await prisma.$queryRawUnsafe<any[]>(`
    SELECT plan.id, plan."stageId", plan."groupId", plan."isDefault", plan."inheritsDefault",
      stage."sessionId" AS "stageSessionId", group_row."sessionId" AS "groupSessionId"
    FROM "TrainingSessionStageGroup" plan
    JOIN "TrainingSessionStage" stage ON stage.id = plan."stageId"
    LEFT JOIN "TrainingSessionGroup" group_row ON group_row.id = plan."groupId"
  `)
  add('INVALID_DEFAULT_PLAN_SHAPE', '默认 Stage 计划必须无 groupId 且不继承默认计划', plans
    .filter(row => row.isDefault && (row.groupId || row.inheritsDefault))
    .map(row => ({ planId: row.id, groupId: row.groupId, inheritsDefault: row.inheritsDefault })))
  add('INVALID_GROUP_OVERRIDE_SHAPE', '分组覆盖计划必须关联 Stable Group', plans
    .filter(row => !row.isDefault && !row.groupId)
    .map(row => ({ planId: row.id })))
  add('STAGE_PLAN_CROSS_SESSION', 'Stage 计划的 Group 必须属于同一 Session', plans
    .filter(row => row.groupId && row.stageSessionId !== row.groupSessionId)
    .map(row => ({ planId: row.id, groupId: row.groupId })))

  const defaultPlanCounts = await prisma.$queryRawUnsafe<any[]>(`
    SELECT stage.id AS "stageId", count(plan.id)::integer AS count
    FROM "TrainingSessionStage" stage
    LEFT JOIN "TrainingSessionStageGroup" plan
      ON plan."stageId" = stage.id AND plan."isDefault" = true
    GROUP BY stage.id
    HAVING count(plan.id) <> 1
  `)
  add('STAGE_DEFAULT_PLAN_COUNT_INVALID', '每个 Stage 必须恰好有一个默认计划', defaultPlanCounts)

  const problemPlans = await prisma.$queryRawUnsafe<any[]>(`
    SELECT plan.id, plan."stageId", problem."stageId" AS "problemStageId",
      stage_plan."stageId" AS "planStageId"
    FROM "TrainingSessionStageProblemPlan" plan
    JOIN "TrainingSessionStageProblem" problem ON problem.id = plan."stageProblemId"
    JOIN "TrainingSessionStageGroup" stage_plan ON stage_plan.id = plan."stageGroupId"
  `)
  add('PROBLEM_PLAN_CROSS_STAGE', 'ProblemPlan、StageProblem 和 StagePlan 必须属于同一 Stage', problemPlans
    .filter(row => row.stageId !== row.problemStageId || row.stageId !== row.planStageId)
    .map(row => ({ planId: row.id })))

  const changes = await prisma.$queryRawUnsafe<any[]>(`
    SELECT change.id, change."sessionId", change.status, change."effectiveMode",
      participant."sessionId" AS "participantSessionId",
      target_group."sessionId" AS "targetGroupSessionId",
      target_stage."sessionId" AS "targetStageSessionId"
    FROM "TrainingSessionGroupChange" change
    JOIN "TrainingSessionParticipant" participant ON participant.id = change."participantId"
    JOIN "TrainingSessionGroup" target_group ON target_group.id = change."toGroupId"
    LEFT JOIN "TrainingSessionStage" target_stage ON target_stage.id = change."targetStageId"
  `)
  add('GROUP_CHANGE_CROSS_SESSION', 'GroupChange 的 Participant、Group 和目标 Stage 必须属于同一 Session', changes
    .filter(row => row.sessionId !== row.participantSessionId
      || row.sessionId !== row.targetGroupSessionId
      || (row.targetStageSessionId && row.sessionId !== row.targetStageSessionId))
    .map(row => ({ changeId: row.id })))
  add('NEXT_STAGE_CHANGE_MISSING_TARGET', 'next-stage GroupChange 必须指定目标 Stage', changes
    .filter(row => row.effectiveMode === 'NEXT_STAGE' && !row.targetStageSessionId)
    .map(row => ({ changeId: row.id, status: row.status })))

  const snapshots = await prisma.$queryRawUnsafe<any[]>(`
    SELECT snapshot.id, snapshot."sessionId", snapshot."definitionRevision", snapshot."configHash",
      stage."sessionId" AS "stageSessionId", stage."definitionRevision" AS "stageDefinitionRevision"
    FROM "TrainingSessionStageRuntimeSnapshot" snapshot
    JOIN "TrainingSessionStage" stage ON stage.id = snapshot."stageId"
  `)
  add('SNAPSHOT_CROSS_SESSION', 'StageRuntimeSnapshot 必须属于 Stage 所在 Session', snapshots
    .filter(row => row.sessionId !== row.stageSessionId)
    .map(row => ({ snapshotId: row.id })))
  add('SNAPSHOT_REVISION_MISMATCH', 'StageRuntimeSnapshot 必须固化开始时的 definitionRevision', snapshots
    .filter(row => row.definitionRevision !== row.stageDefinitionRevision)
    .map(row => ({ snapshotId: row.id, snapshotRevision: row.definitionRevision, stageRevision: row.stageDefinitionRevision })))
  add('SNAPSHOT_HASH_INVALID', 'StageRuntimeSnapshot.configHash 必须是 SHA-256', snapshots
    .filter(row => !/^[a-f0-9]{64}$/.test(row.configHash || ''))
    .map(row => ({ snapshotId: row.id })))

  const orphan = await prisma.$queryRawUnsafe<any[]>(`
    SELECT progress.id
    FROM "TrainingSessionProblemProgress" progress
    LEFT JOIN "TrainingSessionStageProblem" problem ON problem.id = progress."stageProblemId"
    WHERE problem.id IS NULL
  `)
  add('PROGRESS_WITHOUT_STAGE_PROBLEM', 'Progress 指向不存在的 StageProblem', orphan)
  return issues
}

async function main() {
  const issues = await scan()
  const result = { checkedAt: new Date().toISOString(), errorCount: issues.length, ok: issues.length === 0, issues }
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else {
    console.log('Training Engine consistency: ' + (result.ok ? 'OK' : issues.length + ' error(s)'))
    issues.forEach(issue => console.error('[' + issue.code + '] ' + issue.message, issue.detail))
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
