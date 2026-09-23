export type TrainingRequirementState = 'REQUIRED' | 'SATISFIED' | 'BYPASSED' | 'RETIRED'

export type RequirementProgress = {
  stageProblemId: string
  status: string
}

export type RequirementStage = {
  id: string
  audienceMode: string
  ParticipantAssignments: Array<{ participantId: string; groupId: string | null }>
  Problems: Array<{
    id: string
    Plans: Array<{ groupId: string | null }>
  }>
}

export type RequirementSession = {
  Stages: RequirementStage[]
}

export function requiredStageProblemIds(stage: RequirementStage, participantId: string) {
  const assignment = stage.ParticipantAssignments.find(item => item.participantId === participantId)
  const groupId = stage.audienceMode === 'GROUPED' ? assignment?.groupId || null : null
  if (stage.audienceMode === 'GROUPED' && !groupId) return new Set<string>()
  return new Set(
    stage.Problems
      .filter(problem => problem.Plans.some(plan => plan.groupId === groupId))
      .map(problem => problem.id),
  )
}

export function resolveParticipantStageRequirements(
  stage: RequirementStage,
  participantId: string,
  progressRows: RequirementProgress[] = [],
) {
  const requiredIds = requiredStageProblemIds(stage, participantId)
  const stageProblemIds = new Set(stage.Problems.map(problem => problem.id))
  const progressById = new Map(
    progressRows
      .filter(progress => stageProblemIds.has(progress.stageProblemId))
      .map(progress => [progress.stageProblemId, progress] as const),
  )
  const visibleIds = new Set([...requiredIds, ...progressById.keys()])
  return [...visibleIds].map(stageProblemId => {
    const progress = progressById.get(stageProblemId)
    let state: TrainingRequirementState
    if (!requiredIds.has(stageProblemId)) state = 'RETIRED'
    else if (progress?.status === 'SKIPPED') state = 'BYPASSED'
    else if (progress?.status === 'COMPLETED') state = 'SATISFIED'
    else state = 'REQUIRED'
    return { stageProblemId, state, progress }
  })
}

export function resolveParticipantSessionRequirements(
  session: RequirementSession,
  participantId: string,
  progressRows: RequirementProgress[] = [],
) {
  return session.Stages.flatMap(stage =>
    resolveParticipantStageRequirements(stage, participantId, progressRows)
      .map(requirement => ({ ...requirement, stageId: stage.id })),
  )
}

export function requiredSessionProblemIds(session: RequirementSession, participantId: string) {
  return new Set(
    resolveParticipantSessionRequirements(session, participantId)
      .filter(requirement => requirement.state !== 'RETIRED')
      .map(requirement => requirement.stageProblemId),
  )
}
