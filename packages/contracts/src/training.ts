import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, FieldIssueSchema } from './http'

const NullableNumber = z.number().int().nullable().optional()
const JsonObjectSchema = z.record(z.string(), z.unknown())
const TrainingIssueSchema = FieldIssueSchema.extend({ severity: z.enum(['error', 'warning']) })
export const TrainingStageKindSchema = z.enum(['TRAINING', 'TEACHING', 'REVIEW'])
export const TrainingStageAudienceModeSchema = z.enum(['ALL', 'GROUPED'])
export const TrainingStageLifecycleSchema = z.enum(['PENDING', 'RUNNING', 'ENDED', 'SKIPPED'])
export const TrainingStageEndReasonSchema = z.enum(['TIME_REACHED', 'COMPLETION_REACHED', 'HYBRID_REACHED', 'TEACHER_ENDED', 'TEACHER_ENDED_EARLY', 'SESSION_ENDED', 'SYSTEM_ENDED'])
export const TrainingStageEndPolicySchema = z.enum(['MANUAL', 'TIME', 'COMPLETION', 'HYBRID'])
export const TrainingStageAccessPolicySchema = z.enum(['ALL_AT_ONCE', 'SEQUENTIAL', 'TEACHER_CONTROLLED'])
export const TrainingUnlockConditionSchema = z.object({ type: z.enum(['AC', 'SCORE', 'TIME', 'ATTEMPTS', 'TEACHER']), value: z.number().int().optional() })
export const TrainingUnlockPolicySchema = z.object({ mode: z.enum(['ANY', 'ALL']), conditions: z.array(TrainingUnlockConditionSchema).min(1).max(10) })
export const TrainingScoreGoalSchema = z.object({ score: z.number().int().min(0).max(100), allowedSubtaskIds: z.array(z.number().int().positive()).optional() })
export const TrainingProblemTimePolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('NONE') }),
  z.object({ mode: z.enum(['SOFT', 'HARD', 'SWITCH_REQUIRED']), limitSeconds: z.number().int().min(60).max(86400) }),
])
export const TrainingStuckPolicySchema = z.object({ minActiveSeconds: z.number().int().min(60).max(86400), minAttempts: z.number().int().min(1).max(1000), noImprovementSeconds: z.number().int().min(60).max(86400) })

export const TrainingStructureProblemInputSchema = z.object({
  assignmentId: z.string().optional(), clientKey: z.string().min(1), problemId: z.string().min(1), testSetRevisionId: z.string().min(1),
  alias: z.string().max(50).nullable().optional(), unlockPolicy: TrainingUnlockPolicySchema.optional(), targetScore: NullableNumber,
  scoreGoals: z.array(TrainingScoreGoalSchema).max(20).optional(), timePolicy: TrainingProblemTimePolicySchema.optional(), stuckPolicy: TrainingStuckPolicySchema.optional(), hintPolicy: JsonObjectSchema.optional(),
  allowedSubtaskIds: z.array(z.number().int().positive()).default([]), strategyIntervalSeconds: NullableNumber,
})
export const TrainingStructureGroupInputSchema = z.object({
  id: z.string().optional(), clientKey: z.string().min(1), name: z.string().min(1).max(100),
  accessPolicy: TrainingStageAccessPolicySchema.default('ALL_AT_ONCE'), submissionMode: z.enum(['ENABLED', 'DISABLED']).default('ENABLED'),
  rules: JsonObjectSchema.optional(), participantIds: z.array(z.string()).default([]), problems: z.array(TrainingStructureProblemInputSchema).default([]),
})
export const TrainingStructureStageInputSchema = z.object({
  id: z.string().optional(), clientKey: z.string().min(1), name: z.string().min(1).max(200), description: z.string().max(5000).nullable().optional(),
  kind: TrainingStageKindSchema, audienceMode: TrainingStageAudienceModeSchema, lifecycle: TrainingStageLifecycleSchema.optional(),
  endPolicy: TrainingStageEndPolicySchema, accessPolicy: TrainingStageAccessPolicySchema, submissionMode: z.enum(['ENABLED', 'DISABLED']),
  plannedDurationSeconds: NullableNumber, defaultTargetScore: NullableNumber, completionThreshold: NullableNumber, minDurationSeconds: NullableNumber,
  rules: JsonObjectSchema.optional(), problems: z.array(TrainingStructureProblemInputSchema).default([]), groups: z.array(TrainingStructureGroupInputSchema).default([]),
})
export const TrainingStructureInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), title: z.string().min(1).max(200), description: z.string().max(5000),
  confirmDependentRemoval: z.boolean().optional(), stages: z.array(TrainingStructureStageInputSchema).min(1).max(100),
})

