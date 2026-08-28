import type { AppRole } from './roleAccess'

export type AccountCapability =
  | 'enter-global-workspace'
  | 'enter-personal-workspace'
  | 'enter-organization-workspace'
  | 'view-all-submissions'
  | 'manage-platform-secrets'
  | 'manage-organization'

const roleCapabilities: Record<AppRole, ReadonlySet<AccountCapability>> = {
  super_admin: new Set([
    'enter-global-workspace',
    'view-all-submissions',
    'manage-platform-secrets',
  ]),
  platform_admin: new Set([
    'enter-global-workspace',
    'view-all-submissions',
  ]),
  school_principal: new Set([
    'enter-personal-workspace',
    'enter-organization-workspace',
    'manage-organization',
  ]),
  teacher: new Set([
    'enter-personal-workspace',
    'enter-organization-workspace',
  ]),
  student: new Set([
    'enter-personal-workspace',
    'enter-organization-workspace',
  ]),
}

function isAppRole(role: string | null | undefined): role is AppRole {
  return Boolean(role && role in roleCapabilities)
}

/**
 * Account-level UI capabilities only.
 * Resource ownership and activity permissions remain server-authoritative.
 */
export function hasAccountCapability(
  role: string | null | undefined,
  capability: AccountCapability,
): boolean {
  return isAppRole(role) && roleCapabilities[role].has(capability)
}

export function isGlobalAdministrator(role: string | null | undefined): boolean {
  return hasAccountCapability(role, 'enter-global-workspace')
}

export function accountCapabilities(role: string | null | undefined): AccountCapability[] {
  return isAppRole(role) ? [...roleCapabilities[role]] : []
}
