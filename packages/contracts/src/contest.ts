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
  createMakeupHomework: defineApiEndpoint({
    key: 'contest.makeup-homework.create', method: 'POST', scope: 'context',
    body: ContestMakeupHomeworkInputSchema, data: ContestMakeupHomeworkSchema,
  }),
} as const

export type ContestSubmissionUser = z.infer<typeof ContestSubmissionUserSchema>
export type ContestMakeupHomeworkInput = z.infer<typeof ContestMakeupHomeworkInputSchema>
export type ContestMakeupHomework = z.infer<typeof ContestMakeupHomeworkSchema>
