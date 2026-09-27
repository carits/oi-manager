export type TrainingRequirementState = 'REQUIRED' | 'SATISFIED' | 'BYPASSED' | 'RETIRED'

export type RequirementProgress = { stageProblemId: string; status: string }
type RequirementPlanProblem = { stageProblemId: string; required: boolean }
type RequirementPlan = { groupId: string | null; isDefault: boolean; inheritsDefault: boolean; ProblemPlans: RequirementPlanProblem[] }
export type RequirementStage = { id: string; Groups: RequirementPlan[]; Problems: Array<{ id: string }> }
export type RequirementSession = {
  Stages: RequirementStage[]
  Groups: Array<{ id: string; Participants: Array<{ id: string; userId?: string; status: string }> }>
  Overlays?: Array<{ type: string; targetType: string; targetId?: string | null; stageProblemId?: string | null; payload?: unknown; status?: string }>
}

function stateFor(requiredIds: Set<string>, stageProblemId: string, progress?: RequirementProgress): TrainingRequirementState {
  if (!requiredIds.has(stageProblemId)) return 'RETIRED'
  if (progress?.status === 'SKIPPED') return 'BYPASSED'
  if (progress?.status === 'COMPLETED') return 'SATISFIED'
  return 'REQUIRED'
}

function participantIdentity(session: RequirementSession, participantId: string) {
  for (const group of session.Groups) {
    const participant = group.Participants.find(item => item.id === participantId && item.status === 'active')
    if (participant) return { groupId: group.id, userId: participant.userId || null }
  }
  return { groupId: null, userId: null }
}

function runtimeTargetApplies(overlay: NonNullable<RequirementSession['Overlays']>[number], identity: { groupId: string | null; userId: string | null }) {
  if (overlay.targetType === 'ALL') return true
  if (overlay.targetType === 'GROUP') return overlay.targetId === identity.groupId
  if (overlay.targetType === 'USER') return overlay.targetId === identity.userId
  return false
}

export function requiredStageProblemIds(stage: RequirementStage, groupId: string | null) {
  const defaultPlan = stage.Groups.find(plan => plan.isDefault)
  const override = groupId ? stage.Groups.find(plan => plan.groupId === groupId) : null
  const selected = new Map<string, boolean>()
  if (!override || override.inheritsDefault) for (const problem of defaultPlan?.ProblemPlans || []) selected.set(problem.stageProblemId, problem.required)
  if (override) for (const problem of override.ProblemPlans) selected.set(problem.stageProblemId, problem.required)
  return new Set([...selected].filter(([, required]) => required).map(([stageProblemId]) => stageProblemId))
}

export function resolveParticipantStageRequirements(stage: RequirementStage, groupId: string | null, progressRows: RequirementProgress[] = [], runtimeRequiredIds: Iterable<string> = []) {
  const requiredIds = requiredStageProblemIds(stage, groupId)
  for (const stageProblemId of runtimeRequiredIds) requiredIds.add(stageProblemId)
  const stageProblemIds = new Set(stage.Problems.map(problem => problem.id))
  const progressById = new Map(progressRows.filter(progress => stageProblemIds.has(progress.stageProblemId)).map(progress => [progress.stageProblemId, progress] as const))
  return [...new Set([...requiredIds, ...progressById.keys()])].map(stageProblemId => ({ stageProblemId, state: stateFor(requiredIds, stageProblemId, progressById.get(stageProblemId)), progress: progressById.get(stageProblemId) }))
}

export function resolveParticipantSessionRequirements(session: RequirementSession, participantId: string, progressRows: RequirementProgress[] = []) {
  const identity = participantIdentity(session, participantId)
  return session.Stages.flatMap(stage => {
    const problemIds = new Set(stage.Problems.map(problem => problem.id))
    const runtimeRequiredIds = (session.Overlays || [])
      .filter(overlay => overlay.type === 'RUNTIME_PROBLEM'
        && overlay.status !== 'ended'
        && Boolean(overlay.stageProblemId && problemIds.has(overlay.stageProblemId))
        && runtimeTargetApplies(overlay, identity)
        && (!overlay.payload || typeof overlay.payload !== 'object' || !('required' in overlay.payload) || (overlay.payload as any).required !== false))
      .map(overlay => overlay.stageProblemId!)
    return resolveParticipantStageRequirements(stage, identity.groupId, progressRows, runtimeRequiredIds).map(item => ({ ...item, stageId: stage.id }))
  })
}

export function requiredSessionProblemIds(session: RequirementSession, participantId: string) {
  return new Set(resolveParticipantSessionRequirements(session, participantId).filter(item => item.state !== 'RETIRED').map(item => item.stageProblemId))
}
