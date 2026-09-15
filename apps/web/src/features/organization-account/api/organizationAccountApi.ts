import { OrganizationContracts, type EndpointBody } from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

const encoded = (value: string) => encodeURIComponent(value)

export const getMyOrganizations = () => accountClient.queryContract(OrganizationContracts.mine, '/api/me/organizations')
export const searchOrganizations = (query: string) => accountClient.queryContract(OrganizationContracts.directory, `/api/organizations?q=${encoded(query)}&page=1&pageSize=50`)
export const getMyOrganizationCreationApplications = () => accountClient.queryContract(OrganizationContracts.listMyCreationApplications, '/api/me/organization-creation-applications?page=1&pageSize=20')
export const createOrganizationJoinApplication = (body: EndpointBody<typeof OrganizationContracts.createJoinApplication>) => accountClient.mutateContract(OrganizationContracts.createJoinApplication, '/api/organization-join-applications', body)
export const cancelOrganizationJoinApplication = (id: string) => accountClient.mutateContract(OrganizationContracts.cancelJoinApplication, `/api/organization-join-applications/${encoded(id)}/cancel`, {})
export const respondOrganizationInvitation = (id: string, action: 'accept' | 'decline') => accountClient.mutateContract(OrganizationContracts.respondInvitation, `/api/organization-invitations/${encoded(id)}/${action}`, {})
export const createOrganizationApplication = (body: EndpointBody<typeof OrganizationContracts.createOrganizationApplication>, idempotencyKey: string) => accountClient.mutateContract(OrganizationContracts.createOrganizationApplication, '/api/organization-creation-applications', body, { headers: { 'Idempotency-Key': idempotencyKey } })
export const cancelOrganizationApplication = (id: string, idempotencyKey: string) => accountClient.mutateContract(OrganizationContracts.cancelOrganizationApplication, `/api/organization-creation-applications/${encoded(id)}/cancel`, {}, { headers: { 'Idempotency-Key': idempotencyKey } })
