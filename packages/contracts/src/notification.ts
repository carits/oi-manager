import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const NotificationFilterSchema = z.enum(['all', 'unread', 'actionable'])
export type NotificationFilter = z.infer<typeof NotificationFilterSchema>

export const NotificationActionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  style: z.enum(['primary', 'secondary']).or(z.string().min(1)),
})

export const UserNotificationSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  href: z.string().nullable().optional(),
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  organizationId: z.string().nullable().optional(),
  organizationName: z.string().nullable().optional(),
  actionable: z.boolean(),
  actions: z.array(NotificationActionSchema).default([]),
  readAt: DateTimeWireSchema.nullable().optional(),
  createdAt: DateTimeWireSchema,
})
export type UserNotification = z.infer<typeof UserNotificationSchema>

export const NotificationPageSchema = z.object({
  notifications: z.array(UserNotificationSchema),
  unreadCount: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(50),
  hasMore: z.boolean(),
})
export type NotificationPage = z.infer<typeof NotificationPageSchema>

const NotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  take: z.coerce.number().int().min(1).max(50).optional(),
  filter: NotificationFilterSchema.default('all'),
  view: z.enum(['account']).optional(),
})

const NotificationReadResultSchema = z.object({
  changed: z.union([z.boolean(), z.number().int().nonnegative()]),
  unreadCount: z.number().int().nonnegative(),
})

export const NotificationContracts = {
  list: defineApiEndpoint({
    key: 'notification.list', method: 'GET', scope: 'context',
    data: NotificationPageSchema, query: NotificationQuerySchema,
  }),
  read: defineApiEndpoint({
    key: 'notification.read', method: 'PATCH', scope: 'context',
    data: NotificationReadResultSchema, body: z.object({}),
    query: z.object({ view: z.enum(['account']).optional() }),
  }),
  readAll: defineApiEndpoint({
    key: 'notification.read-all', method: 'POST', scope: 'context',
    data: NotificationReadResultSchema, body: z.object({}),
    query: z.object({ view: z.enum(['account']).optional() }),
  }),
} as const
