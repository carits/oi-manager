import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const SubmissionCaseResultSchema = z.object({
  caseId: z.union([z.number(), z.string()]).optional(),
  subtaskId: z.union([z.number(), z.string()]).optional(),
  result: z.string(),
  time: z.number().nullable().optional(),
  memory: z.number().nullable().optional(),
  score: z.number().nullable().optional(),
  message: z.string().nullable().optional(),
})

export const SubmissionSubtaskResultSchema = z.object({
  id: z.union([z.number(), z.string()]),
  type: z.string().optional(),
  score: z.number(),
  cases: z.array(SubmissionCaseResultSchema).optional(),
})

const InputIoSchema = z.union([
  z.object({ type: z.literal('stdin') }),
  z.object({ type: z.literal('file'), filename: z.string() }),
])
const OutputIoSchema = z.union([
  z.object({ type: z.literal('stdout') }),
  z.object({ type: z.literal('file'), filename: z.string() }),
])

export const SubmissionDetailSchema = z.object({
  id: z.number().int().positive(), userId: z.string().optional(), username: z.string(),
  submitterName: z.string().optional(), submitterAvatar: z.string().nullable().optional(),
  oj: z.string().optional(), problemId: z.string().optional(), problemTitle: z.string().nullable().optional(),
  problemSourceHidden: z.boolean().optional(), problemIdentityHidden: z.boolean().optional(),
  sourcePlatform: z.string().nullable().optional(), sourceProblemId: z.string().nullable().optional(),
  result: z.string().nullable(), displayResult: z.string().optional(), hidden: z.boolean().optional(),
  timeUsed: z.number().nullable(), memoryUsed: z.number().nullable(), wallTimeUsed: z.number().nullable().optional(),
  timeoutReason: z.string().nullable().optional(), metricSource: z.string().nullable().optional(),
  score: z.number().nullable().optional(), cases: z.array(SubmissionCaseResultSchema).nullable().optional(),
  subtasks: z.array(SubmissionSubtaskResultSchema).nullable().optional(), codeLength: z.number().int().nonnegative(),
  language: z.string(), code: z.string().nullable(), canViewCode: z.boolean().optional(), submitMethod: z.string(),
  ojRemoteId: z.string().nullable(), hideRemoteId: z.boolean().optional(),
  ojAccountUsername: z.string().nullable().optional(), submittedAt: DateTimeWireSchema,
  errorMessage: z.string().nullable(), judgeMode: z.enum(['acm', 'oi']).optional(),
  trainingId: z.number().int().nullable().optional(), trainingProblemId: z.string().nullable().optional(),
  problemAlias: z.string().nullable().optional(), problemOrderIndex: z.number().int().nullable().optional(),
  contestFormat: z.string().nullable().optional(),
  io: z.object({ input: InputIoSchema, output: OutputIoSchema }).optional(),
})

export type SubmissionDetail = z.infer<typeof SubmissionDetailSchema>

export const SubmissionContracts = {
  detail: defineApiEndpoint({ key: 'submission.detail', method: 'GET', scope: 'context', data: SubmissionDetailSchema }),
} as const
