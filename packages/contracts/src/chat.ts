import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, PaginationMetaSchema, PaginationQuerySchema } from './http'

export const ChatUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  avatar: z.string().nullable().optional(),
  discovery: z.enum(['shared', 'exact']).optional(),
})
export type ChatUser = z.infer<typeof ChatUserSchema>

export const ChatPrivacySchema = z.object({
  allowExactUsernameDiscovery: z.boolean(),
})
export type ChatPrivacy = z.infer<typeof ChatPrivacySchema>

export const ChatStickerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  assetUrl: z.string().min(1),
  posterUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  animated: z.boolean(),
})
export type ChatSticker = z.infer<typeof ChatStickerSchema>

export const ChatStickerPackSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  stickers: z.array(ChatStickerSchema),
})
export type ChatStickerPack = z.infer<typeof ChatStickerPackSchema>

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  senderUserId: z.string().min(1),
  seq: z.number().int().positive(),
  content: z.string(),
  type: z.enum(['text', 'sticker']),
  sticker: ChatStickerSchema.optional(),
  createdAt: DateTimeWireSchema,
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatMessagePageSchema = z.object({
  items: z.array(ChatMessageSchema),
  page: z.object({
    hasMoreBefore: z.boolean(),
    hasMoreAfter: z.boolean(),
    oldestSeq: z.number().int().positive().optional(),
    newestSeq: z.number().int().positive().optional(),
  }),
})
export type ChatMessagePage = z.infer<typeof ChatMessagePageSchema>

export const ChatConversationSchema = z.object({
  id: z.string().min(1),
  other: ChatUserSchema,
  lastMessageSeq: z.number().int().nonnegative(),
  lastMessagePreview: z.string().nullable().optional(),
  lastMessageAt: DateTimeWireSchema.nullable().optional(),
  unreadCount: z.number().int().nonnegative(),
  archivedAt: DateTimeWireSchema.nullable().optional(),
  canSend: z.boolean(),
})
export type ChatConversation = z.infer<typeof ChatConversationSchema>

export const ChatConversationPageSchema = z.object({
  items: z.array(ChatConversationSchema),
  nextCursor: z.string().nullable().optional(),
})
export type ChatConversationPage = z.infer<typeof ChatConversationPageSchema>

export const ChatFriendSchema = z.object({
  friendshipId: z.string().min(1),
  since: DateTimeWireSchema,
  user: ChatUserSchema,
})
export type ChatFriend = z.infer<typeof ChatFriendSchema>

export const ChatFriendRequestStatusSchema = z.enum([
  'pending', 'accepted', 'rejected', 'cancelled', 'expired', 'blocked',
])
const ChatFriendRequestBaseSchema = z.object({
  id: z.string().min(1),
  requesterId: z.string().min(1),
  addresseeId: z.string().min(1),
  message: z.string().nullable().optional(),
  status: ChatFriendRequestStatusSchema,
  createdAt: DateTimeWireSchema,
  expiresAt: DateTimeWireSchema.optional(),
  respondedAt: DateTimeWireSchema.nullable().optional(),
})
export const ChatFriendRequestSchema = ChatFriendRequestBaseSchema.extend({
  Requester: ChatUserSchema,
  Addressee: ChatUserSchema,
})
export type ChatFriendRequest = z.infer<typeof ChatFriendRequestSchema>

export const ChatBlockSchema = z.object({
  id: z.string().min(1),
  blockedId: z.string().min(1),
  Blocked: ChatUserSchema,
})
export type ChatBlock = z.infer<typeof ChatBlockSchema>

export const ChatUnreadSchema = z.object({
  messageUnread: z.number().int().nonnegative(),
  pendingFriendRequests: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})
export type ChatUnread = z.infer<typeof ChatUnreadSchema>

export const ChatReportStatusSchema = z.enum(['pending', 'resolved', 'dismissed'])
export type ChatReportStatus = z.infer<typeof ChatReportStatusSchema>

const ChatReportPartySchema = z.object({ username: z.string().min(1) })

export const ChatReportSummarySchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  status: ChatReportStatusSchema,
  createdAt: DateTimeWireSchema,
  reviewedAt: DateTimeWireSchema.nullable().optional(),
  evidenceReleasedAt: DateTimeWireSchema.nullable().optional(),
  Reporter: ChatReportPartySchema,
  Target: ChatReportPartySchema,
})
export type ChatReportSummary = z.infer<typeof ChatReportSummarySchema>

