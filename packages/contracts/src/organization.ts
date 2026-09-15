import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, PaginationQuerySchema } from './http'

export const OrganizationJoinPolicySchema = z.enum(['invite_only', 'approval', 'closed'])
export const OrganizationRelationshipSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['membership', 'application', 'invitation']),
  status: z.string().min(1),
  memberRole: z.string().optional(),
}).passthrough()

export const OrganizationDirectoryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().nullable().optional(),
  type: z.literal('school').optional(),
  region: z.string().nullable().optional(),
  schoolType: z.string().nullable().optional(),
  schoolNature: z.string().nullable().optional(),
  joinPolicy: OrganizationJoinPolicySchema,
  relationship: OrganizationRelationshipSchema.nullable().optional(),
})
export type OrganizationDirectoryItem = z.infer<typeof OrganizationDirectoryItemSchema>

export const OrganizationDirectoryPageSchema = z.object({
  items: z.array(OrganizationDirectoryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})

const OrganizationRelationSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  memberRole: z.string().optional(),
  requestedRole: z.string().optional(),
  createdAt: DateTimeWireSchema,
  Organization: z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
}).passthrough()
export type OrganizationRelation = z.infer<typeof OrganizationRelationSchema>

const JoinApplicationActionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  requestedRole: z.enum(['student', 'teacher']),
  requestedRelationType: z.enum(['enrolled', 'preselected', 'employee', 'external_coach']),
  realName: z.string().min(1),
  status: z.string().min(1),
  createdAt: DateTimeWireSchema,
}).passthrough()

export const MyOrganizationsSchema = z.object({
  memberships: z.array(OrganizationRelationSchema),
  applications: z.array(OrganizationRelationSchema),
  invitations: z.array(OrganizationRelationSchema),
})
export type MyOrganizations = z.infer<typeof MyOrganizationsSchema>

export const OrganizationCreationApplicationStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled'])
export const OrganizationCreationApplicationSchema = z.object({
  id: z.string().min(1),
  organizationType: z.literal('school'),
  name: z.string().min(1),
  shortName: z.string().nullable().optional(),
  region: z.string().min(1),
  schoolType: z.string().min(1),
  schoolNature: z.string().nullable().optional(),
  educationSystem: z.string().min(1),
  applicantRealName: z.string().min(1),
  applicantTitle: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  description: z.string(),
  evidenceData: z.unknown().optional(),
  status: OrganizationCreationApplicationStatusSchema,
  reviewedAt: DateTimeWireSchema.nullable().optional(),
  decisionMessage: z.string().nullable().optional(),
  createdOrganizationId: z.string().nullable().optional(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
})
export type OrganizationCreationApplication = z.infer<typeof OrganizationCreationApplicationSchema>

export const OrganizationCreationApplicationPageSchema = z.object({
  items: z.array(OrganizationCreationApplicationSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
})

const CreationBodySchema = z.object({
  organizationType: z.literal('school').default('school'),
  name: z.string().trim().min(2).max(100),
  shortName: z.string().trim().max(30).optional(),
  schoolType: z.enum(['小学', '初中', '高中', '小学+初中', '初中+高中', '小学+初中+高中']),
  schoolNature: z.enum(['公办', '民办', '其他']).or(z.literal('')).optional(),
  region: z.string().trim().min(5).max(120),
  educationSystem: z.enum(['6-3-3', '5-4-3']),
  applicantRealName: z.string().trim().min(2).max(80),
  applicantTitle: z.string().trim().max(80).optional(),
  contactPerson: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  contactEmail: z.string().trim().max(160).optional(),
  description: z.string().trim().min(20).max(2000),
  evidenceNote: z.string().trim().max(2000).optional(),
})

export const OrganizationContracts = {
  directory: defineApiEndpoint({
    key: 'organization.directory', method: 'GET', scope: 'account', data: OrganizationDirectoryPageSchema,
    query: PaginationQuerySchema.extend({ q: z.string().trim().max(100).default('') }),
  }),
  mine: defineApiEndpoint({
    key: 'organization.mine', method: 'GET', scope: 'account', data: MyOrganizationsSchema,
  }),
  createJoinApplication: defineApiEndpoint({
    key: 'organization.join.create', method: 'POST', scope: 'account', data: JoinApplicationActionSchema,
    body: z.discriminatedUnion('requestedRole', [
      z.object({
        organizationId: z.string().min(1), requestedRole: z.literal('student'),
        requestedRelationType: z.enum(['enrolled', 'preselected']).default('enrolled'),
        realName: z.string().trim().min(1).max(80), profileData: z.record(z.string(), z.unknown()).optional(),
        message: z.string().trim().max(1000).optional(),
      }),
      z.object({
        organizationId: z.string().min(1), requestedRole: z.literal('teacher'),
        requestedRelationType: z.enum(['employee', 'external_coach']).default('employee'),
        realName: z.string().trim().min(1).max(80), profileData: z.record(z.string(), z.unknown()).optional(),
        message: z.string().trim().max(1000).optional(),
      }),
    ]),
  }),
  cancelJoinApplication: defineApiEndpoint({
    key: 'organization.join.cancel', method: 'POST', scope: 'account', data: z.object({ cancelled: z.literal(true) }),
    body: z.object({}),
  }),
  respondInvitation: defineApiEndpoint({
    key: 'organization.invitation.respond', method: 'POST', scope: 'account',
    data: z.object({ status: z.enum(['accepted', 'declined']), membershipId: z.string().optional(), organizationId: z.string().optional() }),
    body: z.object({}),
  }),
  listMyCreationApplications: defineApiEndpoint({
    key: 'organization.creation.mine', method: 'GET', scope: 'account', data: OrganizationCreationApplicationPageSchema,
    query: PaginationQuerySchema,
  }),
  createOrganizationApplication: defineApiEndpoint({
    key: 'organization.creation.create', method: 'POST', scope: 'account', data: OrganizationCreationApplicationSchema,
    body: CreationBodySchema,
  }),
  cancelOrganizationApplication: defineApiEndpoint({
    key: 'organization.creation.cancel', method: 'POST', scope: 'account', data: OrganizationCreationApplicationSchema,
    body: z.object({}),
  }),
} as const
