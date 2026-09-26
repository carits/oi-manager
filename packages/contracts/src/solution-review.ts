import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const SolutionTypeSchema = z.enum([
  'OFFICIAL_EDITORIAL',
  'COMMUNITY_EDITORIAL',
  'ALTERNATIVE_SOLUTION',
  'EXPLANATION',
  'CORRECTION',
  'TRANSLATION',
])
export const SolutionSourceTypeSchema = z.enum(['ORIGINAL', 'DERIVED', 'TRANSLATED', 'AUTHORIZED'])
export const SolutionContributionStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'AUTO_CHECKING',
  'TECHNICALLY_VALID',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'REJECTED',
  'ACCEPTED',
  'PUBLISHED',
])
export const SolutionVerificationStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'PASSED',
  'FAILED',
  'INFRA_ERROR',
  'SKIPPED',
])
export const SolutionReviewTypeSchema = z.enum(['TECHNICAL', 'CONTENT', 'COPYRIGHT'])
export const SolutionReviewDecisionSchema = z.enum(['APPROVE', 'REQUEST_CHANGES', 'REJECT'])
export const SolutionVisibilityPolicySchema = z.enum(['PUBLIC', 'AFTER_AC', 'MANAGER_ONLY'])
export const ProblemSolutionVersionStatusSchema = z.enum(['PUBLISHED', 'SUPERSEDED', 'RETRACTED'])
export const SolutionSimilarityJobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED'])

const NullableTextSchema = z.string().nullable()
const OptionalNullableTextSchema = NullableTextSchema.optional()

export const SolutionVerificationSchema = z.object({
  id: z.string(),
  status: SolutionVerificationStatusSchema,
  compilePassed: z.boolean().nullable().optional(),
  officialVerdict: OptionalNullableTextSchema,
  officialScore: z.number().int().nullable().optional(),
  errorMessage: OptionalNullableTextSchema,
  startedAt: DateTimeWireSchema.nullable().optional(),
  completedAt: DateTimeWireSchema.nullable().optional(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema.optional(),
})

export const SolutionSimilarityCheckSchema = z.object({
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  textSimilarityBasisPoints: z.number().int().min(0).max(10_000).optional(),
  codeSimilarityBasisPoints: z.number().int().min(0).max(10_000).optional(),
  maximumSimilarityBasisPoints: z.number().int().min(0).max(10_000).optional(),
  sourceDeclared: z.boolean(),
  comparisonCount: z.number().int().min(0).optional(),
  checkedAt: DateTimeWireSchema,
})

export const SolutionSimilarityJobSchema = z.object({
  id: z.string(),
  status: SolutionSimilarityJobStatusSchema,
  attempts: z.number().int().min(0),
  lastError: OptionalNullableTextSchema,
  nextAttemptAt: DateTimeWireSchema.optional(),
  startedAt: DateTimeWireSchema.nullable().optional(),
  completedAt: DateTimeWireSchema.nullable().optional(),
  createdAt: DateTimeWireSchema.optional(),
  updatedAt: DateTimeWireSchema.optional(),
})

export const SolutionContributionRevisionSchema = z.object({
  id: z.string(),
  revision: z.number().int().min(1),
  title: z.string(),
  summary: OptionalNullableTextSchema,
  contentMarkdown: z.string(),
  algorithmTags: z.unknown().nullable().optional(),
  approachKey: OptionalNullableTextSchema,
  complexityTime: OptionalNullableTextSchema,
  complexityMemory: OptionalNullableTextSchema,
  language: OptionalNullableTextSchema,
  referenceCode: OptionalNullableTextSchema,
  sourceType: SolutionSourceTypeSchema,
  sourceUrl: OptionalNullableTextSchema,
  citation: OptionalNullableTextSchema,
  submittedAt: DateTimeWireSchema.optional(),
  Verification: SolutionVerificationSchema.nullable().optional(),
  SimilarityCheck: SolutionSimilarityCheckSchema.nullable().optional(),
  SimilarityJob: SolutionSimilarityJobSchema.nullable().optional(),
})

export const SolutionReviewRecordSchema = z.object({
  id: z.string(),
  reviewType: SolutionReviewTypeSchema,
  decision: SolutionReviewDecisionSchema,
  comment: OptionalNullableTextSchema,
  createdAt: DateTimeWireSchema,
  Reviewer: z.object({ username: z.string() }).optional(),
})

export const SolutionContributionSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  organizationId: z.string().nullable().optional(),
  type: SolutionTypeSchema,
  title: z.string(),
  summary: OptionalNullableTextSchema,
  contentMarkdown: z.string(),
  algorithmTags: z.unknown().nullable().optional(),
  approachKey: OptionalNullableTextSchema,
  complexityTime: OptionalNullableTextSchema,
  complexityMemory: OptionalNullableTextSchema,
  language: OptionalNullableTextSchema,
  referenceCode: OptionalNullableTextSchema,
  sourceType: SolutionSourceTypeSchema,
  sourceUrl: OptionalNullableTextSchema,
  citation: OptionalNullableTextSchema,
  status: SolutionContributionStatusSchema,
  currentRevision: z.number().int().min(0),
  updatedAt: DateTimeWireSchema,
  Author: z.object({ username: z.string() }).nullable().optional(),
  Problem: z.object({
    id: z.string(),
    problemId: z.string(),
    title: z.string(),
  }).optional(),
  Revisions: z.array(SolutionContributionRevisionSchema).optional(),
  Reviews: z.array(SolutionReviewRecordSchema).optional(),
})

