import {
  OrganizationContracts,
  type EndpointBody,
  type PlatformOrganizationCreationApplication,
  type PlatformSchool,
  type PlatformSchoolStudent,
  type PlatformSchoolTeacher,
} from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

const encoded = (value: string) => encodeURIComponent(value)

export type { PlatformOrganizationCreationApplication, PlatformSchool, PlatformSchoolStudent, PlatformSchoolTeacher }

export function getPlatformSchools(query: { page?: number; pageSize?: number; directoryStatus?: PlatformSchool['directoryStatus']; q?: string } = {}) {
  const params = new URLSearchParams({ page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20) })
  if (query.directoryStatus) params.set('directoryStatus', query.directoryStatus)
  if (query.q) params.set('q', query.q)
  return accountClient.queryContract(OrganizationContracts.platformSchools, `/api/platform/organizations?${params}`)
}

export const getPlatformSchool = (organizationId: string) => accountClient.queryContract(OrganizationContracts.platformSchool, `/api/platform/organizations/${encoded(organizationId)}`)
export const createPlatformSchool = (body: EndpointBody<typeof OrganizationContracts.createPlatformSchool>) => accountClient.mutateContract(OrganizationContracts.createPlatformSchool, '/api/platform/organizations', body)
export const updatePlatformSchool = (organizationId: string, body: EndpointBody<typeof OrganizationContracts.updatePlatformSchool>) => accountClient.mutateContract(OrganizationContracts.updatePlatformSchool, `/api/platform/organizations/${encoded(organizationId)}`, body)
export const updatePlatformSchoolDirectoryStatus = (organizationId: string, body: EndpointBody<typeof OrganizationContracts.updatePlatformSchoolDirectoryStatus>) => accountClient.mutateContract(OrganizationContracts.updatePlatformSchoolDirectoryStatus, `/api/platform/organizations/${encoded(organizationId)}/directory-status`, body)

export function getPlatformSchoolStudents(organizationId: string, page = 1, pageSize = 20) {
  return accountClient.queryContract(OrganizationContracts.platformSchoolStudents, `/api/platform/organizations/${encoded(organizationId)}/students?page=${page}&pageSize=${pageSize}`)
}

export function getPlatformSchoolTeachers(organizationId: string, page = 1, pageSize = 20) {
  return accountClient.queryContract(OrganizationContracts.platformSchoolTeachers, `/api/platform/organizations/${encoded(organizationId)}/teachers?page=${page}&pageSize=${pageSize}`)
}

export const createPlatformSchoolPrincipal = (organizationId: string, body: EndpointBody<typeof OrganizationContracts.createPlatformSchoolPrincipal>) => accountClient.mutateContract(OrganizationContracts.createPlatformSchoolPrincipal, `/api/platform/organizations/${encoded(organizationId)}/principal`, body)
export const transferPlatformSchoolPrincipal = (organizationId: string, membershipId: string) => accountClient.mutateContract(OrganizationContracts.transferPlatformSchoolPrincipal, `/api/platform/organizations/${encoded(organizationId)}/principal`, { membershipId })

export function getPlatformOrganizationCreationApplications(query: { status?: string; q?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams({ page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20) })
  if (query.status) params.set('status', query.status)
  if (query.q) params.set('q', query.q)
  return accountClient.queryContract(OrganizationContracts.platformCreationApplications, `/api/platform/organization-creation-applications?${params}`)
}

export const getPlatformOrganizationCreationApplication = (applicationId: string) => accountClient.queryContract(OrganizationContracts.platformCreationApplication, `/api/platform/organization-creation-applications/${encoded(applicationId)}`)
export const decidePlatformOrganizationCreationApplication = (applicationId: string, action: 'approve' | 'reject', body: EndpointBody<typeof OrganizationContracts.decidePlatformCreationApplication>, idempotencyKey: string) => accountClient.mutateContract(OrganizationContracts.decidePlatformCreationApplication, `/api/platform/organization-creation-applications/${encoded(applicationId)}/${action}`, body, { headers: { 'Idempotency-Key': idempotencyKey } })
