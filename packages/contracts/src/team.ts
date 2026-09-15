import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, PaginationQuerySchema } from './http'

export const TeamMemberTypeSchema = z.enum(['teacher', 'student', 'user'])
export type TeamMemberType = z.infer<typeof TeamMemberTypeSchema>
export const TeamMemberRoleSchema = z.enum(['owner', 'admin', 'member'])
export const TeamScopeSchema = z.enum(['campus', 'personal'])

export const TeamIdentitySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  username: z.string().optional(),
  avatar: z.string().nullable().optional(),
  type: TeamMemberTypeSchema.optional(),
  memberType: TeamMemberTypeSchema.optional(),
  adminType: TeamMemberTypeSchema.optional(),
  title: z.string().nullable().optional(),
  joinedAt: DateTimeWireSchema.nullable().optional(),
}).passthrough()
export type TeamIdentity = z.infer<typeof TeamIdentitySchema>

export const TeamSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  announcement: z.string().nullable().optional(),
  scope: TeamScopeSchema,
  isPublic: z.boolean(),
  createdAt: DateTimeWireSchema,
  school: z.object({ id: z.string().min(1), name: z.string().min(1) }).nullable().optional(),
  owner: z.object({
    id: z.string(), name: z.string(), username: z.string().optional(),
    avatar: z.string().nullable().optional(), type: TeamMemberTypeSchema.optional(),
    title: z.string().nullable().optional(),
  }).nullable().optional(),
  _count: z.object({
    members: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative().optional(),
    teacherMembers: z.number().int().nonnegative().optional(),
  }).optional(),
  requestStatus: z.string().nullable().optional(),
  invitationId: z.string().optional(),
  invitationType: z.enum(['admin', 'member']).optional(),
  invitedAt: DateTimeWireSchema.optional(),
  requestId: z.string().optional(),
}).passthrough()
export type TeamSummary = z.infer<typeof TeamSummarySchema>

export const TeamDetailSchema = TeamSummarySchema.extend({
  announcement: z.string().nullable().optional(),
  ownerType: z.string().optional(),
  admins: z.array(TeamIdentitySchema),
  students: z.array(TeamIdentitySchema),
  teachers: z.array(TeamIdentitySchema).optional(),
  pendingRequests: z.array(TeamIdentitySchema.extend({
    memberId: z.string().min(1),
    requestedAt: DateTimeWireSchema.nullable().optional(),
  })).optional(),
}).passthrough()
export type TeamDetail = z.infer<typeof TeamDetailSchema>

export const TeamInvitationSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  teamName: z.string(),
  teamAvatar: z.string().nullable().optional(),
  schoolName: z.string(),
  memberCount: z.number().int().nonnegative(),
  ownerName: z.string(),
  invitedBy: z.string().optional(),
  invitedAt: DateTimeWireSchema,
  role: TeamMemberRoleSchema.optional(),
  isPublic: z.boolean().optional(),
  type: z.string().optional(),
}).passthrough()
export type TeamInvitation = z.infer<typeof TeamInvitationSchema>

export const TeamJoinRequestSchema = z.object({
  id: z.string().min(1),
  message: z.string().nullable().optional(),
  createdAt: DateTimeWireSchema,
  user: TeamIdentitySchema.extend({ userType: TeamMemberTypeSchema.optional() }).nullable().optional(),
}).passthrough()
export type TeamJoinRequest = z.infer<typeof TeamJoinRequestSchema>

export const TeamPendingInviteSchema = z.object({
  id: z.string().min(1),
  type: TeamMemberTypeSchema,
  role: TeamMemberRoleSchema,
  invitedAt: DateTimeWireSchema,
  invitedByName: z.string(),
  user: TeamIdentitySchema.nullable(),
})
export type TeamPendingInvite = z.infer<typeof TeamPendingInviteSchema>

