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

export const ContestContentOptionSchema = z.object({
  key: z.string(),
  kind: z.enum(['statement', 'solution']).optional(),
  sourceType: z.enum(['canonical', 'user', 'training', 'none']),
  title: z.string().nullable(),
  format: z.string(),
  language: z.string().nullable(),
  authorUsername: z.string().nullable(),
  fileName: z.string().nullable(),
  previewText: z.string().nullable(),
  shareKeys: z.array(z.string()).optional(),
})

export const ContestContentOptionsSchema = z.object({
  statement: z.array(ContestContentOptionSchema),
  solution: z.array(ContestContentOptionSchema),
  currentSelection: z.object({
    statementOptionKey: z.string().nullable(),
    solutionOptionKey: z.string().nullable(),
    statementRevision: z.number().int().nullable(),
    solutionRevision: z.number().int().nullable(),
  }),
})

export const ContestContentPreviewSchema = ContestContentOptionSchema.extend({
  content: z.string().nullable(),
  fileUrl: z.string().nullable(),
})

export const ContestStatementOptionSchema = z.object({
  key: z.string(),
  groupKey: z.string(),
  name: z.string(),
  authorUsername: z.string(),
  language: z.string().nullable(),
  format: z.string(),
  visibility: z.string(),
  unavailable: z.boolean(),
  sourceType: z.string().optional(),
})

export const ContestStatementManagementSchema = z.object({
  contest: z.object({ id: z.string(), title: z.string(), type: z.literal('contest') }),
  problems: z.array(z.object({
    contestProblemId: z.string(),
    alias: z.string().nullable(),
    orderIndex: z.number().int().nonnegative(),
    title: z.string(),
    options: z.array(ContestStatementOptionSchema),
    selected: z.array(z.object({ key: z.string(), isDefault: z.boolean(), orderIndex: z.number().int().nonnegative() })),
  })),
})

export const ContestTestSetUpdatePreviewSchema = z.object({
  contestProblemId: z.string(),
  problemId: z.string(),
  problemTitle: z.string(),
  currentGraphHash: z.string().nullable(),
  currentFencingToken: z.number().int().nonnegative().nullable(),
  stableGraphHash: z.string().nullable(),
  stableFencingToken: z.number().int().nonnegative().nullable(),
  pending: z.boolean(),
  frozen: z.boolean(),
  frozenReason: z.string().nullable(),
  submissionCount: z.number().int().nonnegative(),
})

export const ContestTestSetUpdateResultSchema = z.object({
  updated: z.boolean(),
  previousGraphHash: z.string().nullable().optional(),
  currentGraphHash: z.string().nullable(),
  currentFencingToken: z.number().int().nonnegative().nullable(),
  stableGraphHash: z.string().nullable().optional(),
  stableFencingToken: z.number().int().nonnegative().nullable().optional(),
  pending: z.boolean().optional(),
  frozen: z.boolean().optional(),
  frozenReason: z.string().nullable().optional(),
  submissionCount: z.number().int().nonnegative().optional(),
})

export const ContestTeamSummarySchema = z.object({
  id: z.string().min(1), title: z.string(), description: z.string().nullable().optional(),
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
  contentOptions: defineApiEndpoint({
    key: 'contest.content.options', method: 'GET', scope: 'context', data: ContestContentOptionsSchema,
  }),
  contentPreview: defineApiEndpoint({
    key: 'contest.content.preview', method: 'GET', scope: 'context', data: ContestContentPreviewSchema,
  }),
  updateContentSelection: defineApiEndpoint({
    key: 'contest.content.selection.update', method: 'PUT', scope: 'context',
    body: z.object({ statementOptionKey: z.string().min(1), solutionOptionKey: z.string().min(1) }),
    data: z.object({ updated: z.array(z.enum(['statement', 'solution'])) }),
  }),
  updateContentMarkdown: defineApiEndpoint({
    key: 'contest.content.markdown.update', method: 'PUT', scope: 'context',
    body: z.object({ content: z.string() }),
    data: z.object({
      id: z.string(), kind: z.enum(['statement', 'solution']), format: z.literal('markdown'), content: z.string(),
    }),
  }),
  statementManagement: defineApiEndpoint({
    key: 'contest.statement-management.get', method: 'GET', scope: 'context', data: ContestStatementManagementSchema,
  }),
  saveStatementManagement: defineApiEndpoint({
    key: 'contest.statement-management.save', method: 'PUT', scope: 'context',
    body: z.object({ selections: z.array(z.object({
      contestProblemId: z.string().min(1),
      visibleOptionKeys: z.array(z.string().min(1)).min(1),
      defaultOptionKey: z.string().min(1),
      expectedSelectionRevision: z.number().int().nonnegative().optional(),
    })) }),
    data: z.object({
      changedCount: z.number().int().nonnegative(),
      changed: z.array(z.object({ contestProblemId: z.string() })),
    }),
  }),
  testSetUpdatePreview: defineApiEndpoint({
    key: 'contest.test-set-update.preview', method: 'GET', scope: 'context', data: ContestTestSetUpdatePreviewSchema,
  }),
  testSetUpdate: defineApiEndpoint({
    key: 'contest.test-set-update.apply', method: 'POST', scope: 'context',
    body: z.object({}), data: ContestTestSetUpdateResultSchema,
  }),
  createMakeupHomework: defineApiEndpoint({
    key: 'contest.makeup-homework.create', method: 'POST', scope: 'context',
    body: ContestMakeupHomeworkInputSchema, data: ContestMakeupHomeworkSchema,
  }),
} as const

export type ContestSubmissionUser = z.infer<typeof ContestSubmissionUserSchema>
export type ContestContentOption = z.infer<typeof ContestContentOptionSchema>
export type ContestContentOptions = z.infer<typeof ContestContentOptionsSchema>
export type ContestStatementManagement = z.infer<typeof ContestStatementManagementSchema>
export type ContestTestSetUpdatePreview = z.infer<typeof ContestTestSetUpdatePreviewSchema>
export type ContestSubmissionListItem = z.infer<typeof ContestSubmissionListItemSchema>
export type ContestSubmissionListQuery = z.infer<typeof ContestSubmissionListQuerySchema>
export type ContestRejudgeScope = z.infer<typeof ContestRejudgeScopeSchema>
export type ContestMakeupHomeworkInput = z.infer<typeof ContestMakeupHomeworkInputSchema>
export type ContestMakeupHomework = z.infer<typeof ContestMakeupHomeworkSchema>
