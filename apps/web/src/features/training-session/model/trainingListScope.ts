export type TrainingListStatus = 'active' | 'upcoming' | 'completed' | 'draft'

export interface TrainingListQueryInput {
  organizationId?: string
  fixedTeamId?: string
  selectedTeamId?: string
  statusGroup: TrainingListStatus
  page: number
  pageSize: number
  keyword?: string
}

export function resolveTrainingListTeamId(fixedTeamId?: string, queryTeamId?: string | null) {
  return fixedTeamId || queryTeamId || ''
}

export function buildTrainingListQuery(input: TrainingListQueryInput): Record<string, string> {
  const query: Record<string, string> = {
    statusGroup: input.statusGroup,
    page: String(input.page),
    pageSize: String(input.pageSize),
  }
  const keyword = input.keyword?.trim()
  if (keyword) query.keyword = keyword

  if (input.organizationId) {
    query.organizationId = input.organizationId
    if (input.selectedTeamId) query.filterTeamId = input.selectedTeamId
    return query
  }

  const teamId = resolveTrainingListTeamId(input.fixedTeamId, input.selectedTeamId)
  if (teamId) query.teamId = teamId
  return query
}
