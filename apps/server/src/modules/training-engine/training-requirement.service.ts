export type TrainingRequirementState = 'REQUIRED' | 'SATISFIED' | 'BYPASSED' | 'RETIRED'

export type RequirementProgress = { stageProblemId: string; status: string }
export type RequirementStage = {
  id: string
  Groups: Array<{ id: string; groupId: string; status: string; ProblemPlans: Array<{ stageProblemId: string }> }>
  ParticipantAssignments: Array<{ participantId: string; groupId: string | null }>
  Problems: Array<{ id: string }>
}
export type RequirementSession = { Stages: RequirementStage[] }

function stateFor(requiredIds: Set<string>, stageProblemId: string, progress?: RequirementProgress): TrainingRequirementState {
  if (!requiredIds.has(stageProblemId)) return 'RETIRED'
  if (progress?.status === 'SKIPPED') return 'BYPASSED'
  if (progress?.status === 'COMPLETED') return 'SATISFIED'
  return 'REQUIRED'
}

export function requiredStageProblemIds(stage: RequirementStage, participantId: string) {
  const groupId = stage.ParticipantAssignments.find(item => item.participantId === participantId)?.groupId
  if (!groupId) return new Set<string>()
  const activeUnit = stage.Groups.find(unit => unit.groupId === groupId && ['RUNNING', 'PAUSED'].includes(unit.status))
  return new Set((activeUnit?.ProblemPlans || []).map(plan => plan.stageProblemId))
}

export function resolveParticipantStageRequirements(stage: RequirementStage, participantId: string, progressRows: RequirementProgress[] = []) {
  const requiredIds = requiredStageProblemIds(stage, participantId)
  const stageProblemIds = new Set(stage.Problems.map(problem => problem.id))
  const progressById = new Map(progressRows.filter(progress => stageProblemIds.has(progress.stageProblemId)).map(progress => [progress.stageProblemId, progress] as const))
  return [...new Set([...requiredIds, ...progressById.keys()])].map(stageProblemId => ({
    stageProblemId,
    state: stateFor(requiredIds, stageProblemId, progressById.get(stageProblemId)),
    progress: progressById.get(stageProblemId),
  }))
}

export function resolveParticipantSessionRequirements(session: RequirementSession, participantId: string, progressRows: RequirementProgress[] = []) {
  return session.Stages.flatMap(stage => resolveParticipantStageRequirements(stage, participantId, progressRows).map(item => ({ ...item, stageId: stage.id })))
}

export function requiredSessionProblemIds(session: RequirementSession, participantId: string) {
  return new Set(resolveParticipantSessionRequirements(session, participantId).filter(item => item.state !== 'RETIRED').map(item => item.stageProblemId))
}