import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
type Issue = { code: string; message: string; detail?: Record<string, unknown> }

async function scan(): Promise<Issue[]> {
  const issues: Issue[] = []
  const add = (code: string, message: string, values: any[]) => values.forEach(detail => issues.push({ code, message, detail }))
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT sg.id, sg."stageId", sg."groupId", sg.status, sg."startedAt", sg."runningSince", s."sessionId" AS "stageSessionId", g."sessionId" AS "groupSessionId" FROM "TrainingSessionStageGroup" sg JOIN "TrainingSessionStage" s ON s.id = sg."stageId" LEFT JOIN "TrainingSessionGroup" g ON g.id = sg."groupId"')
  add('STAGE_GROUP_WITHOUT_GROUP', 'StageGroup.groupId 不能为空', rows.filter(r => !r.groupId).map(r => ({ id: r.id })))
  add('STAGE_GROUP_CROSS_SESSION', 'Stage 与 Group 不属于同一 Session', rows.filter(r => r.groupId && r.stageSessionId !== r.groupSessionId).map(r => ({ id: r.id })))
  add('ENDED_STAGE_GROUP_HAS_RUNTIME', 'ENDED/SKIPPED StageGroup 不得保留 runningSince', rows.filter(r => ['ENDED', 'SKIPPED'].includes(r.status) && r.runningSince).map(r => ({ id: r.id, status: r.status })))
  add('RUNNING_STAGE_GROUP_MISSING_START', 'RUNNING StageGroup 必须有 startedAt 与 runningSince', rows.filter(r => r.status === 'RUNNING' && (!r.startedAt || !r.runningSince)).map(r => ({ id: r.id })))
  const active = new Map<string, string[]>()
  for (const row of rows) if (row.groupId && ['RUNNING', 'PAUSED'].includes(row.status)) active.set(row.groupId, [...(active.get(row.groupId) || []), row.id])
  for (const [groupId, ids] of active) if (ids.length > 1) issues.push({ code: 'GROUP_HAS_MULTIPLE_ACTIVE_STAGE_GROUPS', message: '一个 Stable Group 最多只能有一个 RUNNING/PAUSED StageGroup', detail: { groupId, ids } })

  const participants = await prisma.$queryRawUnsafe<any[]>('SELECT p.id, p."sessionId", p."groupId", p.status, g."sessionId" AS "groupSessionId" FROM "TrainingSessionParticipant" p LEFT JOIN "TrainingSessionGroup" g ON g.id = p."groupId"')
  add('ACTIVE_PARTICIPANT_WITHOUT_GROUP', 'active Participant 必须属于 Stable Group', participants.filter(r => r.status === 'active' && !r.groupId).map(r => ({ id: r.id })))
  add('PARTICIPANT_CROSS_SESSION_GROUP', 'Participant.groupId 必须属于同一 Session', participants.filter(r => r.groupId && r.sessionId !== r.groupSessionId).map(r => ({ id: r.id })))

  const assignments = await prisma.$queryRawUnsafe<any[]>('SELECT a.id, s."sessionId" AS "stageSessionId", p."sessionId" AS "participantSessionId", g."sessionId" AS "groupSessionId" FROM "TrainingSessionStageParticipantAssignment" a JOIN "TrainingSessionStage" s ON s.id = a."stageId" JOIN "TrainingSessionParticipant" p ON p.id = a."participantId" JOIN "TrainingSessionGroup" g ON g.id = a."groupId"')
  add('STAGE_ASSIGNMENT_CROSS_SESSION', 'Stage assignment 的 Stage、Participant、Group 必须同 Session', assignments.filter(r => r.stageSessionId !== r.participantSessionId || (r.groupSessionId && r.groupSessionId !== r.stageSessionId)).map(r => ({ id: r.id })))

  const plans = await prisma.$queryRawUnsafe<any[]>('SELECT pp.id, pp."stageId", sp."stageId" AS "problemStageId", sg."stageId" AS "groupStageId" FROM "TrainingSessionStageProblemPlan" pp JOIN "TrainingSessionStageProblem" sp ON sp.id = pp."stageProblemId" JOIN "TrainingSessionStageGroup" sg ON sg.id = pp."stageGroupId"')
  add('PLAN_CROSS_STAGE', 'StageProblemPlan 的 Stage、StageProblem、StageGroup 必须同一 Stage', plans.filter(r => r.stageId !== r.problemStageId || (r.groupStageId && r.groupStageId !== r.stageId)).map(r => ({ id: r.id })))
  const orphan = await prisma.$queryRawUnsafe<any[]>('SELECT p.id FROM "TrainingSessionProblemProgress" p LEFT JOIN "TrainingSessionStageProblem" sp ON sp.id = p."stageProblemId" WHERE sp.id IS NULL')
  add('PROGRESS_WITHOUT_STAGE_PROBLEM', 'Progress 指向不存在的 StageProblem', orphan)
  return issues
}

async function main() {
  const issues = await scan()
  const result = { checkedAt: new Date().toISOString(), errorCount: issues.length, ok: issues.length === 0, issues }
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else {
    console.log('Training Engine consistency: ' + (result.ok ? 'OK' : issues.length + ' error(s)'))
    issues.forEach(i => console.error('[' + i.code + '] ' + i.message, i.detail))
  }
  if (issues.length) process.exitCode = 1
}
main().catch(error => { console.error('Training Engine consistency scan failed:', error); process.exitCode = 2 }).finally(async () => { await prisma.$disconnect() })