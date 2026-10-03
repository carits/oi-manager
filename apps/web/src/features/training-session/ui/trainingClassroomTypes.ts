export type ClassroomProgress = {
  stageProblemId?: string
  status: string
  bestScore?: number | null
  attemptCount?: number
  activeSeconds?: number
  continuousActiveSeconds?: number
}

export type ClassroomParticipant = {
  id: string
  user: { id: string; username: string }
  online: boolean
  currentProblemId?: string
  currentGroupId?: string | null
  currentPlanId?: string | null
  activeSeconds?: number
  requiredCount: number
  completedCount: number
  completed: boolean
  progress: ClassroomProgress[]
}

export type ClassroomGroup = {
  id: string
  name: string
  status: string
}

export type ClassroomPlan = {
  id: string
  groupId?: string | null
  name: string
  isDefault: boolean
}

export type ClassroomArrangement = {
  id: string
  name: string
  activeElapsedSeconds: number
  runningSince?: string | null
  plannedDurationSeconds?: number | null
  Plans: ClassroomPlan[]
  Problems: Array<{ id: string; alias?: string; Problem: { problemId: string; title: string } }>
}
