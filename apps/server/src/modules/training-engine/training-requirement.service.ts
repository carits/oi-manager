export type TrainingRequirementState = 'REQUIRED' | 'SATISFIED' | 'BYPASSED' | 'RETIRED'

export type RequirementProgress = { stageProblemId: string; status: string }
type RequirementPlanProblem = { stageProblemId: string; required: boolean }
type RequirementPlan = { groupId: string | null; isDefault: boolean; inheritsDefault: boolean; ProblemPlans: RequirementPlanProblem[] }
export type RequirementStage = { id: string; Groups: RequirementPlan[]; Problems: Array<{ id: string }> }
export type RequirementSession = {
  Stages: RequirementStage[]
  Groups: Array<{ id: string; Participants: Array<{ id: string; status: string }> }>
}

function stateFor(requiredIds: Set<string>, stageProblemId: string, progress?: RequirementProgress): TrainingRequirementState {
  if (!requiredIds.has(stageProblemId)) return 'RETIRED'
  if (progress?.status === 'SKIPPED') return 'BYPASSED'
  if (progress?.status === 'COMPLETED') return 'SATISFIED'
  return 'REQUIRED'
}

function participantGroupId(session: RequirementSession, participantId: string) {
  return session.Groups.find(group => group.Participants.some(participant => participant.id === participantId && participant.status === 'active'))?.id || null
}

export function requiredStageProblemIds(stage: RequirementStage, groupId: string | null) {
  const defaultPlan = stage.Groups.find(plan => plan.isDefault)
  const override = groupId ? stage.Groups.find(plan => plan.groupId === groupId) : null
  const selected = new Map<string, boolean>()
  if (!override || override.inheritsDefault) for (const problem of defaultPlan?.ProblemPlans || []) selected.set(problem.stageProblemId, problem.required)
  if (override) for (const problem of override.ProblemPlans) selected.set(problem.stageProblemId, problem.required)
  return new Set([...selected].filter(([, required]) => required).map(([stageProblemId]) => stageProblemId))
}

export function resolveParticipantStageRequirements(stage: RequirementStage, groupId: string | null, progressRows: RequirementProgress[] = []) {
  const requiredIds = requiredStageProblemIds(stage, groupId)
  const stageProblemIds = new Set(stage.Problems.map(problem => problem.id))
  const progressById = new Map(progressRows.filter(progress => stageProblemIds.has(progress.stageProblemId)).map(progress => [progress.stageProblemId, progress] as const))
  return [...new Set([...requiredIds, ...progressById.keys()])].map(stageProblemId => ({ stageProblemId, state: stateFor(requiredIds, stageProblemId, progressById.get(stageProblemId)), progress: progressById.get(stageProblemId) }))
}

export function resolveParticipantSessionRequirements(session: RequirementSession, participantId: string, progressRows: RequirementProgress[] = []) {
  const groupId = participantGroupId(session, participantId)
  return session.Stages.flatMap(stage => resolveParticipantStageRequirements(stage, groupId, progressRows).map(item => ({ ...item, stageId: stage.id })))
}

export function requiredSessionProblemIds(session: RequirementSession, participantId: string) {
  return new Set(resolveParticipantSessionRequirements(session, participantId).filter(item => item.state !== 'RETIRED').map(item => item.stageProblemId))
}
