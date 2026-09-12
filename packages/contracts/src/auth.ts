import { z } from 'zod'
import { LegacyUserRoleSchema } from './identity'

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  workspaceMode: z.enum(['work', 'personal']).optional(),
  mode: z.enum(['campus', 'personal']).optional(),
})
export type LoginRequestContract = z.infer<typeof LoginRequestSchema>

/** Browser authentication is Cookie-only. A bearer token is never returned. */
export const LoginResponseDataSchema = z.object({
  userId: z.string().min(1),
  accountRole: z.enum(['user', 'platform_admin', 'super_admin']),
  role: LegacyUserRoleSchema,
  username: z.string().min(1),
  workspaceMode: z.enum(['work', 'personal']),
  avatar: z.string().nullable().optional(),
  next: z.string().startsWith('/'),
})
export type LoginResponseData = z.infer<typeof LoginResponseDataSchema>