export const ChatReportEvidenceMessageSchema = z.object({
  id: z.string().min(1),
  senderUserId: z.string().min(1),
  seq: z.number().int().positive(),
  messageType: z.enum(['text', 'sticker']).optional(),
  stickerId: z.string().nullable().optional(),
  content: z.string(),
  createdAt: DateTimeWireSchema,
  Sender: ChatReportPartySchema.optional(),
  Sticker: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    sha256: z.string().optional(),
    Pack: z.object({ key: z.string(), version: z.number().int().positive() }).optional(),
  }).nullable().optional(),
})
export type ChatReportEvidenceMessage = z.infer<typeof ChatReportEvidenceMessageSchema>

const ReleasedChatReportEvidenceSchema = z.object({
  released: z.literal(true),
  releasedAt: DateTimeWireSchema,
  sha256: z.string().min(1),
  itemCount: z.number().int().nonnegative().optional(),
})

export const ChatReportDetailSchema = ChatReportSummarySchema.extend({
  messageId: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  evidenceSnapshot: z.union([z.array(ChatReportEvidenceMessageSchema), ReleasedChatReportEvidenceSchema]),
  resolutionNote: z.string().nullable().optional(),
})
export type ChatReportDetail = z.infer<typeof ChatReportDetailSchema>

export const ChatReportListSchema = z.object({
  items: z.array(ChatReportSummarySchema),
  pagination: PaginationMetaSchema,
})
export type ChatReportList = z.infer<typeof ChatReportListSchema>

export const ChatReportReviewResultSchema = z.object({
  id: z.string().min(1),
  status: ChatReportStatusSchema,
  reviewedAt: DateTimeWireSchema.nullable().optional(),
  resolutionNote: z.string().nullable().optional(),
})
export type ChatReportReviewResult = z.infer<typeof ChatReportReviewResultSchema>

const EmptyBodySchema = z.object({})
const ConversationListQuerySchema = z.object({
  pagination: z.literal('v2'),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  scope: z.enum(['active', 'archived', 'all']).default('active'),
  cursor: z.string().min(1).optional(),
})
const MessageListQuerySchema = z.object({
  pagination: z.literal('v2'),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  beforeSeq: z.coerce.number().int().positive().optional(),
  afterSeq: z.coerce.number().int().nonnegative().optional(),
}).refine(value => value.beforeSeq === undefined || value.afterSeq === undefined, {
  message: 'beforeSeq 与 afterSeq 不能同时使用',
})

