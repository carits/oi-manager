import {
  hasWorkspaceCapability,
  workspaceCapabilitiesFor,
  type WorkspaceCapability,
} from '@oi-manager/contracts'

export type AccountCapability = WorkspaceCapability

/**
 * Account-level UI capabilities only.
 * Resource ownership and activity permissions remain server-authoritative.
 */
export function hasAccountCapability(
  role: string | null | undefined,
  capability: AccountCapability,
): boolean {
  return hasWorkspaceCapability(role, capability)
}

export function isGlobalAdministrator(role: string | null | undefined): boolean {
  return hasAccountCapability(role, 'enter-global-workspace')
}

export function accountCapabilities(role: string | null | undefined): AccountCapability[] {
  return workspaceCapabilitiesFor(role)
}
