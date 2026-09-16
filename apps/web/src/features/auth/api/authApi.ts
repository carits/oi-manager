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

export async function uploadAccountAvatar(file: File) {
  const formData = new FormData()
  formData.append('avatar', file)
  const response = await accountClient.postFile<unknown>('/api/auth/avatar', formData)
  if (!response.success) return response
  const parsed = AuthContracts.uploadAvatar.data.safeParse(response.data)
  if (!parsed.success) return {
    success: false as const,
    status: response.status,
    message: '服务器返回的头像信息无效',
    errorKind: 'invalid_response' as const,
    requestId: response.requestId,
  }
  return { ...response, data: parsed.data }
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
