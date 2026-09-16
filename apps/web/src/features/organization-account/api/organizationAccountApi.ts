import { OrganizationContracts, type EndpointBody, type OrganizationManagedInvitation, type OrganizationManagedJoinApplication } from '@oi-manager/contracts'
import { accountClient, apiClient } from '@/lib/apiClient'

const encoded = (value: string) => encodeURIComponent(value)

export type OrganizationJoinApplication = OrganizationManagedJoinApplication
export type OrganizationInvitation = OrganizationManagedInvitation
export type OrganizationTeacherOption = { membershipId: string; name: string }
export type JoinDecisionBody = EndpointBody<typeof OrganizationContracts.decideJoinApplication>
export type InvitationBody = EndpointBody<typeof OrganizationContracts.createManagedInvitation>

export const getMyOrganizations = () => accountClient.queryContract(OrganizationContracts.mine, '/api/me/organizations')
export const searchOrganizations = (query: string) => accountClient.queryContract(OrganizationContracts.directory, `/api/organizations?q=${encoded(query)}&page=1&pageSize=50`)
export const getMyOrganizationCreationApplications = () => accountClient.queryContract(OrganizationContracts.listMyCreationApplications, '/api/me/organization-creation-applications?page=1&pageSize=20')
export const createOrganizationJoinApplication = (body: EndpointBody<typeof OrganizationContracts.createJoinApplication>) => accountClient.mutateContract(OrganizationContracts.createJoinApplication, '/api/organization-join-applications', body)
export const cancelOrganizationJoinApplication = (id: string) => accountClient.mutateContract(OrganizationContracts.cancelJoinApplication, `/api/organization-join-applications/${encoded(id)}/cancel`, {})
export const respondOrganizationInvitation = (id: string, action: 'accept' | 'decline') => accountClient.mutateContract(OrganizationContracts.respondInvitation, `/api/organization-invitations/${encoded(id)}/${action}`, {})
export const createOrganizationApplication = (body: EndpointBody<typeof OrganizationContracts.createOrganizationApplication>, idempotencyKey: string) => accountClient.mutateContract(OrganizationContracts.createOrganizationApplication, '/api/organization-creation-applications', body, { headers: { 'Idempotency-Key': idempotencyKey } })
export const cancelOrganizationApplication = (id: string, idempotencyKey: string) => accountClient.mutateContract(OrganizationContracts.cancelOrganizationApplication, `/api/organization-creation-applications/${encoded(id)}/cancel`, {}, { headers: { 'Idempotency-Key': idempotencyKey } })
export const getOrganizationJoinApplications = (organizationId: string) => apiClient.queryContract(OrganizationContracts.managedJoinApplications, `/api/organizations/${encoded(organizationId)}/join-applications?page=1&pageSize=50`)
export const decideOrganizationJoinApplication = (organizationId: string, applicationId: string, decision: 'approve' | 'reject', body: JoinDecisionBody) => apiClient.mutateContract(OrganizationContracts.decideJoinApplication, `/api/organizations/${encoded(organizationId)}/join-applications/${encoded(applicationId)}/${decision}`, body)
export const getOrganizationInvitations = (organizationId: string) => apiClient.queryContract(OrganizationContracts.managedInvitations, `/api/organizations/${encoded(organizationId)}/invitations?page=1&pageSize=50`)
export const createOrganizationInvitation = (organizationId: string, body: InvitationBody) => apiClient.mutateContract(OrganizationContracts.createManagedInvitation, `/api/organizations/${encoded(organizationId)}/invitations`, body)
export const revokeOrganizationInvitation = (organizationId: string, invitationId: string) => apiClient.mutateContract(OrganizationContracts.revokeManagedInvitation, `/api/organizations/${encoded(organizationId)}/invitations/${encoded(invitationId)}/revoke`, {})
export const getOrganizationCampus = (organizationId: string) => apiClient.queryContract(OrganizationContracts.campusSummary, `/api/organizations/${encoded(organizationId)}/members/campus`)
export const updateOrganizationCampus = (organizationId: string, body: EndpointBody<typeof OrganizationContracts.updateCampus>) => apiClient.mutateContract(OrganizationContracts.updateCampus, `/api/organizations/${encoded(organizationId)}/members/campus`, body)
export const updateOrganizationCampusAnnouncement = (organizationId: string, announcement: string) => apiClient.mutateContract(OrganizationContracts.updateCampusAnnouncement, `/api/organizations/${encoded(organizationId)}/members/campus/announcement`, { announcement })
export const getOrganizationTeacherOptions = (organizationId: string) => apiClient.queryContract(OrganizationContracts.teacherOptions, `/api/organizations/${encoded(organizationId)}/members/teachers?page=1&pageSize=100`)
export const getOrganizationStudentOptions = (organizationId: string, query: { page: number; pageSize: number; q?: string; grade?: string; teamId?: string }) => {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.q) params.set('q', query.q)
  if (query.grade) params.set('grade', query.grade)
  if (query.teamId) params.set('teamId', query.teamId)
  return apiClient.queryContract(OrganizationContracts.studentOptions, `/api/organizations/${encoded(organizationId)}/members/students?${params}`)
}
export const updateOrganizationJoinPolicy = (organizationId: string, joinPolicy: EndpointBody<typeof OrganizationContracts.updateJoinPolicy>['joinPolicy']) => apiClient.mutateContract(OrganizationContracts.updateJoinPolicy, `/api/organizations/${encoded(organizationId)}/join-policy`, { joinPolicy })
