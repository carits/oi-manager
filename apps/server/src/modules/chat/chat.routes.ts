import { Router, type Response } from 'express'
import multer from 'multer'
import { asyncHandler } from '../../lib/asyncHandler'
import { authenticate, authorize, type AuthRequest } from '../../middleware/auth'
import { chatRealtimeHub } from './chat-realtime'
import { chatMetrics } from './chat-metrics'
import {
  ChatError, archiveConversation, blockUser, clearConversation, createConversation,
  createFriendRequest, createReport, getPrivacy, getReport, listBlocks, listConversations,
  listFriendRequests, listFriends, listMessages, listReports, markRead, removeFriend,
  respondFriendRequest, reviewReport, searchChatUsers, sendMessage, unblockUser,
  unreadSummary, unarchiveConversation, updatePrivacy, resolveEventCursor,
} from './application/chat.service'
import { getStickerContent, listActiveStickerPacks, listStickerPacksForAdmin, publishStickerImport, retireStickerPack, stageStickerImport } from './application/chat-sticker.service'

export const chatRouter = Router()
export const chatReportAdminRouter = Router()
export const chatStickerAdminRouter = Router()
const stickerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } })

function endpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try { await handler(req, res) }
    catch (error) {
      if (error instanceof ChatError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      throw error
    }
  }, label)
}

chatRouter.use(authenticate)

chatRouter.get('/privacy', endpoint('获取聊天隐私设置失败', async (req, res) => res.json({ success: true, data: await getPrivacy(req.user!.userId) })))
chatRouter.get('/sticker-packs', endpoint('获取聊天表情包失败', async (_req, res) => res.json({ success: true, data: await listActiveStickerPacks() })))
chatRouter.get('/stickers/:stickerId/content', endpoint('获取聊天表情失败', async (req, res) => {
  const result = await getStickerContent(req.params.stickerId, false)
  res.setHeader('Content-Type', result.contentType); res.setHeader('ETag', `"${result.sha256}"`); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.send(result.content)
}))
chatRouter.get('/stickers/:stickerId/poster', endpoint('获取聊天表情预览失败', async (req, res) => {
  const result = await getStickerContent(req.params.stickerId, true)
  res.setHeader('Content-Type', result.contentType); res.setHeader('ETag', `"${result.sha256}"`); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.send(result.content)
}))
chatRouter.patch('/privacy', endpoint('更新聊天隐私设置失败', async (req, res) => res.json({ success: true, data: await updatePrivacy(req.user!.userId, req.body) })))
chatRouter.get('/users/search', endpoint('搜索用户失败', async (req, res) => res.json({ success: true, data: await searchChatUsers(req.user!.userId, req.query.q) })))

chatRouter.get('/friends', endpoint('获取好友失败', async (req, res) => res.json({ success: true, data: await listFriends(req.user!.userId) })))
chatRouter.delete('/friends/:userId', endpoint('删除好友失败', async (req, res) => res.json({ success: true, data: await removeFriend(req.user!.userId, req.params.userId) })))
chatRouter.post('/friend-requests', endpoint('发送好友申请失败', async (req, res) => res.status(201).json({ success: true, data: await createFriendRequest(req.user!.userId, req.body) })))
chatRouter.get('/friend-requests', endpoint('获取好友申请失败', async (req, res) => res.json({ success: true, data: await listFriendRequests(req.user!.userId) })))
chatRouter.post('/friend-requests/:id/accept', endpoint('接受好友申请失败', async (req, res) => res.json({ success: true, data: await respondFriendRequest(req.user!.userId, req.params.id, 'accept') })))
chatRouter.post('/friend-requests/:id/reject', endpoint('拒绝好友申请失败', async (req, res) => res.json({ success: true, data: await respondFriendRequest(req.user!.userId, req.params.id, 'reject') })))
chatRouter.post('/friend-requests/:id/cancel', endpoint('撤销好友申请失败', async (req, res) => res.json({ success: true, data: await respondFriendRequest(req.user!.userId, req.params.id, 'cancel') })))

chatRouter.get('/blocks', endpoint('获取黑名单失败', async (req, res) => res.json({ success: true, data: await listBlocks(req.user!.userId) })))
chatRouter.post('/blocks/:userId', endpoint('拉黑用户失败', async (req, res) => res.json({ success: true, data: await blockUser(req.user!.userId, req.params.userId) })))
chatRouter.delete('/blocks/:userId', endpoint('解除拉黑失败', async (req, res) => res.json({ success: true, data: await unblockUser(req.user!.userId, req.params.userId) })))

