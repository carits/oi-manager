import { z } from 'zod'

/** Global account identity. Organization jobs must never be stored here. */
export const AccountRoleSchema = z.enum(['user', 'platform_admin', 'super_admin'])
export type AccountRole = z.infer<typeof AccountRoleSchema>

/** A user's role inside one organization. This is not a global account role. */
export const OrganizationMembershipRoleSchema = z.enum([
  'student',
  'teacher',
  'school_principal',
])
export type OrganizationMembershipRole = z.infer<typeof OrganizationMembershipRoleSchema>

/** Compatibility union for persisted records and old clients during cutover. */
export const LegacyUserRoleSchema = z.union([
  AccountRoleSchema,
  OrganizationMembershipRoleSchema,
])
export type LegacyUserRole = z.infer<typeof LegacyUserRoleSchema>

export const WorkspaceContextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('personal') }),
  z.object({ type: z.literal('platform') }),
  z.object({
    type: z.literal('organization'),
    organizationId: z.string().min(1),
    membershipId: z.string().min(1),
    membershipRole: OrganizationMembershipRoleSchema,
  }),
])
export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>

export const WorkspaceCapabilitySchema = z.enum([
  'enter-global-workspace',
  'enter-personal-workspace',
  'enter-organization-workspace',
  'view-all-submissions',
  'manage-platform-secrets',
  'manage-organization',
])
export type WorkspaceCapability = z.infer<typeof WorkspaceCapabilitySchema>

const workspaceCapabilities: Record<LegacyUserRole, ReadonlySet<WorkspaceCapability>> = {
  user: new Set(['enter-personal-workspace']),
  super_admin: new Set(['enter-global-workspace', 'view-all-submissions', 'manage-platform-secrets']),
  platform_admin: new Set(['enter-global-workspace', 'view-all-submissions']),
  school_principal: new Set(['enter-personal-workspace', 'enter-organization-workspace', 'manage-organization']),
  teacher: new Set(['enter-personal-workspace', 'enter-organization-workspace']),
  student: new Set(['enter-personal-workspace', 'enter-organization-workspace']),
}

export function isLegacyUserRole(value: unknown): value is LegacyUserRole {
  return LegacyUserRoleSchema.safeParse(value).success
}

export function hasWorkspaceCapability(
  role: unknown,
  capability: WorkspaceCapability,
): boolean {
  return isLegacyUserRole(role) && workspaceCapabilities[role].has(capability)
}

export function workspaceCapabilitiesFor(role: unknown): WorkspaceCapability[] {
  return isLegacyUserRole(role) ? [...workspaceCapabilities[role]] : []
}