const TeamListDataSchema = z.object({
  data: z.array(TeamSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  summary: z.object({ memberCount: z.number().int().nonnegative() }).optional(),
})

const TeamActionSchema = z.object({ message: z.string().optional() }).passthrough()
const EmptyBodySchema = z.object({})

export const TeamContracts = {
  list: defineApiEndpoint({
    key: 'team.list', method: 'GET', scope: 'context', data: TeamListDataSchema,
    query: PaginationQuerySchema.extend({
      organizationId: z.string().optional(),
      schoolId: z.string().optional(),
      view: z.enum(['mine', 'all', 'managed']).optional(),
      keyword: z.string().trim().max(100).optional(),
    }).default({ page: 1, pageSize: 12 }),
  }),
  mine: defineApiEndpoint({
    key: 'team.mine', method: 'GET', scope: 'context',
    data: z.object({
      joined: z.array(TeamSummarySchema),
      pending: z.array(TeamSummarySchema),
      requests: z.array(TeamSummarySchema),
    }),
  }),
  detail: defineApiEndpoint({ key: 'team.detail', method: 'GET', scope: 'context', data: TeamDetailSchema }),
  create: defineApiEndpoint({
    key: 'team.create', method: 'POST', scope: 'context', data: TeamSummarySchema,
    body: z.object({
      id: z.string().min(2).max(50).regex(/^[A-Za-z0-9_]+$/),
      name: z.string().trim().min(1).max(100),
      description: z.string().max(500).optional(),
      isPublic: z.boolean().default(true),
    }),
  }),
  update: defineApiEndpoint({
    key: 'team.update', method: 'PUT', scope: 'context', data: TeamSummarySchema,
    body: z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().max(500).optional(), isPublic: z.boolean().optional() }),
  }),
  announcement: defineApiEndpoint({
    key: 'team.announcement', method: 'PUT', scope: 'context', data: TeamSummarySchema,
    body: z.object({ announcement: z.string().max(2000).nullable().optional() }),
  }),
  transfer: defineApiEndpoint({
    key: 'team.transfer', method: 'POST', scope: 'context', data: TeamActionSchema,
    body: z.object({ newOwnerId: z.string().min(1), newOwnerType: TeamMemberTypeSchema }),
  }),
  leave: defineApiEndpoint({ key: 'team.leave', method: 'POST', scope: 'context', data: TeamActionSchema, body: EmptyBodySchema }),
  delete: defineApiEndpoint({ key: 'team.delete', method: 'DELETE', scope: 'context', data: TeamActionSchema }),
  joinRequest: defineApiEndpoint({
    key: 'team.join-request.create', method: 'POST', scope: 'context', data: z.object({ id: z.string().min(1) }).passthrough(),
    body: z.object({ message: z.string().max(500).optional() }),
  }),
  joinRequests: defineApiEndpoint({ key: 'team.join-request.list', method: 'GET', scope: 'context', data: z.array(TeamJoinRequestSchema) }),
  decideJoinRequest: defineApiEndpoint({ key: 'team.join-request.decide', method: 'POST', scope: 'context', data: TeamActionSchema, body: EmptyBodySchema }),
  availableMembers: defineApiEndpoint({
    key: 'team.available-members', method: 'GET', scope: 'context',
    data: z.object({ teachers: z.array(TeamIdentitySchema), students: z.array(TeamIdentitySchema), users: z.array(TeamIdentitySchema).optional() }),
    query: z.object({ keyword: z.string().trim().max(100).optional(), type: TeamMemberTypeSchema.optional() }),
  }),
  inviteMembers: defineApiEndpoint({
    key: 'team.members.invite', method: 'POST', scope: 'context',
    data: z.object({ invited: z.array(z.string()), notFound: z.array(z.string()), notSameSchool: z.array(z.string()), alreadyMember: z.array(z.string()) }),
    body: z.object({
      members: z.array(z.object({ userId: z.string().min(1), userType: TeamMemberTypeSchema, role: TeamMemberRoleSchema.optional() })).max(50).optional(),
      usernames: z.array(z.string().min(1)).max(50).optional(),
      role: TeamMemberRoleSchema.optional(),
    }).refine(value => Boolean(value.members?.length || value.usernames?.length), '必须提供 members 或 usernames'),
  }),
  removeMember: defineApiEndpoint({ key: 'team.members.remove', method: 'DELETE', scope: 'context', data: TeamActionSchema, query: z.object({ memberType: TeamMemberTypeSchema.optional() }) }),
  setAdmin: defineApiEndpoint({ key: 'team.members.set-admin', method: 'POST', scope: 'context', data: TeamActionSchema, body: z.object({ memberId: z.string().min(1), memberType: TeamMemberTypeSchema.optional() }) }),
  pendingInvites: defineApiEndpoint({ key: 'team.invites.pending', method: 'GET', scope: 'context', data: z.array(TeamPendingInviteSchema) }),
  cancelInvite: defineApiEndpoint({ key: 'team.invites.cancel', method: 'DELETE', scope: 'context', data: TeamActionSchema }),
  invitations: defineApiEndpoint({ key: 'team.invitations.mine', method: 'GET', scope: 'context', data: z.array(TeamInvitationSchema) }),
  adminInvitations: defineApiEndpoint({ key: 'team.invitations.admin', method: 'GET', scope: 'context', data: z.array(TeamInvitationSchema), query: z.object({ organizationId: z.string().optional() }) }),
  memberInvitations: defineApiEndpoint({ key: 'team.invitations.member', method: 'GET', scope: 'context', data: z.array(TeamInvitationSchema) }),
  respondInvitation: defineApiEndpoint({ key: 'team.invitations.respond', method: 'POST', scope: 'context', data: TeamActionSchema, body: EmptyBodySchema }),
} as const