export const TrainingDesignProblemSchema = TrainingStructureProblemInputSchema.partial({ clientKey: true }).extend({
  id: z.string().optional(), Problem: z.object({ id: z.string(), platform: z.string(), problemId: z.string(), title: z.string() }),
  TestSetRevision: z.object({ id: z.string(), revisionNumber: z.number().int(), mode: z.string().optional() }),
  latestRevision: z.object({ id: z.string(), revisionNumber: z.number().int(), mode: z.string().optional() }).nullable().optional(),
  subtasks: z.array(z.object({ id: z.number().int(), score: z.number(), dependencies: z.array(z.number().int()).optional() })).optional(),
})
export const TrainingDesignGroupSchema = TrainingStructureGroupInputSchema.omit({ problems: true }).extend({ Problems: z.array(TrainingDesignProblemSchema) })
export const TrainingDesignStageSchema = TrainingStructureStageInputSchema.omit({ problems: true, groups: true }).extend({
  id: z.string(), definitionRevision: z.number().int().optional(), runningSince: DateTimeWireSchema.nullable().optional(), activeElapsedSeconds: z.number().int().optional(),
  endedAt: DateTimeWireSchema.nullable().optional(), endReason: TrainingStageEndReasonSchema.nullable().optional(), endNote: z.string().nullable().optional(), effectiveDurationSeconds: z.number().int().nullable().optional(),
  Problems: z.array(TrainingDesignProblemSchema), Groups: z.array(TrainingDesignGroupSchema),
})
export const TrainingDesignSchema = z.object({
  editable: z.boolean(), statusRevision: z.number().int().nonnegative(),
  session: z.object({ id: z.string(), title: z.string(), description: z.string().nullable().optional(), status: z.string(), sessionType: z.string(), organizationId: z.string().nullable().optional(), teamId: z.string().nullable().optional(), scheduledStartAt: DateTimeWireSchema.nullable().optional() }).passthrough(),
  stages: z.array(TrainingDesignStageSchema), issues: z.array(TrainingIssueSchema),
})
export const TrainingDesignProblemLookupSchema = z.object({
  id: z.string(), platform: z.string(), problemId: z.string(), title: z.string(), difficulty: z.string().nullable().optional(),
  revision: z.object({ id: z.string(), revisionNumber: z.number().int(), mode: z.string() }),
  subtasks: z.array(z.object({ id: z.number().int(), score: z.number(), dependencies: z.array(z.number().int()) })),
})
export const TrainingStructureValidationSchema = z.object({ valid: z.boolean(), issues: z.array(TrainingIssueSchema) })
export const TrainingStageTransitionInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), action: z.enum(['start', 'advance', 'skip_pending', 'end_session']), stageId: z.string().min(1), outcome: z.enum(['completed', 'ended_early']).optional(), nextStageId: z.string().optional(), reason: z.string().max(2000).optional() })
export const TrainingStageGroupChangeInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), participantId: z.string().min(1), toGroupId: z.string().min(1), effectiveMode: z.enum(['immediate', 'next_stage']), targetStageId: z.string().optional(), reason: z.string().min(1).max(2000) })
export const TrainingStageTimeExtensionInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), seconds: z.number().int().min(60).max(86400), reason: z.string().min(1).max(2000) })
export const TrainingRosterInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), participants: z.array(z.object({ userId: z.string().min(1) })).max(5000) })

