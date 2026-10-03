import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

const NullableDate = DateTimeWireSchema.nullable().optional()
const JsonObjectSchema = z.record(z.string(), z.unknown())

export const TrainingSessionTypeSchema = z.enum(['GENERAL', 'OI', 'ACM'])
export const TrainingSessionStatusSchema = z.enum(['READY', 'RUNNING', 'PAUSED', 'ENDED', 'ARCHIVED'])
export const TrainingRoundLifecycleSchema = z.enum(['PENDING', 'RUNNING', 'ENDED'])
export const TrainingTargetTypeSchema = z.enum(['ALL', 'GROUP', 'USER'])

export const TrainingUserSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable().optional(),
})

export const TrainingProblemReferenceInputSchema = z.object({
  problemId: z.string().min(1),
  alias: z.string().trim().max(50).nullable().optional(),
})

export const TrainingGroupInputSchema = z.object({
  id: z.string().optional(),
  clientKey: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  participantIds: z.array(z.string()).default([]),
  problemIds: z.array(z.string()).optional(),
})

export const TrainingGroupingInputSchema = z.object({
  groups: z.array(TrainingGroupInputSchema).min(1).max(50),
})

export const TrainingParticipantPreviewInputSchema = z.object({
  organizationId: z.string().optional(),
  teamId: z.string().optional(),
  participantTarget: z.enum(['team', 'organization_students', 'custom_students']),
  participantUserIds: z.array(z.string()).max(5000).optional(),
})

export const TrainingParticipantPreviewSchema = z.object({
  participantCount: z.number().int().nonnegative(),
  targetName: z.string(),
})

export const TrainingSessionCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  sessionType: TrainingSessionTypeSchema,
  organizationId: z.string().optional(),
  teamId: z.string().optional(),
  participantTarget: z.enum(['team', 'organization_students', 'custom_students']),
  participantUserIds: z.array(z.string()).max(5000).optional(),
  scheduledStartAt: NullableDate,
  totalDurationSeconds: z.number().int().min(300).max(7 * 24 * 3600),
  startImmediately: z.boolean().default(false),
  grouping: TrainingGroupingInputSchema.optional(),
  problems: z.array(TrainingProblemReferenceInputSchema).min(1).max(200),
})

export const TrainingSessionProblemSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  problemId: z.string(),
  alias: z.string().nullable().optional(),
  titleSnapshot: z.string(),
  Problem: z.object({
    id: z.string(),
    platform: z.string(),
    problemId: z.string(),
    title: z.string(),
    difficulty: z.string().nullable().optional(),
    timeLimit: z.number().nonnegative().nullable().optional(),
    memoryLimit: z.number().nonnegative().nullable().optional(),
  }),
}).passthrough()

export const TrainingRoundAssignmentSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  groupId: z.string(),
  sessionProblemId: z.string(),
  orderIndex: z.number().int().nonnegative(),
  active: z.boolean(),
  SessionProblem: TrainingSessionProblemSchema,
}).passthrough()

export const TrainingRoundSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  name: z.string(),
  orderIndex: z.number().int().nonnegative(),
  lifecycle: TrainingRoundLifecycleSchema,
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
  activeElapsedSeconds: z.number().int().nonnegative(),
  startedAt: NullableDate,
  runningSince: NullableDate,
  endedAt: NullableDate,
  endReason: z.string().nullable().optional(),
  Assignments: z.array(TrainingRoundAssignmentSchema),
}).passthrough()

export const TrainingGroupSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  name: z.string(),
  orderIndex: z.number().int().nonnegative(),
  status: z.string(),
  Participants: z.array(z.object({
    id: z.string(),
    userId: z.string(),
    status: z.string(),
  }).passthrough()).optional(),
}).passthrough()

export const TrainingSessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: TrainingSessionStatusSchema,
  sessionType: TrainingSessionTypeSchema,
  statusRevision: z.number().int().nonnegative(),
  totalDurationSeconds: z.number().int().positive(),
  activeElapsedSeconds: z.number().int().nonnegative(),
  scheduledStartAt: NullableDate,
  startedAt: NullableDate,
  runningSince: NullableDate,
  endedAt: NullableDate,
  currentRoundId: z.string().nullable().optional(),
  problemCount: z.number().int().nonnegative().optional(),
  participantCount: z.number().int().nonnegative().optional(),
  teamId: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  createdAt: DateTimeWireSchema.optional(),
  canJoin: z.boolean().optional(),
}).passthrough()

