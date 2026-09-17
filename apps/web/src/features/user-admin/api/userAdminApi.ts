import { IdentityContracts, type EndpointBody, type ManagedUser } from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

export type { ManagedUser }
const encoded = (value: string) => encodeURIComponent(value)

export function listManagedUsers(query: { role?: string; status?: string; keyword?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams({ page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20) })
  if (query.role) params.set('role', query.role)
  if (query.status) params.set('status', query.status)
  if (query.keyword) params.set('keyword', query.keyword)
  return accountClient.queryContract(IdentityContracts.managedUsers, `/api/users?${params}`)
}
export const getManagedUser = (userId: string) => accountClient.queryContract(IdentityContracts.managedUser, `/api/users/${encoded(userId)}`)
export const createPlatformAdministrator = (body: EndpointBody<typeof IdentityContracts.createPlatformAdmin>) => accountClient.mutateContract(IdentityContracts.createPlatformAdmin, '/api/users/platform-admin', body)
export const updateManagedUserStatus = (userId: string, status: 'active' | 'disabled', reason = '') => accountClient.mutateContract(IdentityContracts.updateManagedUserStatus, `/api/users/${encoded(userId)}/status`, { status, reason })
export const resetManagedUserPassword = (userId: string, newPassword: string) => accountClient.mutateContract(IdentityContracts.resetManagedUserPassword, `/api/users/${encoded(userId)}/reset-password`, { newPassword })
