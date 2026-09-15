import {
  ChatContracts,
  type ChatConversationPage,
  type ChatMessage,
  type ChatMessagePage,
  type ChatPrivacy,
  type ChatSticker,
} from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

const chatPath = '/api/chat'
const encoded = (value: string) => encodeURIComponent(value)

export const getChatPrivacy = () => accountClient.queryContract(ChatContracts.getPrivacy, `${chatPath}/privacy`)
export const updateChatPrivacy = (body: ChatPrivacy) => accountClient.mutateContract(ChatContracts.updatePrivacy, `${chatPath}/privacy`, body)
export const listChatStickerPacks = () => accountClient.queryContract(ChatContracts.listStickerPacks, `${chatPath}/sticker-packs`)
export const searchChatUsers = (q: string) => accountClient.queryContract(ChatContracts.searchUsers, `${chatPath}/users/search?q=${encodeURIComponent(q)}`)
export const listChatFriends = () => accountClient.queryContract(ChatContracts.listFriends, `${chatPath}/friends`)
export const removeChatFriend = (userId: string) => accountClient.mutateContract(ChatContracts.removeFriend, `${chatPath}/friends/${encoded(userId)}`, {})
export const createChatFriendRequest = (body: { addresseeId: string; message?: string }) => accountClient.mutateContract(ChatContracts.createFriendRequest, `${chatPath}/friend-requests`, body)
export const listChatFriendRequests = () => accountClient.queryContract(ChatContracts.listFriendRequests, `${chatPath}/friend-requests`)
export const respondChatFriendRequest = (requestId: string, action: 'accept' | 'reject' | 'cancel') => accountClient.mutateContract(ChatContracts.respondFriendRequest, `${chatPath}/friend-requests/${encoded(requestId)}/${action}`, {})
export const listChatBlocks = () => accountClient.queryContract(ChatContracts.listBlocks, `${chatPath}/blocks`)
export const blockChatUser = (userId: string) => accountClient.mutateContract(ChatContracts.blockUser, `${chatPath}/blocks/${encoded(userId)}`, {})
export const unblockChatUser = (userId: string) => accountClient.mutateContract(ChatContracts.unblockUser, `${chatPath}/blocks/${encoded(userId)}`, {})

export async function listChatConversations(input: { scope: 'active' | 'archived' | 'all'; cursor?: string | null }): Promise<ChatConversationPage> {
  const params = new URLSearchParams({ pagination: 'v2', pageSize: '30', scope: input.scope })
  if (input.cursor) params.set('cursor', input.cursor)
  return accountClient.queryContract(ChatContracts.listConversationsV2, `${chatPath}/conversations?${params}`)
}

export const createChatConversation = (userId: string) => accountClient.mutateContract(ChatContracts.createConversation, `${chatPath}/conversations`, { userId })

export async function listChatMessages(conversationId: string, input: { pageSize?: number; beforeSeq?: number; afterSeq?: number; signal?: AbortSignal } = {}): Promise<ChatMessagePage> {
  const params = new URLSearchParams({ pagination: 'v2', pageSize: String(input.pageSize ?? 50) })
  if (input.beforeSeq !== undefined) params.set('beforeSeq', String(input.beforeSeq))
  if (input.afterSeq !== undefined) params.set('afterSeq', String(input.afterSeq))
  return accountClient.queryContract(ChatContracts.listMessagesV2, `${chatPath}/conversations/${encoded(conversationId)}/messages?${params}`, { signal: input.signal })
}

export const sendChatTextMessage = (conversationId: string, content: string, clientMessageId: string) =>
  accountClient.mutateContract(ChatContracts.sendMessage, `${chatPath}/conversations/${encoded(conversationId)}/messages`, { type: 'text', content, clientMessageId })

export const sendChatStickerMessage = (conversationId: string, sticker: ChatSticker, clientMessageId: string) =>
  accountClient.mutateContract(ChatContracts.sendMessage, `${chatPath}/conversations/${encoded(conversationId)}/messages`, { type: 'sticker', stickerId: sticker.id, clientMessageId })

export const markChatConversationRead = (conversationId: string, throughSeq: number) =>
  accountClient.mutateContract(ChatContracts.markRead, `${chatPath}/conversations/${encoded(conversationId)}/read`, { throughSeq })

export const archiveChatConversation = (conversationId: string) => accountClient.mutateContract(ChatContracts.archiveConversation, `${chatPath}/conversations/${encoded(conversationId)}/archive`, {})
export const unarchiveChatConversation = (conversationId: string) => accountClient.mutateContract(ChatContracts.unarchiveConversation, `${chatPath}/conversations/${encoded(conversationId)}/unarchive`, {})
export const clearChatConversation = (conversationId: string) => accountClient.mutateContract(ChatContracts.clearConversation, `${chatPath}/conversations/${encoded(conversationId)}/clear`, {})
export const getChatUnread = () => accountClient.queryContract(ChatContracts.getUnread, `${chatPath}/unread`)
export const createChatReport = (messageId: string, reason: string) => accountClient.mutateContract(ChatContracts.createReport, `${chatPath}/reports`, { messageId, reason })

export type { ChatMessage }
