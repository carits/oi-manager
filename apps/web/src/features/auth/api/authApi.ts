import {
  AuthContracts,
  type ProfileUpdate,
} from '@oi-manager/contracts'
import { accountClient, organizationClient } from '@/lib/apiClient'

export function loginAccount(username: string, password: string) {
  return accountClient.mutateContract(AuthContracts.login, '/api/auth/login', {
    username,
    password,
  })
}

export function loadCurrentAccount(organizationId?: string) {
  const client = organizationId ? organizationClient(organizationId) : accountClient
  return client.queryContract(AuthContracts.me, '/api/auth/me', { retry: false })
}

export function logoutAccount() {
  return accountClient.mutateContract(AuthContracts.logout, '/api/auth/logout', {})
}

export function updateAccountProfile(input: ProfileUpdate) {
  return accountClient.mutateContract(AuthContracts.updateProfile, '/api/auth/profile', input)
}

export function changeAccountPassword(currentPassword: string, newPassword: string) {
  return accountClient.mutateContract(AuthContracts.changePassword, '/api/auth/password', {
    currentPassword,
    newPassword,
  })
}

export function revokeOtherSessions() {
  return accountClient.mutateContract(AuthContracts.revokeSessions, '/api/auth/sessions/revoke', {})
}