export const TrainingSessionListQuerySchema = z.object({
  organizationId: z.string().optional(),
  teamId: z.string().optional(),
  filterTeamId: z.string().optional(),
  statusGroup: z.enum(['active', 'upcoming', 'completed']).optional(),
  keyword: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export const TrainingSessionListSchema = z.object({
  items: z.array(TrainingSessionSummarySchema),
  statusCounts: z.record(z.string(), z.number().int()),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
})

export const TrainingProgressSchema = z.object({
  sessionProblemId: z.string(),
  status: z.enum(['NOT_STARTED', 'WORKING', 'COMPLETED']),
  bestScore: z.number().nullable().optional(),
  bestVerdict: z.string().nullable().optional(),
  attemptCount: z.number().int().nonnegative(),
  activeSeconds: z.number().int().nonnegative(),
  acAt: NullableDate,
}).passthrough()

export const TrainingWorkspaceSchema = z.object({
  session: TrainingSessionSummarySchema.extend({
    organizationId: z.string().nullable().optional(),
    createdBy: z.string(),
    currentRound: TrainingRoundSchema.nullable().optional(),
    Problems: z.array(TrainingSessionProblemSchema),
    Rounds: z.array(TrainingRoundSchema),
    Groups: z.array(TrainingGroupSchema),
    Overlays: z.array(z.object({
      id: z.string(),
      type: z.string(),
      targetType: TrainingTargetTypeSchema,
      targetId: z.string().nullable().optional(),
      sessionProblemId: z.string().nullable().optional(),
      status: z.string(),
    }).passthrough()),
  }).passthrough(),
  manager: z.boolean(),
  participant: z.object({
    id: z.string(),
    userId: z.string(),
    currentGroupId: z.string(),
    currentSessionProblemId: z.string().nullable().optional(),
  }).passthrough().nullable().optional(),
  effectiveProblems: z.array(TrainingSessionProblemSchema),
  progress: z.array(TrainingProgressSchema),
  permissions: z.record(z.string(), z.object({
    canView: z.boolean(),
    canSubmit: z.boolean(),
    canEdit: z.boolean(),
    reason: z.string(),
  })),
}).passthrough()

export const TrainingRoundGroupInputSchema = z.object({
  groupId: z.string().min(1),
  problems: z.array(TrainingProblemReferenceInputSchema).max(200),
})

export const TrainingNextRoundInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(200),
  timeLimitSeconds: z.number().int().min(60).max(7 * 24 * 3600).nullable().optional(),
  groups: z.array(TrainingRoundGroupInputSchema).min(1).max(50),
})

export const TrainingExpectedRevisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
})

export const TrainingReplaceAssignmentsInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  groupId: z.string().min(1),
  problems: z.array(TrainingProblemReferenceInputSchema).max(200),
})

export const TrainingGroupingReplaceInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  groups: z.array(TrainingGroupInputSchema).min(1).max(50),
})

export const TrainingGroupingChangeInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  participantIds: z.array(z.string()).min(1).max(5000),
  toGroupId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
})

export const TrainingCommandInputSchema = z.object({
  type: z.enum([
    'START_SESSION',
    'PAUSE_SESSION',
    'RESUME_SESSION',
    'EXTEND_SESSION',
    'EXTEND_ROUND',
    'FOCUS_PROBLEM',
    'END_FOCUS',
    'END_SESSION',
  ]),
  expectedRevision: z.number().int().nonnegative(),
  targetType: TrainingTargetTypeSchema.default('ALL'),
  targetId: z.string().nullable().optional(),
  payload: JsonObjectSchema.default({}),
})

export const TrainingHeartbeatInputSchema = z.object({
  sessionProblemId: z.string(),
  pageVisible: z.boolean(),
  editorFocused: z.boolean(),
})

export const TrainingDraftSchema = z.object({
  code: z.string(),
  language: z.string(),
  revision: z.number().int(),
  inputFilename: z.string().nullable().optional(),
  outputFilename: z.string().nullable().optional(),
  updatedAt: DateTimeWireSchema.optional(),
}).passthrough()

export const TrainingDraftInputSchema = z.object({
  code: z.string().max(1024 * 1024),
  language: z.string().min(1).max(30),
  inputFilename: z.string().nullable().optional(),
  outputFilename: z.string().nullable().optional(),
  expectedRevision: z.number().int().positive().optional(),
  editorFocused: z.boolean().optional(),
})

export const TrainingSubmitInputSchema = z.object({
  sessionProblemId: z.string(),
  code: z.string().min(1).max(1024 * 1024),
  language: z.string().min(1).max(30),
  inputFilename: z.string().nullable().optional(),
  outputFilename: z.string().nullable().optional(),
})

export const TrainingSubmitResultSchema = z.object({ id: z.number().int() }).passthrough()

export const TrainingPeerProgressSchema = z.object({
  sessionType: TrainingSessionTypeSchema,
  scope: z.enum(['all', 'group']),
  groupId: z.string().nullable().optional(),
  entries: z.array(z.object({
    rank: z.number().int().positive(),
    user: TrainingUserSummarySchema,
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    score: z.number().nonnegative().optional(),
    attempts: z.number().int().nonnegative().optional(),
    penaltyMinutes: z.number().int().nonnegative().optional(),
  })),
})

export const TrainingCoachDashboardSchema = z.object({
  session: TrainingSessionSummarySchema,
  participants: z.array(z.object({
    id: z.string(),
    user: TrainingUserSummarySchema,
    currentGroupId: z.string(),
    currentSessionProblemId: z.string().nullable().optional(),
    activeSeconds: z.number().int().nonnegative(),
    online: z.boolean(),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    progress: z.array(TrainingProgressSchema),
  }).passthrough()),
  summary: z.object({
    total: z.number().int().nonnegative(),
    working: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }),
})