export const ProblemSolutionVersionSchema = z.object({
  id: z.string(),
  solutionId: z.string().optional(),
  version: z.number().int().min(1),
  title: z.string(),
  contentMarkdown: z.string(),
  algorithmTags: z.unknown().nullable().optional(),
  approachKey: OptionalNullableTextSchema,
  complexityTime: OptionalNullableTextSchema,
  complexityMemory: OptionalNullableTextSchema,
  language: OptionalNullableTextSchema,
  referenceCode: OptionalNullableTextSchema,
  sourceType: SolutionSourceTypeSchema,
  sourceUrl: OptionalNullableTextSchema,
  citation: OptionalNullableTextSchema,
  status: ProblemSolutionVersionStatusSchema,
  visibilityPolicy: SolutionVisibilityPolicySchema,
  publishedAt: DateTimeWireSchema,
})

export const ProblemSolutionSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  type: SolutionTypeSchema,
  title: z.string(),
  visibilityPolicy: SolutionVisibilityPolicySchema,
  primary: z.boolean(),
  recommended: z.boolean(),
  createdAt: DateTimeWireSchema.optional(),
  Author: z.object({ username: z.string() }).nullable().optional(),
  CurrentVersion: ProblemSolutionVersionSchema,
  Versions: z.array(ProblemSolutionVersionSchema).optional(),
})

export const SolutionDraftBodySchema = z.object({
  type: SolutionTypeSchema,
  title: z.string(),
  summary: OptionalNullableTextSchema,
  contentMarkdown: z.string(),
  algorithmTags: z.array(z.string()).max(20).optional(),
  approachKey: OptionalNullableTextSchema,
  complexityTime: OptionalNullableTextSchema,
  complexityMemory: OptionalNullableTextSchema,
  language: OptionalNullableTextSchema,
  referenceCode: OptionalNullableTextSchema,
  sourceType: SolutionSourceTypeSchema,
  sourceUrl: OptionalNullableTextSchema,
  citation: OptionalNullableTextSchema,
  licenseAccepted: z.boolean(),
  organizationId: z.string().nullable().optional(),
  testSetRevisionId: z.string().nullable().optional(),
  baseSolutionId: z.string().nullable().optional(),
  baseVersionId: z.string().nullable().optional(),
})

export const SolutionDraftUpdateBodySchema = SolutionDraftBodySchema.partial()
export const SolutionCorrectionBodySchema = SolutionDraftUpdateBodySchema.extend({
  type: z.literal('CORRECTION').optional(),
  licenseAccepted: z.boolean(),
})
export const SolutionReviewBodySchema = z.object({
  reviewType: SolutionReviewTypeSchema.optional(),
  decision: SolutionReviewDecisionSchema,
  checklist: z.record(z.string(), z.unknown()).optional(),
  comment: OptionalNullableTextSchema,
})
export const SolutionReviewDecisionBodySchema = z.object({
  reviewType: SolutionReviewTypeSchema.optional(),
  checklist: z.record(z.string(), z.unknown()).optional(),
  comment: z.string(),
})
export const SolutionPublishBodySchema = z.object({
  visibilityPolicy: SolutionVisibilityPolicySchema.optional(),
})
export const EmptyCommandBodySchema = z.object({}).default({})
export const SolutionReviewQueueQuerySchema = z.object({
  status: SolutionContributionStatusSchema.optional(),
})

export const SimilarityExcerptSchema = z.object({
  kind: z.enum(['text', 'code']),
  left: z.object({ index: z.number(), text: z.string() }),
  right: z.object({ index: z.number(), text: z.string() }),
  similarityBasisPoints: z.number().int().min(0).max(10_000),
})

