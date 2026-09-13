import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, FieldIssueSchema, PaginationMetaSchema, PaginationQuerySchema } from './http'

export const AssignmentProblemContractSchema = z.looseObject({
  id: z.string(),
  orderIndex: z.number(),
  category: z.string(),
  maxScore: z.number(),
  targetScore: z.number(),
  weight: z.number(),
  completionPolicy: z.string(),
  problem: z.looseObject({
    id: z.string(),
    platform: z.string(),
    problemId: z.string(),
    title: z.string(),
  }),
})

export const AssignmentProgressCellSchema = z.looseObject({
  id: z.string().nullable().optional(),
  assignmentProblemId: z.string(),
  learningStatus: z.string(),
  timelinessStatus: z.string(),
  correctionStatus: z.string(),
  attemptCount: z.number().optional(),
  bestScore: z.number().nullable().optional(),
  bestVerdict: z.string().nullable().optional(),
  finalScore: z.number().nullable().optional(),
  firstSubmissionId: z.number().nullable().optional(),
  bestSubmissionId: z.number().nullable().optional(),
  latestSubmissionId: z.number().nullable().optional(),
  firstSubmittedAt: DateTimeWireSchema.nullable().optional(),
  lastSubmittedAt: DateTimeWireSchema.nullable().optional(),
  manualCompletionVersion: z.number().int().min(0).default(0),
  manualCompletedAt: DateTimeWireSchema.nullable().optional(),
  manualCompletionReason: z.string().nullable().optional(),
  manualCompletedBy: z.looseObject({ id: z.string(), username: z.string() }).nullable().optional(),
  states: z.array(z.string()).optional(),
})

export const AssignmentProgressRecipientSchema = z.looseObject({
  id: z.string(),
  user: z.looseObject({ id: z.string(), username: z.string() }),
  score: z.number(),
  rawScore: z.number(),
  adjustment: z.number(),
  completedProblems: z.number(),
  lateProblems: z.number(),
  correctionProblems: z.number(),
  progress: z.array(AssignmentProgressCellSchema),
  cells: z.array(AssignmentProgressCellSchema).optional(),
})

export const AssignmentProgressDataSchema = z.object({
  recipients: z.array(AssignmentProgressRecipientSchema),
  problems: z.array(AssignmentProblemContractSchema),
  statusCounts: z.record(z.string(), z.number()).optional(),
  pagination: PaginationMetaSchema.optional(),
})

export const AssignmentProgressQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  problemId: z.string().optional(),
  state: z.string().max(300).optional(),
})

export const ManualCompletionBodySchema = z.object({
  completed: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  expectedVersion: z.number().int().min(0),
})

export const AssignmentValidationDataSchema = z.object({
  valid: z.boolean(),
  issues: z.array(FieldIssueSchema),
})

export const AssignmentContracts = {
  progress: defineApiEndpoint({
    key: 'assignment.progress',
    method: 'GET',
    scope: 'organization',
    query: AssignmentProgressQuerySchema,
    data: AssignmentProgressDataSchema,
  }),
  manualCompletion: defineApiEndpoint({
    key: 'assignment.manual-completion',
    method: 'POST',
    scope: 'organization',
    body: ManualCompletionBodySchema,
    data: AssignmentProgressCellSchema,
  }),
  validate: defineApiEndpoint({
    key: 'assignment.validate',
    method: 'POST',
    scope: 'organization',
    data: AssignmentValidationDataSchema,
  }),
} as const

export type AssignmentProgressData = z.infer<typeof AssignmentProgressDataSchema>
export type AssignmentProgressCell = z.infer<typeof AssignmentProgressCellSchema>
export type AssignmentProgressRecipient = z.infer<typeof AssignmentProgressRecipientSchema>
export type ManualCompletionBody = z.infer<typeof ManualCompletionBodySchema>
