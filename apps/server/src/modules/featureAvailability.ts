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
  return hasOrganizationContext(user, organizationId) && (user?.role === 'school_principal' || user?.role === 'teacher')
}

export function isPlatformAdministrator(user: JwtPayload | undefined) {
  return user?.role === 'platform_admin' || user?.role === 'super_admin'
}
