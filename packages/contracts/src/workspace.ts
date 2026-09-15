import { z } from 'zod'
import { defineApiEndpoint } from './http'

const WorkspaceBaseSchema = z.object({
  availableModules: z.array(z.string().min(1)),
})

export const WorkspaceSummarySchema = z.discriminatedUnion('type', [
  WorkspaceBaseSchema.extend({
    type: z.literal('personal'), organizationId: z.never().optional(), organizationName: z.never().optional(),
    relationLabel: z.never().optional(),
  }),
  WorkspaceBaseSchema.extend({
    type: z.literal('platform'),
    organizationId: z.never().optional(),
    organizationName: z.string().min(1).optional(), memberRole: z.string().min(1).optional(),
    relationLabel: z.string().min(1).optional(),
  }),
  WorkspaceBaseSchema.extend({
    type: z.literal('organization'), organizationId: z.string().min(1), organizationName: z.string().min(1),
    organizationType: z.string().min(1), organizationMembershipId: z.string().min(1),
    shortName: z.string().nullable().optional(), memberRole: z.string().min(1), relationType: z.string().min(1),
    relationLabel: z.string().min(1),
  }),
])
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>

export const WorkspaceListSchema = z.object({
  workspaces: z.array(WorkspaceSummarySchema),
})
export type WorkspaceList = z.infer<typeof WorkspaceListSchema>

export const WorkspaceContracts = {
  list: defineApiEndpoint({
    key: 'workspace.list',
    method: 'GET',
    scope: 'account',
    data: WorkspaceListSchema,
  }),
} as const
