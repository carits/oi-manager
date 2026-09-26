import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const ContestSubmissionUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().optional(),
})
export const ContestSubmissionUsersSchema = z.object({ users: z.array(ContestSubmissionUserSchema) })

export const ContestMakeupHomeworkInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  startTime: DateTimeWireSchema.optional(),
  endTime: DateTimeWireSchema.optional(),
})
export const ContestMakeupHomeworkSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.literal('assignment'),
  sourceContestId: z.string(),
  startTime: DateTimeWireSchema,
  endTime: DateTimeWireSchema,
  teamId: z.string().nullable(),
  organizationId: z.string(),
  problemCount: z.number().int().nonnegative(),
})

export const ContestSubmissionListItemSchema = z.object({
  id: z.number().int().positive(),
  userId: z.string(),
  userName: z.string(),
  username: z.string(),
  problemSourceHidden: z.boolean().optional(),
  problemAlias: z.string(),
  problemOrderIndex: z.number().int(),
  contestProblemId: z.string().nullable(),
  oj: z.string().optional(),
  language: z.string(),
  result: z.string().nullable(),
  displayResult: z.string().optional(),
  hidden: z.boolean().optional(),
  score: z.number().nullable(),
  timeUsed: z.number().nullable(),
  memoryUsed: z.number().nullable(),
  codeLength: z.number().int().nonnegative(),
  ojRemoteId: z.string().nullable(),
  createdAt: DateTimeWireSchema,
})

export const ContestSubmissionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  userId: z.string().optional(),
  problemId: z.string().optional(),
  username: z.string().trim().max(100).optional(),
  result: z.string().max(50).optional(),
  language: z.string().max(50).optional(),
})

export const ContestSubmissionListSchema = z.object({
  submissions: z.array(ContestSubmissionListItemSchema),
  page: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})

export const ContestRejudgeScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('problem'), contestProblemId: z.string().min(1) }),
  z.object({ type: z.literal('user_problem'), contestProblemId: z.string().min(1), userId: z.string().min(1) }),
])

export const ContestTeamSummarySchema = z.object({
  id: z.number().int().positive(), title: z.string(), description: z.string().nullable().optional(),
  format: z.string().nullable().optional(), startTime: DateTimeWireSchema, endTime: DateTimeWireSchema,
  status: z.string(), createdBy: z.string().nullable().optional(), type: z.literal('contest'),
  problemCount: z.number().int().nonnegative(), participantCount: z.number().int().nonnegative(), createdAt: DateTimeWireSchema,
})

export const ContestContracts = {
  listTeam: defineApiEndpoint({
    key: 'contest.team.list', method: 'GET', scope: 'context',
    query: z.object({ type: z.literal('contest').optional() }), data: z.array(ContestTeamSummarySchema),
  }),
  submissionUsers: defineApiEndpoint({
    key: 'contest.submission-users', method: 'GET', scope: 'context', data: ContestSubmissionUsersSchema,
  }),
  submissions: defineApiEndpoint({
    key: 'contest.submissions.list', method: 'GET', scope: 'context',
    query: ContestSubmissionListQuerySchema, data: ContestSubmissionListSchema,
  }),
  rejudgePreview: defineApiEndpoint({
    key: 'contest.rejudge.preview', method: 'GET', scope: 'context',
    query: z.object({
      scopeType: z.enum(['all', 'problem', 'user_problem']).default('all'),
      contestProblemId: z.string().optional(),
      userId: z.string().optional(),
    }),
    data: z.object({ matchedCount: z.number().int().nonnegative(), inProgressCount: z.number().int().nonnegative() }),
  }),
  rejudge: defineApiEndpoint({
    key: 'contest.rejudge', method: 'POST', scope: 'context',
    body: z.object({ scope: ContestRejudgeScopeSchema }),
    data: z.object({
      batchId: z.string(),
      scope: z.enum(['all', 'problem', 'user_problem']),
      resetCount: z.number().int().nonnegative(),
      skippedCount: z.number().int().nonnegative(),
      message: z.string(),
    }),
  }),
  createMakeupHomework: defineApiEndpoint({
    key: 'contest.makeup-homework.create', method: 'POST', scope: 'context',
    body: ContestMakeupHomeworkInputSchema, data: ContestMakeupHomeworkSchema,
  }),
} as const

export type ContestSubmissionUser = z.infer<typeof ContestSubmissionUserSchema>
export type ContestSubmissionListItem = z.infer<typeof ContestSubmissionListItemSchema>
export type ContestSubmissionListQuery = z.infer<typeof ContestSubmissionListQuerySchema>
export type ContestRejudgeScope = z.infer<typeof ContestRejudgeScopeSchema>
export type ContestMakeupHomeworkInput = z.infer<typeof ContestMakeupHomeworkInputSchema>
export type ContestMakeupHomework = z.infer<typeof ContestMakeupHomeworkSchema>