export const TrainingTemplateStageSchema = z.object({
  name: z.string(), description: z.string(), kind: TrainingStageKindSchema,
  audienceMode: TrainingStageAudienceModeSchema, plannedDurationSeconds: z.number().int().positive().optional(),
  endPolicy: TrainingStageEndPolicySchema, accessPolicy: TrainingStageAccessPolicySchema,
  submissionMode: z.enum(['ENABLED', 'DISABLED']), defaultTargetScore: z.number().int().min(0).max(100).optional(),
  completionThreshold: z.number().int().min(1).max(100).optional(), minDurationSeconds: z.number().int().min(0).max(86400).optional(),
  rules: JsonObjectSchema.optional(),
  groups: z.array(z.object({ clientKey: z.string(), name: z.string(), accessPolicy: TrainingStageAccessPolicySchema.optional(), submissionMode: z.enum(['ENABLED', 'DISABLED']).optional(), rules: JsonObjectSchema.optional() })).optional(),
})
export const TrainingTemplateSchema = z.object({
  key: z.string(), name: z.string(), sessionType: z.enum(['OI', 'ACM', 'GENERAL']), description: z.string(),
  source: z.enum(['builtin', 'personal', 'organization', 'team']), stages: z.array(TrainingTemplateStageSchema),
})
export const TrainingTemplateListQuerySchema = z.object({ organizationId: z.string().optional(), teamId: z.string().optional() })
export const TrainingTemplateCreateInputSchema = z.object({ name: z.string().trim().min(1).max(100), scope: z.enum(['personal', 'organization', 'team']) })
export const TrainingTemplateDeleteResultSchema = z.object({ deleted: z.literal(true) })

const TrainingUserSummarySchema = z.object({ id: z.string(), username: z.string(), avatar: z.string().nullable().optional() }).passthrough()
const TrainingRuntimeProblemSchema = z.object({
  id: z.string(), problemId: z.string(), alias: z.string().nullable().optional(), targetScore: z.number().int().nullable().optional(),
  timePolicy: TrainingProblemTimePolicySchema.nullable().optional(), stuckPolicy: TrainingStuckPolicySchema.nullable().optional(), allowedSubtaskIds: z.array(z.number().int()).nullable().optional(),
  strategyIntervalSeconds: z.number().int().nullable().optional(), scoreGoals: z.array(TrainingScoreGoalSchema).optional(), unlockPolicy: TrainingUnlockPolicySchema.nullable().optional(),
  Problem: z.object({ problemId: z.string(), title: z.string(), platform: z.string() }).passthrough(),
  TestSetRevision: z.object({ revisionNumber: z.number().int(), mode: z.string() }).passthrough(),
}).passthrough()
const TrainingRuntimeStageSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().nullable().optional(), kind: TrainingStageKindSchema,
  audienceMode: TrainingStageAudienceModeSchema, lifecycle: TrainingStageLifecycleSchema,
  plannedDurationSeconds: z.number().int().nullable().optional(), runningSince: DateTimeWireSchema.nullable().optional(), activeElapsedSeconds: z.number().int(),
  effectiveDurationSeconds: z.number().int().nullable().optional(),
  minDurationSeconds: z.number().int().nullable().optional(), endPolicy: TrainingStageEndPolicySchema,
  accessPolicy: TrainingStageAccessPolicySchema, submissionMode: z.string(), defaultTargetScore: z.number().int().nullable().optional(),
  completionThreshold: z.number().int().nullable().optional(), endedAt: DateTimeWireSchema.nullable().optional(), endReason: TrainingStageEndReasonSchema.nullable().optional(), endNote: z.string().nullable().optional(),
  Groups: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()), Problems: z.array(TrainingRuntimeProblemSchema),
}).passthrough()
export const TrainingWorkspaceSchema = z.object({
  session: z.object({
    id: z.string(), title: z.string(), description: z.string().nullable().optional(), sessionType: z.string(), status: z.string(),
    statusRevision: z.number().int(), currentStageId: z.string().nullable().optional(), pauseMode: z.string().nullable().optional(),
    rankingMode: z.string(), peerVisibility: z.string(), joinMode: z.string(), teamId: z.string().nullable().optional(),
    Stages: z.array(TrainingRuntimeStageSchema), Overlays: z.array(z.object({ id: z.string(), type: z.string(), targetType: z.string().nullable().optional(), targetId: z.string().nullable().optional(), payload: JsonObjectSchema.nullable().optional() }).passthrough()),
  }).passthrough(),
  manager: z.boolean(), participant: z.object({ id: z.string(), currentProblemId: z.string().nullable().optional(), currentStageId: z.string().nullable().optional(), currentGroupId: z.string().nullable().optional(), requiredCount: z.number().int().optional(), completedCount: z.number().int().optional() }).passthrough().nullable().optional(),
  progress: z.array(z.object({ stageProblemId: z.string(), status: z.string(), bestScore: z.number().nullable().optional(), attemptCount: z.number().int(), activeSeconds: z.number().int().optional(), continuousActiveSeconds: z.number().int().optional() }).passthrough()),
  permissions: z.record(z.string(), z.object({ canSeeMetadata: z.boolean().optional(), canView: z.boolean(), canSubmit: z.boolean(), canEdit: z.boolean(), reason: z.string() }).passthrough()),
  strategy: z.record(z.string(), z.object({ timePolicy: JsonObjectSchema, timeLimitReached: z.boolean(), decisionDue: z.boolean(), switchRecommended: z.boolean() }).passthrough()),
})
export const TrainingRosterSchema = z.object({
  revision: z.number().int().nonnegative(),
  candidates: z.array(z.object({ userId: z.string(), username: z.string(), displayName: z.string(), role: z.string(), avatar: z.string().nullable().optional(), selected: z.boolean() })),
})
export const TrainingCoachDashboardSchema = z.object({
  session: z.object({ id: z.string(), title: z.string(), status: z.string(), currentStageId: z.string().nullable().optional() }),
  participants: z.array(z.object({
    id: z.string(),
    user: TrainingUserSummarySchema,
    currentStageId: z.string().nullable().optional(),
    currentProblemId: z.string().nullable().optional(),
    currentGroupId: z.string().nullable().optional(),
    activeSeconds: z.number().int(),
    online: z.boolean(),
    requiredCount: z.number().int(),
    completedCount: z.number().int(),
    completed: z.boolean(),
    requirements: z.array(z.object({ stageProblemId: z.string(), state: z.enum(['REQUIRED', 'SATISFIED', 'BYPASSED', 'RETIRED']) })).optional(),
    progress: z.array(z.object({ status: z.string() }).passthrough()),
  }).passthrough()),
  summary: z.object({ total: z.number().int(), working: z.number().int(), stuck: z.number().int(), completed: z.number().int() }),
})
export const TrainingReportSchema = z.object({
  timeline: z.array(z.object({ id: z.string(), name: z.string(), kind: TrainingStageKindSchema, lifecycle: TrainingStageLifecycleSchema, plannedDurationSeconds: z.number().int().nullable().optional(), extensionSeconds: z.number().int(), activeElapsedSeconds: z.number().int(), endedAt: DateTimeWireSchema.nullable().optional(), endReason: TrainingStageEndReasonSchema.nullable().optional(), endNote: z.string().nullable().optional(), snapshotHash: z.string().nullable().optional() })),
  groupChanges: z.array(z.object({ stageId: z.string(), participantId: z.string(), fromGroupId: z.string().nullable().optional(), toGroupId: z.string(), effectiveMode: z.string(), reason: z.string(), effectiveAt: DateTimeWireSchema.nullable().optional(), requestedAt: DateTimeWireSchema })),
  participants: z.array(z.object({ user: TrainingUserSummarySchema, activeSeconds: z.number().int(), problems: z.array(z.object({ problemId: z.string(), title: z.string(), status: z.string(), requirementState: z.enum(['REQUIRED', 'SATISFIED', 'BYPASSED', 'RETIRED']), activeSeconds: z.number().int(), attemptCount: z.number().int(), bestScore: z.number().nullable().optional(), bestVerdict: z.string().nullable().optional(), hintCount: z.number().int() }).passthrough()) })),
})

