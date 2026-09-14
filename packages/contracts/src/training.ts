import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, FieldIssueSchema } from './http'

const NullableNumber = z.number().nullable().optional()
const TrainingIssueSchema = FieldIssueSchema.extend({
  severity: z.enum(['error', 'warning']),
})

export const TrainingUnlockConditionSchema = z.looseObject({
  type: z.enum(['AC', 'SCORE', 'TIME', 'ATTEMPTS', 'TEACHER']),
  value: z.number().optional(),
})

export const TrainingUnlockPolicySchema = z.looseObject({
  mode: z.enum(['ANY', 'ALL']),
  conditions: z.array(TrainingUnlockConditionSchema),
})

export const TrainingStructureProblemInputSchema = z.looseObject({
  assignmentId: z.string().optional(),
  clientKey: z.string().min(1),
  problemId: z.string().min(1),
  testSetRevisionId: z.string().min(1),
  alias: z.string().nullable().optional(),
  unlockPolicy: TrainingUnlockPolicySchema.optional(),
  targetScore: NullableNumber,
  timeLimitSeconds: NullableNumber,
  allowedSubtaskIds: z.array(z.number().int()),
  strategyIntervalSeconds: NullableNumber,
  maxContinuousWorkSeconds: NullableNumber,
  forceSwitchOnTimeout: z.boolean(),
})

export const TrainingStructureStageInputSchema = z.looseObject({
  id: z.string().optional(),
  clientKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  mode: z.string().min(1),
  durationSeconds: NullableNumber,
  advanceMode: z.string().min(1),
  problemAccessMode: z.string().min(1),
  submissionMode: z.string().min(1),
  targetScore: NullableNumber,
  completionThreshold: NullableNumber,
  minDurationSeconds: NullableNumber,
  rules: z.record(z.string(), z.unknown()).optional(),
  problems: z.array(TrainingStructureProblemInputSchema),
})

export const TrainingStructureInputSchema = z.looseObject({
  expectedRevision: z.number().int().nonnegative(),
  title: z.string().min(1),
  description: z.string(),
  confirmDependentRemoval: z.boolean().optional(),
  stages: z.array(TrainingStructureStageInputSchema),
})

export const TrainingDesignProblemSchema = z.looseObject({
  id: z.string().optional(),
  assignmentId: z.string().optional(),
  clientKey: z.string().optional(),
  problemId: z.string(),
  testSetRevisionId: z.string(),
  alias: z.string().nullable().optional(),
  unlockPolicy: TrainingUnlockPolicySchema.nullable().optional(),
  targetScore: NullableNumber,
  timeLimitSeconds: NullableNumber,
  strategyIntervalSeconds: NullableNumber,
  maxContinuousWorkSeconds: NullableNumber,
  forceSwitchOnTimeout: z.boolean().optional(),
  allowedSubtaskIds: z.array(z.number().int()).optional(),
  Problem: z.looseObject({
    id: z.string(),
    platform: z.string(),
    problemId: z.string(),
    title: z.string(),
  }),
  TestSetRevision: z.looseObject({
    id: z.string(),
    revisionNumber: z.number().int(),
    mode: z.string().optional(),
  }),
  latestRevision: z.looseObject({
    id: z.string(),
    revisionNumber: z.number().int(),
    mode: z.string().optional(),
  }).nullable().optional(),
  subtasks: z.array(z.looseObject({
    id: z.number().int(),
    score: z.number(),
    dependencies: z.array(z.number().int()).optional(),
  })).optional(),
})

export const TrainingDesignStageSchema = z.looseObject({
  id: z.string(),
  clientKey: z.string().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  mode: z.string(),
  durationSeconds: NullableNumber,
  advanceMode: z.string(),
  problemAccessMode: z.string(),
  submissionMode: z.string(),
  targetScore: NullableNumber,
  completionThreshold: NullableNumber,
  minDurationSeconds: NullableNumber,
  rules: z.record(z.string(), z.unknown()).nullable().optional(),
  Problems: z.array(TrainingDesignProblemSchema),
})

export const TrainingDesignSchema = z.looseObject({
  editable: z.boolean(),
  statusRevision: z.number().int().nonnegative(),
  session: z.looseObject({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    sessionType: z.string(),
    organizationId: z.string().nullable().optional(),
    teamId: z.string().nullable().optional(),
    scheduledStartAt: DateTimeWireSchema.nullable().optional(),
  }),
  stages: z.array(TrainingDesignStageSchema),
  issues: z.array(TrainingIssueSchema),
})

export const TrainingStructureValidationSchema = z.looseObject({
  valid: z.boolean(),
  issues: z.array(TrainingIssueSchema),
})

export const TrainingContracts = {
  getDesign: defineApiEndpoint({
    key: 'training.design',
    method: 'GET',
    scope: 'organization',
    data: TrainingDesignSchema,
  }),
  validateStructure: defineApiEndpoint({
    key: 'training.structure.validate',
    method: 'POST',
    scope: 'organization',
    body: TrainingStructureInputSchema,
    data: TrainingStructureValidationSchema,
  }),
  replaceStructure: defineApiEndpoint({
    key: 'training.structure.replace',
    method: 'PUT',
    scope: 'organization',
    body: TrainingStructureInputSchema,
    data: TrainingDesignSchema,
  }),
} as const

export type TrainingDesign = z.infer<typeof TrainingDesignSchema>
export type TrainingStructureInput = z.infer<typeof TrainingStructureInputSchema>
