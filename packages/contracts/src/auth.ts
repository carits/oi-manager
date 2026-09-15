import { z } from 'zod'
import {
  AccountRoleSchema,
  LegacyUserRoleSchema,
  OrganizationMembershipRoleSchema,
} from './identity'
import { defineApiEndpoint } from './http'

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  workspaceMode: z.enum(['work', 'personal']).optional(),
  mode: z.enum(['campus', 'personal']).optional(),
})
export type LoginRequestContract = z.infer<typeof LoginRequestSchema>

/** Browser authentication is Cookie-only. A bearer token is never returned. */
export const LoginResponseDataSchema = z.object({
  userId: z.string().min(1),
  accountRole: z.enum(['user', 'platform_admin', 'super_admin']),
  role: LegacyUserRoleSchema,
  username: z.string().min(1),
  workspaceMode: z.enum(['work', 'personal']),
  avatar: z.string().nullable().optional(),
  next: z.string().startsWith('/'),
})
export type LoginResponseData = z.infer<typeof LoginResponseDataSchema>

export const CurrentAccountSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  accountRole: AccountRoleSchema,
  role: LegacyUserRoleSchema,
  avatar: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  organizationId: z.string().min(1).optional(),
  organizationName: z.string().min(1).optional(),
  organizationMembershipId: z.string().min(1).optional(),
  organizationRole: OrganizationMembershipRoleSchema.optional(),
  schoolId: z.string().min(1).optional(),
  workspaceMode: z.enum(['work', 'personal']).optional(),
  profile: z.unknown().optional(),
  adminId: z.string().min(1).optional(),
})
export type CurrentAccount = z.infer<typeof CurrentAccountSchema>

export const AccountProfileSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  role: LegacyUserRoleSchema,
  avatar: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
})
export type AccountProfile = z.infer<typeof AccountProfileSchema>

const EmptyResultSchema = z.object({})
export const RegisterRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(6).max(256),
  role: z.literal('student').optional(),
})
export const ProfileUpdateSchema = z.object({
  avatar: z.string().nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
})
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>

export const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(6).max(256),
})

export const AuthContracts = {
  login: defineApiEndpoint({
    key: 'auth.login', method: 'POST', scope: 'account',
    data: LoginResponseDataSchema, body: LoginRequestSchema,
  }),
  register: defineApiEndpoint({
    key: 'auth.register', method: 'POST', scope: 'account',
    data: LoginResponseDataSchema, body: RegisterRequestSchema,
  }),
  me: defineApiEndpoint({
    key: 'auth.me', method: 'GET', scope: 'context', data: CurrentAccountSchema,
  }),
  logout: defineApiEndpoint({
    key: 'auth.logout', method: 'POST', scope: 'account',
    data: EmptyResultSchema, body: z.object({}),
  }),
  updateProfile: defineApiEndpoint({
    key: 'auth.profile.update', method: 'PUT', scope: 'account',
    data: AccountProfileSchema, body: ProfileUpdateSchema,
  }),
  changePassword: defineApiEndpoint({
    key: 'auth.password.change', method: 'PUT', scope: 'account',
    data: EmptyResultSchema, body: PasswordChangeSchema,
  }),
  revokeSessions: defineApiEndpoint({
    key: 'auth.sessions.revoke', method: 'POST', scope: 'account',
    data: EmptyResultSchema, body: z.object({}),
  }),
} as const
