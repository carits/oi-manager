import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, PaginationQuerySchema } from './http'

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

export const ManagedUserSchema = z.object({
  id: z.string().min(1), username: z.string().min(1), name: z.string().optional(), accountRole: AccountRoleSchema,
  status: z.enum(['active', 'disabled']), avatar: z.string().nullable().optional(), phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(), bio: z.string().nullable().optional(), createdAt: DateTimeWireSchema,
  profile: z.object({ name: z.string(), schoolName: z.string().optional(), teamName: z.string().optional() }).optional(),
})
export type ManagedUser = z.infer<typeof ManagedUserSchema>

const ManagedUserPageSchema = z.object({
  users: z.array(ManagedUserSchema), page: z.number().int().positive(), pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
})

export const IdentityContracts = {
  publicProfile: defineApiEndpoint({
    key: 'identity.publicProfile',
    method: 'GET',
    scope: 'context',
    query: PublicUserProfileQuerySchema,
    data: PublicUserProfileSchema,
  }),
  managedUsers: defineApiEndpoint({
    key: 'identity.managedUsers', method: 'GET', scope: 'account',
    query: PaginationQuerySchema.extend({ accountRole: AccountRoleSchema.optional(), status: z.enum(['active', 'disabled']).optional(), keyword: z.string().trim().max(100).optional() }),
    data: ManagedUserPageSchema,
  }),
  managedUser: defineApiEndpoint({ key: 'identity.managedUser', method: 'GET', scope: 'account', data: ManagedUserSchema }),
  createPlatformAdmin: defineApiEndpoint({
    key: 'identity.platformAdmin.create', method: 'POST', scope: 'account',
    body: z.object({ username: z.string().trim().min(3).max(80), password: z.string().min(6).max(200), name: z.string().trim().min(1).max(80), phone: z.string().max(30).optional(), email: z.string().max(160).optional(), bio: z.string().max(2000).optional() }),
    data: z.object({ userId: z.string().min(1), username: z.string(), accountRole: z.literal('platform_admin') }),
  }),
  updateManagedUserStatus: defineApiEndpoint({
    key: 'identity.managedUser.status', method: 'PUT', scope: 'account',
    body: z.object({ status: z.enum(['active', 'disabled']), reason: z.string().max(1000).default('') }),
    data: z.object({ userId: z.string().min(1), status: z.enum(['active', 'disabled']) }),
  }),
  resetManagedUserPassword: defineApiEndpoint({
    key: 'identity.managedUser.password.reset', method: 'POST', scope: 'account',
    body: z.object({ newPassword: z.string().min(6).max(200) }), data: z.object({ reset: z.literal(true) }),
  }),
} as const

const accountCapabilities: Record<AccountRole, ReadonlySet<WorkspaceCapability>> = {
  user: new Set(['enter-personal-workspace']),
  super_admin: new Set(['enter-global-workspace', 'view-all-submissions', 'manage-platform-secrets']),
  platform_admin: new Set(['enter-global-workspace', 'view-all-submissions']),
}

export function hasWorkspaceCapability(
  accountRole: unknown,
  capability: WorkspaceCapability,
): boolean {
  const parsed = AccountRoleSchema.safeParse(accountRole)
  return parsed.success && accountCapabilities[parsed.data].has(capability)
}

export function workspaceCapabilitiesFor(accountRole: unknown): WorkspaceCapability[] {
  const parsed = AccountRoleSchema.safeParse(accountRole)
  return parsed.success ? [...accountCapabilities[parsed.data]] : []
}