export const TrainingReportSchema = z.object({
  session: TrainingSessionSummarySchema,
  rounds: z.array(TrainingRoundSchema),
  groupChanges: z.array(z.object({
    id: z.string(),
    participantId: z.string(),
    fromGroupId: z.string().nullable().optional(),
    toGroupId: z.string(),
    reason: z.string(),
    appliedAt: DateTimeWireSchema,
  }).passthrough()),
  ranking: TrainingPeerProgressSchema,
})

export const TrainingContracts = {
  listSessions: defineApiEndpoint({ key: 'training.sessions.list', method: 'GET', scope: 'organization', query: TrainingSessionListQuerySchema, data: TrainingSessionListSchema }),
  createSession: defineApiEndpoint({ key: 'training.sessions.create', method: 'POST', scope: 'organization', body: TrainingSessionCreateInputSchema, data: TrainingSessionSummarySchema }),
  previewParticipants: defineApiEndpoint({ key: 'training.participants.preview', method: 'POST', scope: 'organization', body: TrainingParticipantPreviewInputSchema, data: TrainingParticipantPreviewSchema }),
  getWorkspace: defineApiEndpoint({ key: 'training.workspace', method: 'GET', scope: 'organization', data: TrainingWorkspaceSchema }),
  putNextRound: defineApiEndpoint({ key: 'training.round.next.put', method: 'PUT', scope: 'organization', body: TrainingNextRoundInputSchema, data: TrainingWorkspaceSchema }),
  deleteNextRound: defineApiEndpoint({ key: 'training.round.next.delete', method: 'DELETE', scope: 'organization', body: TrainingExpectedRevisionSchema, data: TrainingWorkspaceSchema }),
  advanceRound: defineApiEndpoint({ key: 'training.round.advance', method: 'POST', scope: 'organization', body: TrainingExpectedRevisionSchema, data: TrainingWorkspaceSchema }),
  replaceAssignments: defineApiEndpoint({ key: 'training.assignments.replace', method: 'PUT', scope: 'organization', body: TrainingReplaceAssignmentsInputSchema, data: TrainingWorkspaceSchema }),
  replaceGrouping: defineApiEndpoint({ key: 'training.grouping.replace', method: 'PUT', scope: 'organization', body: TrainingGroupingReplaceInputSchema, data: TrainingWorkspaceSchema }),
  changeGrouping: defineApiEndpoint({ key: 'training.grouping.change', method: 'POST', scope: 'organization', body: TrainingGroupingChangeInputSchema, data: TrainingWorkspaceSchema }),
  archiveSession: defineApiEndpoint({ key: 'training.archive', method: 'POST', scope: 'organization', body: TrainingExpectedRevisionSchema, data: TrainingSessionSummarySchema }),
  joinSession: defineApiEndpoint({ key: 'training.join', method: 'POST', scope: 'organization', body: z.object({}).default({}), data: z.object({ id: z.string() }).passthrough() }),
  executeCommand: defineApiEndpoint({ key: 'training.command', method: 'POST', scope: 'organization', body: TrainingCommandInputSchema, data: TrainingWorkspaceSchema }),
  heartbeat: defineApiEndpoint({ key: 'training.heartbeat', method: 'POST', scope: 'organization', body: TrainingHeartbeatInputSchema, data: z.object({ participant: z.object({ id: z.string() }).passthrough(), progress: TrainingProgressSchema }) }),
  getDraft: defineApiEndpoint({ key: 'training.draft.get', method: 'GET', scope: 'organization', data: TrainingDraftSchema.nullable() }),
  saveDraft: defineApiEndpoint({ key: 'training.draft.save', method: 'PUT', scope: 'organization', body: TrainingDraftInputSchema, data: TrainingDraftSchema }),
  submit: defineApiEndpoint({ key: 'training.submit', method: 'POST', scope: 'organization', body: TrainingSubmitInputSchema, data: TrainingSubmitResultSchema }),
  getPeerProgress: defineApiEndpoint({ key: 'training.peer-progress', method: 'GET', scope: 'organization', data: TrainingPeerProgressSchema }),
  getCoachDashboard: defineApiEndpoint({ key: 'training.coach-dashboard', method: 'GET', scope: 'organization', data: TrainingCoachDashboardSchema }),
  getReport: defineApiEndpoint({ key: 'training.report', method: 'GET', scope: 'organization', data: TrainingReportSchema }),
} as const

export type TrainingWorkspace = z.infer<typeof TrainingWorkspaceSchema>
export type TrainingRoster = z.infer<typeof TrainingGroupingReplaceInputSchema>
export type TrainingCoachDashboard = z.infer<typeof TrainingCoachDashboardSchema>
export type TrainingReport = z.infer<typeof TrainingReportSchema>
export type TrainingSessionCreateInput = z.infer<typeof TrainingSessionCreateInputSchema>