export const ChatContracts = {
  getPrivacy: defineApiEndpoint({
    key: 'chat.privacy.get', method: 'GET', scope: 'account', data: ChatPrivacySchema,
  }),
  updatePrivacy: defineApiEndpoint({
    key: 'chat.privacy.update', method: 'PATCH', scope: 'account', data: ChatPrivacySchema,
    body: ChatPrivacySchema,
  }),
  searchUsers: defineApiEndpoint({
    key: 'chat.users.search', method: 'GET', scope: 'account', data: z.array(ChatUserSchema),
    query: z.object({ q: z.string().trim().min(2).max(64) }),
  }),
  listFriends: defineApiEndpoint({
    key: 'chat.friends.list', method: 'GET', scope: 'account', data: z.array(ChatFriendSchema),
  }),
  removeFriend: defineApiEndpoint({
    key: 'chat.friends.remove', method: 'DELETE', scope: 'account', data: z.object({ removed: z.literal(true) }), body: EmptyBodySchema,
  }),
  createFriendRequest: defineApiEndpoint({
    key: 'chat.friendRequests.create', method: 'POST', scope: 'account', data: ChatFriendRequestBaseSchema,
    body: z.object({ addresseeId: z.string().min(1), message: z.string().trim().max(500).optional() }),
  }),
  listFriendRequests: defineApiEndpoint({
    key: 'chat.friendRequests.list', method: 'GET', scope: 'account', data: z.array(ChatFriendRequestSchema),
  }),
  respondFriendRequest: defineApiEndpoint({
    key: 'chat.friendRequests.respond', method: 'POST', scope: 'account', data: z.object({ status: ChatFriendRequestStatusSchema }), body: EmptyBodySchema,
  }),
  listBlocks: defineApiEndpoint({
    key: 'chat.blocks.list', method: 'GET', scope: 'account', data: z.array(ChatBlockSchema),
  }),
  blockUser: defineApiEndpoint({
    key: 'chat.blocks.create', method: 'POST', scope: 'account', data: z.object({ blocked: z.literal(true) }), body: EmptyBodySchema,
  }),
  unblockUser: defineApiEndpoint({
    key: 'chat.blocks.remove', method: 'DELETE', scope: 'account', data: z.object({ blocked: z.literal(false) }), body: EmptyBodySchema,
  }),
  listConversationsV2: defineApiEndpoint({
    key: 'chat.conversations.listV2', method: 'GET', scope: 'account', data: ChatConversationPageSchema, query: ConversationListQuerySchema,
  }),
  createConversation: defineApiEndpoint({
    key: 'chat.conversations.create', method: 'POST', scope: 'account', data: z.object({ id: z.string().min(1) }), body: z.object({ userId: z.string().min(1) }),
  }),
  listMessagesV2: defineApiEndpoint({
    key: 'chat.messages.listV2', method: 'GET', scope: 'account', data: ChatMessagePageSchema, query: MessageListQuerySchema,
  }),
  sendMessage: defineApiEndpoint({
    key: 'chat.messages.send', method: 'POST', scope: 'account', data: ChatMessageSchema,
    body: z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), content: z.string().trim().min(1).max(5000), clientMessageId: z.string().regex(/^[0-9a-f-]{16,64}$/i) }),
      z.object({ type: z.literal('sticker'), stickerId: z.string().min(1).max(128), clientMessageId: z.string().regex(/^[0-9a-f-]{16,64}$/i) }),
    ]),
  }),
  markRead: defineApiEndpoint({
    key: 'chat.conversations.read', method: 'POST', scope: 'account', data: z.object({ lastReadSeq: z.number().int().nonnegative(), unreadCount: z.number().int().nonnegative() }),
    body: z.object({ throughSeq: z.number().int().nonnegative() }),
  }),
  archiveConversation: defineApiEndpoint({
    key: 'chat.conversations.archive', method: 'POST', scope: 'account', data: z.object({ archived: z.literal(true) }), body: EmptyBodySchema,
  }),
  unarchiveConversation: defineApiEndpoint({
    key: 'chat.conversations.unarchive', method: 'POST', scope: 'account', data: z.object({ archived: z.literal(false) }), body: EmptyBodySchema,
  }),
  clearConversation: defineApiEndpoint({
    key: 'chat.conversations.clear', method: 'POST', scope: 'account', data: z.object({ clearedThroughSeq: z.number().int().nonnegative() }), body: EmptyBodySchema,
  }),
  getUnread: defineApiEndpoint({
    key: 'chat.unread.get', method: 'GET', scope: 'account', data: ChatUnreadSchema,
  }),
  createReport: defineApiEndpoint({
    key: 'chat.reports.create', method: 'POST', scope: 'account', data: z.object({ id: z.string().min(1) }),
    body: z.object({ messageId: z.string().min(1), reason: z.string().trim().min(1).max(100) }),
  }),
  listReportsAdmin: defineApiEndpoint({
    key: 'chat.reports.admin.list', method: 'GET', scope: 'platform', data: ChatReportListSchema,
    query: PaginationQuerySchema.extend({ status: ChatReportStatusSchema.optional() }),
  }),
  getReportAdmin: defineApiEndpoint({
    key: 'chat.reports.admin.detail', method: 'GET', scope: 'platform', data: ChatReportDetailSchema,
    query: z.object({ reason: z.string().trim().min(1).max(500) }),
  }),
  reviewReportAdmin: defineApiEndpoint({
    key: 'chat.reports.admin.review', method: 'POST', scope: 'platform', data: ChatReportReviewResultSchema,
    body: z.object({ note: z.string().trim().min(1).max(2000) }),
  }),
  listStickerPacks: defineApiEndpoint({
    key: 'chat.stickers.list', method: 'GET', scope: 'account', data: z.array(ChatStickerPackSchema),
  }),
} as const
