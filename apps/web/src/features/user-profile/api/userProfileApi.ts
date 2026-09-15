import { IdentityContracts, type ProfileUserType } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function getPublicUserProfile(userId: string, userType: ProfileUserType) {
  return apiClient.queryContract(
    IdentityContracts.publicProfile,
    `/api/users/${encodeURIComponent(userId)}/profile?userType=${encodeURIComponent(userType)}`,
  )
}