chatRouter.get('/conversations', endpoint('获取会话列表失败', async (req, res) => res.json({ success: true, data: await listConversations(req.user!.userId, req.query) })))
chatRouter.post('/conversations', endpoint('创建会话失败', async (req, res) => res.status(201).json({ success: true, data: await createConversation(req.user!.userId, req.body) })))
chatRouter.get('/conversations/:id/messages', endpoint('获取消息失败', async (req, res) => res.json({ success: true, data: await listMessages(req.user!.userId, req.params.id, req.query) })))
chatRouter.post('/conversations/:id/messages', endpoint('发送消息失败', async (req, res) => res.status(201).json({ success: true, data: await sendMessage(req.user!.userId, req.params.id, req.body) })))
chatRouter.post('/conversations/:id/read', endpoint('更新已读状态失败', async (req, res) => res.json({ success: true, data: await markRead(req.user!.userId, req.params.id, req.body.throughSeq) })))
chatRouter.post('/conversations/:id/archive', endpoint('归档会话失败', async (req, res) => res.json({ success: true, data: await archiveConversation(req.user!.userId, req.params.id) })))
chatRouter.post('/conversations/:id/unarchive', endpoint('恢复归档会话失败', async (req, res) => res.json({ success: true, data: await unarchiveConversation(req.user!.userId, req.params.id) })))
chatRouter.post('/conversations/:id/clear', endpoint('清空会话失败', async (req, res) => res.json({ success: true, data: await clearConversation(req.user!.userId, req.params.id) })))
chatRouter.get('/unread', endpoint('获取聊天未读数失败', async (req, res) => res.json({ success: true, data: await unreadSummary(req.user!.userId) })))
chatRouter.post('/reports', endpoint('提交举报失败', async (req, res) => res.status(201).json({ success: true, data: await createReport(req.user!.userId, req.body) })))

chatRouter.get('/events', endpoint('建立聊天实时连接失败', async (req, res) => {
  const suppliedCursor = req.get('last-event-id') || (typeof req.query.afterEventId === 'string' ? req.query.afterEventId : undefined)
  const { cursor, resync } = await resolveEventCursor(req.user!.userId, suppliedCursor)
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('X-No-Compression', '1')
  res.flushHeaders()
  if (resync) {
    chatMetrics.resync()
    res.write(`event: resync_required\ndata: ${JSON.stringify({ cursor: cursor.toString() })}\n\n`)
  }
  res.write(`event: ready\ndata: ${JSON.stringify({ cursor: cursor.toString() })}\n\n`)
  try { await chatRealtimeHub.add(req.user!.userId, res, cursor) }
  catch (error) {
    if ((error as Error).message === 'CHAT_STREAM_LIMIT') {
      res.write('event: stream_limit\ndata: {}\n\n')
      res.end()
      return
    }
    throw error
  }
}))

chatReportAdminRouter.use(authenticate, authorize('super_admin', 'platform_admin'))
chatReportAdminRouter.get('/', endpoint('获取聊天举报失败', async (req, res) => res.json({ success: true, data: await listReports(req.query) })))
chatReportAdminRouter.get('/:id', endpoint('获取聊天举报详情失败', async (req, res) => res.json({ success: true, data: await getReport(req.user!.userId, req.params.id, req.query.reason) })))
chatReportAdminRouter.post('/:id/resolve', endpoint('处理聊天举报失败', async (req, res) => res.json({ success: true, data: await reviewReport(req.user!.userId, req.params.id, 'resolved', req.body.note) })))
chatReportAdminRouter.post('/:id/dismiss', endpoint('驳回聊天举报失败', async (req, res) => res.json({ success: true, data: await reviewReport(req.user!.userId, req.params.id, 'dismissed', req.body.note) })))

chatStickerAdminRouter.use(authenticate, authorize('super_admin'))
chatStickerAdminRouter.post('/chat-sticker-imports', stickerUpload.single('archive'), endpoint('导入聊天表情包失败', async (req, res) => {
  if (!req.file) throw new ChatError(422, 'STICKER_ARCHIVE_REQUIRED', '请选择表情包 ZIP')
  res.status(201).json({ success: true, data: await stageStickerImport(req.user!.userId, req.file.buffer) })
}))
chatStickerAdminRouter.post('/chat-sticker-imports/:id/publish', endpoint('发布聊天表情包失败', async (req, res) => res.json({ success: true, data: await publishStickerImport(req.user!.userId, req.params.id, req.body.reportHash) })))
chatStickerAdminRouter.get('/chat-sticker-packs', endpoint('获取表情包管理列表失败', async (_req, res) => res.json({ success: true, data: await listStickerPacksForAdmin() })))
chatStickerAdminRouter.post('/chat-sticker-packs/:id/retire', endpoint('停用聊天表情包失败', async (req, res) => res.json({ success: true, data: await retireStickerPack(req.user!.userId, req.params.id) })))
