import { z } from 'zod'
import { defineApiEndpoint } from './http'

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

/**
 * Converts the persisted compatibility role into the account-wide identity.
 * Historical student/teacher/principal values describe an organization job,
 * never an account-level privilege.
 */
export function accountRoleFromLegacy(role: LegacyUserRole): AccountRole {
  return role === 'platform_admin' || role === 'super_admin' ? role : 'user'
}

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

export const ProfileUserTypeSchema = z.enum(['teacher', 'student', 'user'])
export type ProfileUserType = z.infer<typeof ProfileUserTypeSchema>

export const PublicUserProfileQuerySchema = z.object({
  userType: ProfileUserTypeSchema.default('user'),
})

export const PublicUserProfileSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1).optional(),
  name: z.string().nullable().optional(),
  username: z.string().min(1),
  avatar: z.string().nullable(),
  bio: z.string().nullable(),
  userType: ProfileUserTypeSchema,
  school: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }).nullable().optional(),
})
export type PublicUserProfile = z.infer<typeof PublicUserProfileSchema>

export const IdentityContracts = {
  publicProfile: defineApiEndpoint({
    key: 'identity.publicProfile',
    method: 'GET',
    scope: 'context',
    query: PublicUserProfileQuerySchema,
    data: PublicUserProfileSchema,
  }),
} as const

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