export const TrainingSessionSummarySchema = z.object({
  id: z.string(), title: z.string(), description: z.string().nullable().optional(), status: z.string(), sessionType: z.string(),
  statusRevision: z.number().int().optional(), problemCount: z.number().int().optional(), dueAt: DateTimeWireSchema.nullable().optional(), canJoin: z.boolean().optional(),
  teamId: z.string().nullable().optional(), teamName: z.string().nullable().optional(),
  _count: z.object({ Stages: z.number().int(), Participants: z.number().int() }).optional(),
}).passthrough()
export const TrainingSessionListQuerySchema = z.object({ organizationId: z.string().optional(), teamId: z.string().optional(), filterTeamId: z.string().optional(), statusGroup: z.enum(['active', 'upcoming', 'completed', 'draft']).optional(), keyword: z.string().max(200).optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() })
export const TrainingSessionListSchema = z.union([
  z.array(TrainingSessionSummarySchema),
  z.object({ items: z.array(TrainingSessionSummarySchema), statusCounts: z.record(z.string(), z.number().int()), pagination: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }) }),
])
const TrainingSessionCreateProblemInputSchema = TrainingStructureProblemInputSchema.partial({ clientKey: true, testSetRevisionId: true })
const TrainingSessionCreateGroupInputSchema = TrainingStructureGroupInputSchema.omit({ problems: true }).partial({ clientKey: true }).extend({
  problems: z.array(TrainingSessionCreateProblemInputSchema).default([]),
})
const TrainingSessionCreateStageInputSchema = TrainingStructureStageInputSchema.omit({ problems: true, groups: true }).partial({ clientKey: true }).extend({
  problems: z.array(TrainingSessionCreateProblemInputSchema).default([]),
  groups: z.array(TrainingSessionCreateGroupInputSchema).default([]),
})
export const TrainingSessionCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), templateKey: z.string().optional(), sessionType: z.enum(['OI', 'ACM', 'GENERAL']).optional(),
  organizationId: z.string().optional(), teamId: z.string().optional(), participantUserIds: z.array(z.string()).max(5000).optional(), scheduledStartAt: DateTimeWireSchema.nullable().optional(),
  rankingMode: z.enum(['OFF', 'PROGRESS_ONLY', 'SCORE', 'ACM_RANKING']).optional(), peerVisibility: z.enum(['NONE', 'PROGRESS', 'SCORE', 'FULL']).optional(), joinMode: z.enum(['CURRENT_STAGE', 'TEACHER_ASSIGN']).optional(),
  allowHints: z.boolean().optional(), allowSolution: z.boolean().optional(), allowDiscussion: z.boolean().optional(),
  defaultAccessPolicy: TrainingStageAccessPolicySchema.optional(), defaultSubmissionMode: z.enum(['ENABLED', 'DISABLED']).optional(),
  settings: JsonObjectSchema.optional(), stages: z.array(TrainingSessionCreateStageInputSchema).min(1).max(100).optional(),
})
export const TrainingParticipantPreviewInputSchema = z.object({ organizationId: z.string().optional(), teamId: z.string().optional(), participantTarget: z.enum(['team', 'organization_students', 'custom_students']), participantUserIds: z.array(z.string()).max(5000).optional() })
export const TrainingParticipantPreviewSchema = z.object({ participantCount: z.number().int(), targetName: z.string() })
export const TrainingExpectedRevisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() })
export const TrainingCommandInputSchema = z.object({ type: z.enum(['PAUSE_SESSION', 'RESUME_SESSION', 'FOCUS_PROBLEM', 'END_FOCUS', 'LOCK_PROBLEM', 'UNLOCK_PROBLEM', 'ENABLE_SUBMISSION', 'DISABLE_SUBMISSION', 'OPEN_HINT', 'CLOSE_HINT', 'UNLOCK_FOR_USER', 'SKIP_FOR_USER', 'SHOW_MESSAGE', 'CLEAR_MESSAGE']), expectedRevision: z.number().int().nonnegative(), targetType: z.enum(['ALL', 'GROUP', 'TEAM', 'USER']).default('ALL'), targetId: z.string().nullable().optional(), payload: JsonObjectSchema.default({}) })
export const TrainingHeartbeatInputSchema = z.object({ stageProblemId: z.string(), pageVisible: z.boolean(), editorFocused: z.boolean() })
export const TrainingDraftSchema = z.object({ code: z.string().optional(), language: z.string().optional(), revision: z.number().int().optional(), inputFilename: z.string().nullable().optional(), outputFilename: z.string().nullable().optional() }).passthrough()
export const TrainingDraftInputSchema = z.object({ code: z.string(), language: z.string(), inputFilename: z.string().nullable().optional(), outputFilename: z.string().nullable().optional(), expectedRevision: z.number().int().optional(), editorFocused: z.boolean().optional() })
export const TrainingSubmitInputSchema = z.object({ stageProblemId: z.string(), code: z.string().min(1).max(1024 * 1024), language: z.string().min(1).max(30), inputFilename: z.string().nullable().optional(), outputFilename: z.string().nullable().optional() })
export const TrainingSubmitResultSchema = z.object({ id: z.number().int() }).passthrough()
export const TrainingHintSchema = z.object({ id: z.string(), level: z.number().int(), title: z.string().nullable().optional(), content: z.string().nullable().optional(), openMode: z.string().optional(), triggerSeconds: z.number().int().nullable().optional(), triggerAttempts: z.number().int().nullable().optional(), triggerScore: z.number().int().nullable().optional(), opened: z.boolean().optional(), globallyOpenedAt: DateTimeWireSchema.nullable().optional() }).passthrough()
export const TrainingHintCreateInputSchema = z.object({ stageProblemId: z.string(), level: z.number().int().min(1).max(20), title: z.string().max(100).optional(), content: z.string().min(1).max(5000), openMode: z.enum(['MANUAL', 'TIME', 'ATTEMPT', 'SCORE']), triggerSeconds: z.number().int().min(60).max(86400).optional(), triggerAttempts: z.number().int().min(1).max(100).optional(), triggerScore: z.number().int().min(0).max(100).optional() })
export const TrainingHintUpdateInputSchema = TrainingHintCreateInputSchema.omit({ stageProblemId: true })
export const TrainingHintDeleteResultSchema = z.object({ deleted: z.literal(true) })
export const TrainingStrategyDecisionInputSchema = z.object({ stageProblemId: z.string().optional(), decision: z.string().min(1).max(100), reason: z.string().max(2000).optional() })
export const TrainingPeerProgressSchema = z.object({ rankingMode: z.string(), peerVisibility: z.string(), entries: z.array(z.object({ rank: z.number().int().optional(), user: TrainingUserSummarySchema, completed: z.number().int(), total: z.number().int(), score: z.number().optional(), attempts: z.number().int().optional(), penaltyMinutes: z.number().int().optional(), activeSeconds: z.number().int().optional() }).passthrough()) })
export const TrainingGroupSuggestionSchema = z.object({ stageId: z.string(), suggestions: z.array(z.object({ participantId: z.string(), user: TrainingUserSummarySchema, groupId: z.string(), groupName: z.string(), reason: z.string() })) })