export const SimilarityComparisonSchema = z.object({
  source: z.object({
    type: z.string(),
    id: z.string(),
    title: z.string(),
    version: z.number(),
    author: z.object({ id: z.string(), username: z.string() }).nullable().optional(),
  }).nullable(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  textSimilarityBasisPoints: z.number().int().min(0).max(10_000),
  codeSimilarityBasisPoints: z.number().int().min(0).max(10_000),
  maximumSimilarityBasisPoints: z.number().int().min(0).max(10_000),
  matches: z.array(SimilarityExcerptSchema).max(20),
})

export const SolutionReviewContracts = {
  listProblemSolutions: defineApiEndpoint({
    key: 'solution-review.list-problem-solutions',
    method: 'GET',
    scope: 'context',
    data: z.array(ProblemSolutionSchema),
  }),
  createContribution: defineApiEndpoint({
    key: 'solution-review.create-contribution',
    method: 'POST',
    scope: 'context',
    body: SolutionDraftBodySchema,
    data: SolutionContributionSchema,
  }),
  listMyContributions: defineApiEndpoint({
    key: 'solution-review.list-my-contributions',
    method: 'GET',
    scope: 'context',
    data: z.array(SolutionContributionSchema),
  }),
  getContribution: defineApiEndpoint({
    key: 'solution-review.get-contribution',
    method: 'GET',
    scope: 'context',
    data: SolutionContributionSchema,
  }),
  updateContribution: defineApiEndpoint({
    key: 'solution-review.update-contribution',
    method: 'PATCH',
    scope: 'context',
    body: SolutionDraftUpdateBodySchema,
    data: SolutionContributionSchema,
  }),
  submitContribution: defineApiEndpoint({
    key: 'solution-review.submit-contribution',
    method: 'POST',
    scope: 'context',
    body: EmptyCommandBodySchema,
    data: SolutionContributionSchema,
  }),
  resubmitContribution: defineApiEndpoint({
    key: 'solution-review.resubmit-contribution',
    method: 'POST',
    scope: 'context',
    body: EmptyCommandBodySchema,
    data: SolutionContributionSchema,
  }),
  refreshVerification: defineApiEndpoint({
    key: 'solution-review.refresh-verification',
    method: 'POST',
    scope: 'context',
    body: EmptyCommandBodySchema,
    data: SolutionVerificationSchema,
  }),
  getSolution: defineApiEndpoint({
    key: 'solution-review.get-solution',
    method: 'GET',
    scope: 'context',
    data: ProblemSolutionSchema,
  }),
  getSolutionVersion: defineApiEndpoint({
    key: 'solution-review.get-solution-version',
    method: 'GET',
    scope: 'context',
    data: ProblemSolutionSchema,
  }),
  createCorrection: defineApiEndpoint({
    key: 'solution-review.create-correction',
    method: 'POST',
    scope: 'context',
    body: SolutionCorrectionBodySchema,
    data: SolutionContributionSchema,
  }),
  reviewQueue: defineApiEndpoint({
    key: 'solution-review.review-queue',
    method: 'GET',
    scope: 'context',
    query: SolutionReviewQueueQuerySchema,
    data: z.array(SolutionContributionSchema),
  }),
  similarityComparison: defineApiEndpoint({
    key: 'solution-review.similarity-comparison',
    method: 'GET',
    scope: 'context',
    data: SimilarityComparisonSchema,
  }),
  recordReview: defineApiEndpoint({
    key: 'solution-review.record-review',
    method: 'POST',
    scope: 'context',
    body: SolutionReviewBodySchema,
    data: SolutionReviewRecordSchema,
  }),
  requestRevision: defineApiEndpoint({
    key: 'solution-review.request-revision',
    method: 'POST',
    scope: 'context',
    body: SolutionReviewDecisionBodySchema,
    data: SolutionReviewRecordSchema,
  }),
  rejectContribution: defineApiEndpoint({
    key: 'solution-review.reject-contribution',
    method: 'POST',
    scope: 'context',
    body: SolutionReviewDecisionBodySchema,
    data: SolutionReviewRecordSchema,
  }),
  acceptContribution: defineApiEndpoint({
    key: 'solution-review.accept-contribution',
    method: 'POST',
    scope: 'context',
    body: EmptyCommandBodySchema,
    data: SolutionContributionSchema,
  }),
  publishContribution: defineApiEndpoint({
    key: 'solution-review.publish-contribution',
    method: 'POST',
    scope: 'context',
    body: SolutionPublishBodySchema,
    data: ProblemSolutionVersionSchema,
  }),
  retrySimilarity: defineApiEndpoint({
    key: 'solution-review.retry-similarity',
    method: 'POST',
    scope: 'context',
    body: EmptyCommandBodySchema,
    data: SolutionSimilarityJobSchema,
  }),
} as const

export type SimilarityComparison = z.infer<typeof SimilarityComparisonSchema>
export type SolutionContribution = z.infer<typeof SolutionContributionSchema>
export type ProblemSolution = z.infer<typeof ProblemSolutionSchema>
export type ProblemSolutionVersion = z.infer<typeof ProblemSolutionVersionSchema>
export type SolutionReviewRecord = z.infer<typeof SolutionReviewRecordSchema>
