import { z } from 'zod'
import { DateTimeWireSchema, PaginationQuerySchema, defineApiEndpoint, paginatedDataSchema } from './http'

const NullableDateSchema = DateTimeWireSchema.nullable()

export const ContributionRewardDeliverySchema = z.object({
  status: z.string(),
  userCarits: z.string().regex(/^\d+$/),
  organizationCarits: z.string().regex(/^\d+$/).optional(),
  attemptCount: z.number().int().nonnegative().optional(),
  errorMessage: z.string().nullable().optional(),
}).passthrough()

export const ContributionEventSchema = z.object({
  id: z.string(), type: z.string(), sourceType: z.string(), sourceId: z.string().optional(),
  score: z.number().int().nonnegative(), status: z.string(),
  occurredAt: DateTimeWireSchema.optional(), createdAt: DateTimeWireSchema.optional(),
  displayAt: DateTimeWireSchema.optional(), acceptedAt: NullableDateSchema.optional(),
  revokedAt: NullableDateSchema.optional(), revokeReason: z.string().nullable().optional(),
  ruleCode: z.string().optional(), ruleVersion: z.number().int().optional(),
  evidence: z.object({
    problemId: z.string().optional(),
    candidateId: z.string().optional(),
    promotedRevisionId: z.string().optional(),
    candidateSource: z.string().optional(),
    selectionMode: z.string().optional(),
    rewardCarits: z.string().optional(),
    organizationRewardCarits: z.string().optional(),
  }).passthrough().nullable().optional(),
  Actor: z.object({ username: z.string() }).optional(),
  Attribution: z.object({
    organizationId: z.string(), Organization: z.object({ name: z.string() }).nullable().optional(),
  }).nullable().optional(),
  RewardDelivery: ContributionRewardDeliverySchema.nullable().optional(),
}).passthrough()
export type ContributionEvent = z.infer<typeof ContributionEventSchema>

export const ContributionSummarySchema = z.object({
  eventCount: z.number().int().nonnegative(), contributionScore: z.number().int().nonnegative(), level: z.string(),
})
export type ContributionSummary = z.infer<typeof ContributionSummarySchema>

export const ContributionRankingRowSchema = z.object({
  id: z.string(), userId: z.string(), username: z.string(), avatar: z.string().nullable(), contributionScore: z.number().int().nonnegative(),
})

const EventPageSchema = paginatedDataSchema(ContributionEventSchema)
const RankingSchema = z.object({ items: z.array(ContributionRankingRowSchema) })
const OrganizationEventsSchema = z.object({ items: z.array(ContributionEventSchema) })
export const AuditContributionEventSchema = ContributionEventSchema.extend({
  createdAt: DateTimeWireSchema,
  Actor: z.object({ username: z.string() }),
})
export type AuditContributionEvent = z.infer<typeof AuditContributionEventSchema>
const AuditPageSchema = paginatedDataSchema(AuditContributionEventSchema).extend({ pending: z.number().int().nonnegative() })
export type ContributionAuditPage = z.infer<typeof AuditPageSchema>
const EmptyBodySchema = z.object({}).default({})
const ReasonBodySchema = z.object({ reason: z.string().trim().min(10).max(2000) })
const AuditQuerySchema = PaginationQuerySchema.extend({ status: z.enum(['pending', 'accepted', 'rejected', 'revoked']).optional() })
const EvidenceQuerySchema = z.object({ kind: z.enum(['candidate', 'revision']) })
const EvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('candidate'), problemId: z.string(), candidate: z.object({ id: z.string() }).passthrough() }),
  z.object({ kind: z.literal('revision'), problemId: z.string(), revision: z.object({ id: z.string() }).passthrough() }),
])
export type ContributionEvidence = z.infer<typeof EvidenceSchema>

export const ContributionContracts = {
  summary: defineApiEndpoint({ key: 'contribution.summary', method: 'GET', scope: 'account', data: ContributionSummarySchema }),
  mine: defineApiEndpoint({ key: 'contribution.mine', method: 'GET', scope: 'account', query: PaginationQuerySchema, data: EventPageSchema }),
  userRanking: defineApiEndpoint({ key: 'contribution.user-ranking', method: 'GET', scope: 'account', query: z.object({}).passthrough(), data: RankingSchema }),
  organizationRanking: defineApiEndpoint({ key: 'contribution.organization-ranking', method: 'GET', scope: 'organization', query: z.object({}).passthrough(), data: RankingSchema }),
  organizationEvents: defineApiEndpoint({ key: 'contribution.organization-events', method: 'GET', scope: 'organization', data: OrganizationEventsSchema }),
  audit: defineApiEndpoint({ key: 'contribution.audit', method: 'GET', scope: 'platform', query: AuditQuerySchema, data: AuditPageSchema }),
  evidence: defineApiEndpoint({ key: 'contribution.evidence', method: 'GET', scope: 'platform', query: EvidenceQuerySchema, data: EvidenceSchema }),
  accept: defineApiEndpoint({ key: 'contribution.accept', method: 'POST', scope: 'platform', body: EmptyBodySchema, data: z.object({ accepted: z.literal(true) }) }),
  reject: defineApiEndpoint({ key: 'contribution.reject', method: 'POST', scope: 'platform', body: ReasonBodySchema, data: z.object({ rejected: z.literal(true) }) }),
  revoke: defineApiEndpoint({ key: 'contribution.revoke', method: 'POST', scope: 'platform', body: ReasonBodySchema, data: z.object({ revoked: z.literal(true), reversalTransactionId: z.string().nullable() }) }),
  retryReward: defineApiEndpoint({ key: 'contribution.retry-reward', method: 'POST', scope: 'platform', body: EmptyBodySchema, data: z.object({ retried: z.literal(true) }) }),
} as const
