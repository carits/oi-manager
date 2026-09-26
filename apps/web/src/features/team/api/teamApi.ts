import {
  TeamContracts,
  type EndpointBody,
  type TeamMemberType,
} from '@oi-manager/contracts'
import apiClient, { type MutationResult } from '@/lib/apiClient'

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const value = params.toString()
  return value ? `?${value}` : ''
}

export type TeamListQuery = {
  page?: number
  pageSize?: number
  organizationId?: string
  schoolId?: string
  view?: 'mine' | 'all' | 'managed'
  keyword?: string
}

export function listTeams(query: TeamListQuery) {
  return apiClient.queryContract(TeamContracts.list, `/api/teams${queryString(query)}`)
}

export function checkTeamId(id: string) {
  return apiClient.queryContract(TeamContracts.checkId, `/api/teams/check-team-id?id=${encodeURIComponent(id)}`)
}

export function getMyTeams() {
  return apiClient.queryContract(TeamContracts.mine, '/api/teams/mine')
}

export function listTeamProblemLists(teamId: string) {
  return apiClient.queryContract(TeamContracts.problemLists, `/api/teams/${encodeURIComponent(teamId)}/problem-lists`)
}

export function getTeamDetail(teamId: string) {
  return apiClient.queryContract(TeamContracts.detail, `/api/teams/${encodeURIComponent(teamId)}`)
}

export function createTeam(body: EndpointBody<typeof TeamContracts.create>) {
  return apiClient.mutateContract(TeamContracts.create, '/api/teams', body)
}

export function updateTeam(teamId: string, body: EndpointBody<typeof TeamContracts.update>) {
  return apiClient.mutateContract(TeamContracts.update, `/api/teams/${encodeURIComponent(teamId)}`, body)
}

export function updateTeamAnnouncement(teamId: string, announcement: string | null) {
  return apiClient.mutateContract(TeamContracts.announcement, `/api/teams/${encodeURIComponent(teamId)}/announcement`, { announcement })
}

export function leaveTeam(teamId: string) {
  return apiClient.mutateContract(TeamContracts.leave, `/api/teams/${encodeURIComponent(teamId)}/leave`, {})
}

export function transferTeam(teamId: string, body: EndpointBody<typeof TeamContracts.transfer>) {
  return apiClient.mutateContract(TeamContracts.transfer, `/api/teams/${encodeURIComponent(teamId)}/transfer`, body)
}

export function listTeamJoinRequests(teamId: string) {
  return apiClient.queryContract(TeamContracts.joinRequests, `/api/teams/${encodeURIComponent(teamId)}/join-requests`)
}

export function requestToJoinTeam(teamId: string, message?: string) {
  return apiClient.mutateContract(TeamContracts.joinRequest, `/api/teams/${encodeURIComponent(teamId)}/join-request`, { message })
}

export function decideTeamJoinRequest(requestId: string, action: 'approve' | 'reject') {
  return apiClient.mutateContract(TeamContracts.decideJoinRequest, `/api/teams/join-requests/${encodeURIComponent(requestId)}/${action}`, {})
}

export function listAvailableTeamMembers(teamId: string, keyword?: string) {
  return apiClient.queryContract(TeamContracts.availableMembers, `/api/teams/${encodeURIComponent(teamId)}/available-members${queryString({ keyword })}`)
}

export function inviteTeamMembers(teamId: string, body: EndpointBody<typeof TeamContracts.inviteMembers>) {
  return apiClient.mutateContract(TeamContracts.inviteMembers, `/api/teams/${encodeURIComponent(teamId)}/members`, body)
}

export function removeTeamMember(teamId: string, memberId: string, memberType?: TeamMemberType) {
  return apiClient.mutateContract(
    TeamContracts.removeMember,
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}${queryString({ memberType })}`,
    undefined,
  )
}

export function setTeamAdmin(teamId: string, memberId: string, memberType?: TeamMemberType) {
  return apiClient.mutateContract(TeamContracts.setAdmin, `/api/teams/${encodeURIComponent(teamId)}/admins`, { memberId, memberType })
}

export function listPendingTeamInvites(teamId: string) {
  return apiClient.queryContract(TeamContracts.pendingInvites, `/api/teams/${encodeURIComponent(teamId)}/pending-invites`)
}

export function cancelTeamInvite(teamId: string, inviteId: string) {
  return apiClient.mutateContract(TeamContracts.cancelInvite, `/api/teams/${encodeURIComponent(teamId)}/invites/${encodeURIComponent(inviteId)}`, undefined)
}

export function listMyTeamInvitations(kind: 'member' | 'admin' | 'all' = 'all') {
  const contract = kind === 'member' ? TeamContracts.memberInvitations : kind === 'admin' ? TeamContracts.adminInvitations : TeamContracts.invitations
  const path = kind === 'member' ? '/api/teams/member-invitations' : kind === 'admin' ? '/api/teams/admin-invitations' : '/api/teams/invitations'
  return apiClient.queryContract(contract, path)
}

export function respondToTeamInvitation(invitationId: string, action: 'accept' | 'reject', kind: 'member' | 'admin' | 'all' = 'all'): Promise<MutationResult<{ message?: string }>> {
  const contract = TeamContracts.respondInvitation
  const prefix = kind === 'all' ? 'invitations' : `${kind}-invitations`
  return apiClient.mutateContract(contract, `/api/teams/${prefix}/${encodeURIComponent(invitationId)}/${action}`, {})
}

/** Team avatars intentionally remain a multipart transport exception. */
export function uploadTeamAvatar(teamId: string, file: File) {
  const formData = new FormData()
  formData.append('avatar', file)
  return apiClient.mutate<{ avatar: string; fileId?: string }>(`/api/teams/${encodeURIComponent(teamId)}/avatar`, 'POST', formData)
}
