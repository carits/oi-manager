import type { JwtPayload } from '@oi-manager/shared'

export function hasOrganizationContext(user: JwtPayload | undefined, organizationId: string) {
  return Boolean(
    user
    && Boolean(user.organizationId)
    && user.organizationId === organizationId
    && user.organizationMembershipId,
  )
}

export function hasOrganizationWalletAccess(user: JwtPayload | undefined, organizationId: string) {
  return hasOrganizationContext(user, organizationId) && (user?.organizationRole === 'school_principal' || user?.organizationRole === 'teacher')
}

export function isPlatformAdministrator(user: JwtPayload | undefined) {
  return user?.accountRole === 'platform_admin' || user?.accountRole === 'super_admin'
}