export const TrainingContracts = {
  listSessions: defineApiEndpoint({ key: 'training.sessions.list', method: 'GET', scope: 'organization', query: TrainingSessionListQuerySchema, data: TrainingSessionListSchema }),
  createSession: defineApiEndpoint({ key: 'training.sessions.create', method: 'POST', scope: 'organization', body: TrainingSessionCreateInputSchema, data: TrainingSessionSummarySchema }),
  previewParticipants: defineApiEndpoint({ key: 'training.participants.preview', method: 'POST', scope: 'organization', body: TrainingParticipantPreviewInputSchema, data: TrainingParticipantPreviewSchema }),
  listTemplates: defineApiEndpoint({ key: 'training.templates.list', method: 'GET', scope: 'account', query: TrainingTemplateListQuerySchema, data: z.array(TrainingTemplateSchema) }),
  createTemplate: defineApiEndpoint({ key: 'training.templates.create', method: 'POST', scope: 'account', body: TrainingTemplateCreateInputSchema, data: TrainingTemplateSchema }),
  deleteTemplate: defineApiEndpoint({ key: 'training.templates.delete', method: 'DELETE', scope: 'account', data: TrainingTemplateDeleteResultSchema }),
  getDesign: defineApiEndpoint({ key: 'training.design', method: 'GET', scope: 'organization', data: TrainingDesignSchema }),
  getDesignProblem: defineApiEndpoint({ key: 'training.design.problem', method: 'GET', scope: 'organization', data: TrainingDesignProblemLookupSchema }),
  publish: defineApiEndpoint({ key: 'training.publish', method: 'POST', scope: 'organization', body: z.object({ expectedRevision: z.number().int().nonnegative() }), data: z.object({ id: z.string(), status: z.string(), statusRevision: z.number().int() }).passthrough() }),
  validateStructure: defineApiEndpoint({ key: 'training.structure.validate', method: 'POST', scope: 'organization', body: TrainingStructureInputSchema, data: TrainingStructureValidationSchema }),
  replaceStructure: defineApiEndpoint({ key: 'training.structure.replace', method: 'PUT', scope: 'organization', body: TrainingStructureInputSchema, data: TrainingDesignSchema }),
  transitionStage: defineApiEndpoint({ key: 'training.stage.transition', method: 'POST', scope: 'organization', body: TrainingStageTransitionInputSchema, data: TrainingWorkspaceSchema }),
  changeStageGroup: defineApiEndpoint({ key: 'training.stage.group.change', method: 'POST', scope: 'organization', body: TrainingStageGroupChangeInputSchema, data: TrainingWorkspaceSchema }),
  extendStageTime: defineApiEndpoint({ key: 'training.stage.time.extend', method: 'POST', scope: 'organization', body: TrainingStageTimeExtensionInputSchema, data: TrainingWorkspaceSchema }),
  getWorkspace: defineApiEndpoint({ key: 'training.workspace', method: 'GET', scope: 'organization', data: TrainingWorkspaceSchema }),
  getRoster: defineApiEndpoint({ key: 'training.roster.get', method: 'GET', scope: 'organization', data: TrainingRosterSchema }),
  replaceRoster: defineApiEndpoint({ key: 'training.roster.replace', method: 'PUT', scope: 'organization', body: TrainingRosterInputSchema, data: TrainingWorkspaceSchema }),
  getCoachDashboard: defineApiEndpoint({ key: 'training.coach-dashboard', method: 'GET', scope: 'organization', data: TrainingCoachDashboardSchema }),
  getReport: defineApiEndpoint({ key: 'training.report', method: 'GET', scope: 'organization', data: TrainingReportSchema }),
  archiveSession: defineApiEndpoint({ key: 'training.archive', method: 'POST', scope: 'organization', body: TrainingExpectedRevisionSchema, data: TrainingSessionSummarySchema }),
  joinSession: defineApiEndpoint({ key: 'training.join', method: 'POST', scope: 'organization', body: z.object({}).default({}), data: z.object({ id: z.string() }).passthrough() }),
  executeCommand: defineApiEndpoint({ key: 'training.command', method: 'POST', scope: 'organization', body: TrainingCommandInputSchema, data: z.object({ id: z.string(), status: z.string(), statusRevision: z.number().int() }).passthrough() }),
  heartbeat: defineApiEndpoint({ key: 'training.heartbeat', method: 'POST', scope: 'organization', body: TrainingHeartbeatInputSchema, data: z.object({ participant: z.object({ id: z.string() }).passthrough(), progress: z.object({ stageProblemId: z.string(), status: z.string() }).passthrough() }) }),
  getDraft: defineApiEndpoint({ key: 'training.draft.get', method: 'GET', scope: 'organization', data: TrainingDraftSchema.nullable() }),
  saveDraft: defineApiEndpoint({ key: 'training.draft.save', method: 'PUT', scope: 'organization', body: TrainingDraftInputSchema, data: TrainingDraftSchema }),
  submit: defineApiEndpoint({ key: 'training.submit', method: 'POST', scope: 'organization', body: TrainingSubmitInputSchema, data: TrainingSubmitResultSchema }),
  createHint: defineApiEndpoint({ key: 'training.hint.create', method: 'POST', scope: 'organization', body: TrainingHintCreateInputSchema, data: TrainingHintSchema }),
  updateHint: defineApiEndpoint({ key: 'training.hint.update', method: 'PATCH', scope: 'organization', body: TrainingHintUpdateInputSchema, data: TrainingHintSchema }),
  deleteHint: defineApiEndpoint({ key: 'training.hint.delete', method: 'DELETE', scope: 'organization', data: TrainingHintDeleteResultSchema }),
  listHints: defineApiEndpoint({ key: 'training.hint.list', method: 'GET', scope: 'organization', data: z.array(TrainingHintSchema) }),
  openHint: defineApiEndpoint({ key: 'training.hint.open', method: 'POST', scope: 'organization', body: z.object({}).default({}), data: TrainingHintSchema }),
  recordStrategy: defineApiEndpoint({ key: 'training.strategy.record', method: 'POST', scope: 'organization', body: TrainingStrategyDecisionInputSchema, data: z.object({ id: z.string() }).passthrough() }),
  getPeerProgress: defineApiEndpoint({ key: 'training.peer-progress', method: 'GET', scope: 'organization', data: TrainingPeerProgressSchema }),
  getGroupSuggestions: defineApiEndpoint({ key: 'training.group-suggestions', method: 'GET', scope: 'organization', data: TrainingGroupSuggestionSchema }),
} as const

export type TrainingDesign = z.infer<typeof TrainingDesignSchema>
export type TrainingStructureInput = z.infer<typeof TrainingStructureInputSchema>
export type TrainingWorkspace = z.infer<typeof TrainingWorkspaceSchema>
export type TrainingRoster = z.infer<typeof TrainingRosterSchema>
export type TrainingCoachDashboard = z.infer<typeof TrainingCoachDashboardSchema>
export type TrainingReport = z.infer<typeof TrainingReportSchema>
export type TrainingTemplate = z.infer<typeof TrainingTemplateSchema>
