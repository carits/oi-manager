'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, MoreHorizontal } from 'lucide-react'
import { apiClient } from '@/lib/apiClient'
import { createClientUUID } from '@/lib/uuid'
import { useAuth } from '@/components/AuthProvider'
import { useChat } from '@/components/chat/ChatProvider'
import { Button } from '@/components/ui/Button'
import { Input, SearchField, Switch, Textarea } from '@/components/ui/FormControls'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import { IconButton, Menu } from '@/components/ui/OverlayPrimitives'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { UserAvatar } from '@/components/user/UserAvatar'
import styles from './page.module.css'

type User = { id: string; username: string; avatar?: string | null; discovery?: string }
type Conversation = { id: string; other: User; lastMessageSeq: number; lastMessagePreview?: string | null; lastMessageAt?: string | null; unreadCount: number; archivedAt?: string | null; canSend: boolean }
type ConversationPage = { items: Conversation[]; nextCursor?: string | null }
type Message = { id: string; conversationId: string; senderUserId: string; seq: number; content: string; createdAt: string }
type MessagePage = { items: Message[]; page: { hasMoreBefore: boolean; hasMoreAfter: boolean; oldestSeq?: number; newestSeq?: number } }
type Friend = { friendshipId: string; since: string; user: User }
type FriendRequest = { id: string; requesterId: string; addresseeId: string; message?: string; status: string; createdAt: string; Requester: User; Addressee: User }
type Block = { id: string; blockedId: string; Blocked: User }
type Tab = 'messages' | 'contacts' | 'requests' | 'blocks'
type ConfirmAction = 'clear' | 'archive' | 'remove' | 'block' | null

const account = { accountScoped: true } as const
const mergeMessages = (current: Message[], incoming: Message[]) => [...new Map([...current, ...incoming].map(message => [message.id, message])).values()].sort((left, right) => left.seq - right.seq)
const eventConversationId = (data: string) => {
  try { const parsed = JSON.parse(data); return typeof parsed?.conversationId === 'string' ? parsed.conversationId : undefined }
  catch { return undefined }
}

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const monthDay = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
const fullDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

function formatMessageTime(value: string) {
  const date = new Date(value)
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (isSameDay(date, now)) return clock.format(date)
  if (isSameDay(date, yesterday)) return `昨天 ${clock.format(date)}`
  if (date.getFullYear() === now.getFullYear()) return `${monthDay.format(date)} ${clock.format(date)}`
  return fullDate.format(date)
}

function formatConversationTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (isSameDay(date, now)) return clock.format(date)
  if (isSameDay(date, yesterday)) return '昨天'
  if (date.getFullYear() === now.getFullYear()) return monthDay.format(date)
  return fullDate.format(date)
}

function groupMessages(messages: Message[]) {
  return messages.reduce<Array<{ senderUserId: string; messages: Message[] }>>((groups, message) => {
    const previous = groups.at(-1)
    const previousMessage = previous?.messages.at(-1)
    const closeInTime = previousMessage && new Date(message.createdAt).getTime() - new Date(previousMessage.createdAt).getTime() <= 3 * 60_000
    if (previous?.senderUserId === message.senderUserId && closeInTime) previous.messages.push(message)
    else groups.push({ senderUserId: message.senderUserId, messages: [message] })
    return groups
  }, [])
}

export default function MessagesPage() {
  const { user } = useAuth()
  const { refreshUnread, subscribe } = useChat()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('messages')
  const [scope, setScope] = useState<'active' | 'archived'>('active')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMoreBefore, setHasMoreBefore] = useState(false)
  const [loadingBefore, setLoadingBefore] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [requestMessage, setRequestMessage] = useState('')
  const [requestTarget, setRequestTarget] = useState<User>()
  const [reportMessage, setReportMessage] = useState<Message>()
  const [reportReason, setReportReason] = useState('骚扰或不当内容')
  const [privacy, setPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [actionTarget, setActionTarget] = useState<User>()
  const messagesRef = useRef<Message[]>([])
  const selectedRef = useRef<string>()
  const loadVersion = useRef(0)
  const messageListRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const sendingRef = useRef(false)
  const pendingSendRef = useRef<Record<string, { content: string; clientMessageId: string }>>({})

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  const selected = useMemo(() => conversations.find(item => item.id === selectedId), [conversations, selectedId])
  const messageGroups = useMemo(() => groupMessages(messages), [messages])
  const draft = selectedId ? drafts[selectedId] || '' : ''

  const loadConversations = useCallback(async (nextScope = scope, append = false, cursor?: string | null) => {
    const params = new URLSearchParams({ pagination: 'v2', pageSize: '30', scope: nextScope })
    if (cursor) params.set('cursor', cursor)
    const response = await apiClient.get<ConversationPage>(`/api/chat/conversations?${params}`, account)
    if (!response.success || !response.data) return
    setConversations(current => append ? [...current, ...response.data!.items.filter(item => !current.some(existing => existing.id === item.id))] : response.data!.items)
    setConversationCursor(response.data.nextCursor || null)
  }, [scope])

  const loadRelations = useCallback(async () => {
    const [friendResponse, requestResponse, blockResponse, privacyResponse] = await Promise.all([
      apiClient.get<Friend[]>('/api/chat/friends', account),
      apiClient.get<FriendRequest[]>('/api/chat/friend-requests', account),
      apiClient.get<Block[]>('/api/chat/blocks', account),
      apiClient.get<{ allowExactUsernameDiscovery: boolean }>('/api/chat/privacy', account),
    ])
    if (friendResponse.success) setFriends(friendResponse.data || [])
    if (requestResponse.success) setRequests(requestResponse.data || [])
    if (blockResponse.success) setBlocks(blockResponse.data || [])
    if (privacyResponse.success) setPrivacy(Boolean(privacyResponse.data?.allowExactUsernameDiscovery))
  }, [])

  const markVisibleRead = useCallback(async (conversationId: string, throughSeq?: number) => {
    if (!throughSeq) return
    const response = await apiClient.post(`/api/chat/conversations/${conversationId}/read`, { throughSeq }, account)
    if (!response.success || selectedRef.current !== conversationId) return
    setConversations(current => current.map(item => item.id === conversationId ? { ...item, unreadCount: 0 } : item))
    await refreshUnread()
  }, [refreshUnread])

  useEffect(() => { void loadConversations(scope); void loadRelations() }, [loadConversations, loadRelations, scope])
  useEffect(() => {
    if (!selectedId) { setMessages([]); setHasMoreBefore(false); return }
    const controller = new AbortController()
    const version = ++loadVersion.current
    setNewMessageCount(0)
    void (async () => {
      const response = await apiClient.get<MessagePage>(`/api/chat/conversations/${selectedId}/messages?pagination=v2&pageSize=50`, { ...account, signal: controller.signal })
      if (controller.signal.aborted || version !== loadVersion.current || !response.success || !response.data) return
      setMessages(response.data.items)
      setHasMoreBefore(response.data.page.hasMoreBefore)
      requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight })
      await markVisibleRead(selectedId, response.data.page.newestSeq)
    })()
    return () => controller.abort()
  }, [markVisibleRead, selectedId])

  const loadNewMessages = useCallback(async (conversationId: string) => {
    if (selectedRef.current !== conversationId) return
    let afterSeq = messagesRef.current.at(-1)?.seq || 0
    const collected: Message[] = []
    for (let page = 0; page < 20; page += 1) {
      const response = await apiClient.get<MessagePage>(`/api/chat/conversations/${conversationId}/messages?pagination=v2&pageSize=100&afterSeq=${afterSeq}`, account)
      if (!response.success || !response.data || selectedRef.current !== conversationId) return
      collected.push(...response.data.items)
      afterSeq = response.data.page.newestSeq || afterSeq
      if (!response.data.page.hasMoreAfter) break
    }
    if (!collected.length) return
    setMessages(current => mergeMessages(current, collected))
    if (nearBottomRef.current) {
      requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight })
      await markVisibleRead(conversationId, afterSeq)
    } else setNewMessageCount(current => current + collected.filter(message => message.senderUserId !== user?.userId).length)
  }, [markVisibleRead, user?.userId])

  useEffect(() => subscribe(events => {
    const types = new Set(events.map(event => event.type))
    if (types.has('resync_required')) { void loadRelations(); void loadConversations(scope); if (selectedRef.current) void loadNewMessages(selectedRef.current) }
    if (types.has('message_created')) {
      void loadConversations(scope)
      if (selectedRef.current && events.some(event => event.type === 'message_created' && eventConversationId(event.data) === selectedRef.current)) void loadNewMessages(selectedRef.current)
    }
    if ([...types].some(type => type.startsWith('friend_request_') || type === 'friendship_removed' || type === 'block_updated')) { void loadRelations(); void loadConversations(scope) }
    if ([...types].some(type => type.startsWith('conversation_'))) void loadConversations(scope)
  }), [loadConversations, loadNewMessages, loadRelations, scope, subscribe])

  const loadOlder = async () => {
    const oldestSeq = messagesRef.current[0]?.seq
    if (!selectedId || !oldestSeq || loadingBefore) return
    const element = messageListRef.current
    const previousHeight = element?.scrollHeight || 0
    setLoadingBefore(true)
    const response = await apiClient.get<MessagePage>(`/api/chat/conversations/${selectedId}/messages?pagination=v2&pageSize=50&beforeSeq=${oldestSeq}`, account)
    setLoadingBefore(false)
    if (!response.success || !response.data || selectedRef.current !== selectedId) return
    setMessages(current => mergeMessages(response.data!.items, current))
    setHasMoreBefore(response.data.page.hasMoreBefore)
    requestAnimationFrame(() => { if (element) element.scrollTop += element.scrollHeight - previousHeight })
  }

  const search = async () => {
    if (query.trim().length < 2) return
    const response = await apiClient.get<User[]>(`/api/chat/users/search?q=${encodeURIComponent(query.trim())}`, account)
    if (response.success) setResults(response.data || []); else toast.error(response.message || '搜索失败')
  }
  const sendRequest = async () => {
    if (!requestTarget) return
    setBusy(true)
    const response = await apiClient.post('/api/chat/friend-requests', { addresseeId: requestTarget.id, message: requestMessage }, account)
    setBusy(false)
    if (!response.success) return toast.error(response.message || '申请发送失败')
    setRequestTarget(undefined); setRequestMessage(''); toast.success('联系申请已发送'); await loadRelations()
  }
  const actRequest = async (request: FriendRequest, action: 'accept' | 'reject' | 'cancel') => {
    const response = await apiClient.post(`/api/chat/friend-requests/${request.id}/${action}`, {}, account)
    if (!response.success) toast.error(response.message || '操作失败')
    await loadRelations()
  }
  const openFriend = async (friend: Friend) => {
    const response = await apiClient.post<{ id: string }>('/api/chat/conversations', { userId: friend.user.id }, account)
    if (!response.success || !response.data) return toast.error(response.message || '无法创建会话')
    setScope('active'); await loadConversations('active'); setSelectedId(response.data.id); setTab('messages')
  }
  const send = async () => {
    const conversationId = selectedId
    const content = conversationId ? drafts[conversationId]?.trim() : ''
    if (!conversationId || !content || sendingRef.current) return
    const pending = pendingSendRef.current[conversationId]
    const clientMessageId = pending?.content === content ? pending.clientMessageId : createClientUUID()
    pendingSendRef.current[conversationId] = { content, clientMessageId }
    sendingRef.current = true
    setBusy(true)
    try {
      const response = await apiClient.post<Message>(`/api/chat/conversations/${conversationId}/messages`, { content, clientMessageId }, account)
      if (!response.success || !response.data) return toast.error(response.message || '发送失败')
      delete pendingSendRef.current[conversationId]
      setDrafts(current => ({ ...current, [conversationId]: '' }))
      if (selectedRef.current === conversationId) {
        setMessages(current => mergeMessages(current, [response.data!]))
        requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight })
      }
      await loadConversations(scope)
    } catch {
      toast.error('发送失败，请稍后重试')
    } finally {
      sendingRef.current = false
      setBusy(false)
    }
  }
  const submitReport = async () => {
    if (!reportMessage) return
    setBusy(true)
    const response = await apiClient.post('/api/chat/reports', { messageId: reportMessage.id, reason: reportReason }, account)
    setBusy(false)
    if (!response.success) return toast.error(response.message || '举报提交失败')
    setReportMessage(undefined); toast.success('举报已提交，平台将进行审核')
  }

  const runConversationAction = async () => {
    const target = actionTarget || selected?.other
    if ((confirmAction === 'clear' || confirmAction === 'archive') && !selected) return
    if ((confirmAction === 'remove' || confirmAction === 'block') && !target) return
    setBusy(true)
    let response
    if (confirmAction === 'clear') response = await apiClient.post(`/api/chat/conversations/${selected!.id}/clear`, {}, account)
    else if (confirmAction === 'archive') response = await apiClient.post(`/api/chat/conversations/${selected!.id}/${selected!.archivedAt ? 'unarchive' : 'archive'}`, {}, account)
    else if (confirmAction === 'remove') response = await apiClient.delete(`/api/chat/friends/${target!.id}`, account)
    else if (confirmAction === 'block') response = await apiClient.post(`/api/chat/blocks/${target!.id}`, {}, account)
    setBusy(false)
    if (!response?.success) return toast.error(response?.message || '操作失败')
    if (confirmAction === 'clear') { setMessages([]); setHasMoreBefore(false); await refreshUnread() }
    if (confirmAction === 'archive') setSelectedId(undefined)
    setConfirmAction(null); setActionTarget(undefined); await loadRelations(); await loadConversations(scope)
  }

  const pending = requests.filter(item => item.status === 'pending')
  const confirmation = confirmAction === 'clear'
    ? { title: '清空聊天记录？', message: '只会隐藏你看到的现有历史，不影响对方；后续新消息仍会显示。', text: '清空记录' }
    : confirmAction === 'archive'
      ? { title: selected?.archivedAt ? '恢复归档会话？' : '归档会话？', message: selected?.archivedAt ? '会话将回到最近会话列表。' : '会话将移入归档列表，新消息到达时会自动恢复。', text: selected?.archivedAt ? '恢复会话' : '归档会话' }
      : confirmAction === 'remove'
        ? { title: '移除联系人？', message: '聊天历史会保留，但双方无法继续发送消息；以后可以重新建立联系。', text: '移除联系人' }
        : { title: '拉黑联系人？', message: '将解除联系人关系，并阻止搜索、联系申请和消息。解除拉黑不会自动恢复关系。', text: '确认拉黑' }

  return <PageFrame width="workbench">
    <PageHeader title="联系人与私信" description="私聊属于平台账号空间，不随当前学校身份变化。" actions={<Switch label="允许完整用户名找到我" description="默认关闭；共享学校或团队成员不受此项影响。" checked={privacy} onChange={async checked => { const response = await apiClient.patch('/api/chat/privacy', { allowExactUsernameDiscovery: checked }, account); if (response.success) setPrivacy(checked); else toast.error(response.message || '设置失败') }} />} />
    <Tabs<Tab> value={tab} onChange={setTab} items={[{ value: 'messages', label: '消息' }, { value: 'contacts', label: '联系人', count: friends.length }, { value: 'requests', label: '联系申请', count: pending.length }, { value: 'blocks', label: '黑名单', count: blocks.length }]} />

    {tab === 'messages' && <div className={styles.workspace}>
      <aside className={`${styles.panel} ${selectedId ? styles.mobileHidden : ''}`} aria-label="会话列表">
        <div className={styles.panelHeader}><h2>{scope === 'active' ? '最近会话' : '归档会话'}</h2><Button variant="ghost" onClick={() => { setSelectedId(undefined); setScope(current => current === 'active' ? 'archived' : 'active') }}>{scope === 'active' ? '查看归档' : '返回最近'}</Button></div>
        {conversations.length === 0 ? <Empty title={scope === 'active' ? '暂无会话' : '暂无归档会话'} description={scope === 'active' ? '从联系人列表选择联系人开始聊天。' : '归档后的会话会显示在这里。'} /> : conversations.map(item => <Button key={item.id} variant="ghost" className={`${styles.conversation} ${item.id === selectedId ? styles.active : ''}`} aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}><UserAvatar avatar={item.other.avatar} username={item.other.username} decorative /><span className={styles.conversationBody}><span className={styles.conversationTop}><strong>{item.other.username}</strong><time>{formatConversationTime(item.lastMessageAt)}</time></span><span className={styles.conversationBottom}><span>{item.lastMessagePreview || '尚无消息'}</span>{item.unreadCount > 0 && <b aria-label={`${item.unreadCount} 条未读消息`}>{item.unreadCount}</b>}</span></span></Button>)}
        {conversationCursor && <Button variant="secondary" className={styles.loadMore} onClick={() => void loadConversations(scope, true, conversationCursor)}>加载更多会话</Button>}
      </aside>
      <section className={`${styles.chat} ${!selectedId ? styles.mobileHiddenDetail : ''}`}>
        {!selected ? <div className={styles.chatEmpty}><Empty icon={<MessageCircle size={30} />} title="选择一个会话" description="消息内容只对会话双方可见。" /></div> : <>
          <header className={styles.chatHeader}><Button variant="ghost" className={styles.back} onClick={() => setSelectedId(undefined)}>返回</Button><UserAvatar avatar={selected.other.avatar} username={selected.other.username} decorative /><div className={styles.peerSummary}><strong>{selected.other.username}</strong><span>@{selected.other.username} · {selected.canSend ? '联系人' : '当前不是联系人，无法发送'}</span></div><Menu trigger={<IconButton variant="ghost" aria-label="会话操作"><MoreHorizontal size={18} /></IconButton>} items={[{ key: 'archive', label: selected.archivedAt ? '恢复归档' : '归档会话', onSelect: () => setConfirmAction('archive') }, { key: 'clear', label: '清空聊天记录', danger: true, onSelect: () => setConfirmAction('clear') }, { key: 'remove', label: '移除联系人', danger: true, disabled: !selected.canSend, onSelect: () => setConfirmAction('remove') }, { key: 'block', label: '拉黑', danger: true, onSelect: () => setConfirmAction('block') }]} /></header>
          <div className={styles.messageList} ref={messageListRef} onScroll={event => { const element = event.currentTarget; nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; if (nearBottomRef.current) { setNewMessageCount(0); void markVisibleRead(selected.id, messagesRef.current.at(-1)?.seq) } }}>
            {hasMoreBefore && <Button variant="ghost" loading={loadingBefore} onClick={() => void loadOlder()}>加载更早消息</Button>}
            {messages.length === 0 ? <div className={styles.chatEmpty}><Empty icon={<MessageCircle size={30} />} title="还没有消息" description="发条消息开始交流。" /></div> : messageGroups.map(group => { const mine = group.senderUserId === user?.userId; return <section key={group.messages[0].id} className={`${styles.messageGroup} ${mine ? styles.mine : ''}`}>{!mine && <UserAvatar avatar={selected.other.avatar} username={selected.other.username} size="sm" decorative />}<div className={styles.groupMessages}>{group.messages.map(message => <article key={message.id} className={`${styles.message} ${mine ? styles.mine : ''}`}><div>{message.content}</div><footer><time>{formatMessageTime(message.createdAt)}</time>{!mine && <Button variant="ghost" onClick={() => setReportMessage(message)}>举报</Button>}</footer></article>)}</div></section> })}
            {newMessageCount > 0 && <Button className={styles.newMessages} onClick={() => { if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight; setNewMessageCount(0) }}>↓ {newMessageCount} 条新消息</Button>}
          </div>
          <div className={styles.composer}><Textarea aria-label="消息内容" rows={2} maxLength={5000} value={draft} disabled={!selected.canSend || busy} onChange={event => setDrafts(current => ({ ...current, [selected.id]: event.target.value }))} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={selected.canSend ? '输入消息，Enter 发送，Shift+Enter 换行' : '重新成为联系人后才能继续发送'} /><Button disabled={!selected.canSend || !draft.trim()} loading={busy} onClick={() => void send()}>发送</Button></div>
        </>}
      </section>
    </div>}

    {tab === 'contacts' && <section className={styles.stack}><div className={styles.search}><SearchField aria-label="搜索用户" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search() }} placeholder="搜索共享成员，或输入完整用户名" /><Button onClick={() => void search()}>搜索</Button></div>{results.map(result => <article className={styles.row} key={result.id}><div className={styles.rowIdentity}><UserAvatar avatar={result.avatar} username={result.username} decorative /><div><strong>{result.username}</strong><span>@{result.username} · {result.discovery === 'shared' ? '共享学校或团队' : '完整用户名匹配'}</span></div></div><Button variant="secondary" onClick={() => setRequestTarget(result)}>添加联系人</Button></article>)}<h2>我的联系人</h2>{friends.length === 0 ? <Empty title="暂无联系人" description="搜索用户并发送联系申请。" /> : friends.map(friend => <article className={styles.row} key={friend.friendshipId}><div className={styles.rowIdentity}><UserAvatar avatar={friend.user.avatar} username={friend.user.username} decorative /><div><strong>{friend.user.username}</strong><span>@{friend.user.username} · 建立联系于 {new Date(friend.since).toLocaleDateString('zh-CN')}</span></div></div><div className={styles.actions}><Button onClick={() => void openFriend(friend)}>发消息</Button><Button variant="secondary" onClick={() => { setActionTarget(friend.user); setConfirmAction('remove') }}>移除联系人</Button><Button variant="danger" onClick={() => { setActionTarget(friend.user); setConfirmAction('block') }}>拉黑</Button></div></article>)}</section>}

    {tab === 'requests' && <section className={styles.stack}>{requests.length === 0 ? <Empty title="暂无联系申请" description="收到和发出的申请会显示在这里。" /> : requests.map(request => { const incoming = request.addresseeId === user?.userId; const peer = incoming ? request.Requester : request.Addressee; return <article className={styles.row} key={request.id}><div className={styles.rowIdentity}><UserAvatar avatar={peer.avatar} username={peer.username} decorative /><div><strong>{peer.username}</strong><span>@{peer.username} · {incoming ? '向你发送联系申请' : '你发送的联系申请'} · {request.status}</span>{request.message && <p>{request.message}</p>}</div></div>{request.status === 'pending' && <div className={styles.actions}>{incoming ? <><Button onClick={() => void actRequest(request, 'accept')}>接受</Button><Button variant="secondary" onClick={() => void actRequest(request, 'reject')}>拒绝</Button></> : <Button variant="secondary" onClick={() => void actRequest(request, 'cancel')}>撤销</Button>}</div>}</article> })}</section>}

    {tab === 'blocks' && <section className={styles.stack}>{blocks.length === 0 ? <Empty title="黑名单为空" description="被拉黑的用户不能向你发送联系申请或消息。" /> : blocks.map(block => <article className={styles.row} key={block.id}><div className={styles.rowIdentity}><UserAvatar avatar={block.Blocked.avatar} username={block.Blocked.username} decorative /><div><strong>{block.Blocked.username}</strong><span>@{block.Blocked.username}</span></div></div><Button variant="secondary" onClick={async () => { await apiClient.delete(`/api/chat/blocks/${block.blockedId}`, account); await loadRelations() }}>解除拉黑</Button></article>)}</section>}

    <FormDialog isOpen={Boolean(requestTarget)} onClose={() => setRequestTarget(undefined)} onSubmit={() => void sendRequest()} title={`添加 ${requestTarget?.username || ''} 为联系人`} submitText="发送申请" loading={busy} dirty={Boolean(requestMessage)}><label className={styles.field}>申请附言（可选）<Textarea value={requestMessage} maxLength={500} rows={4} onChange={event => setRequestMessage(event.target.value)} /></label></FormDialog>
    <FormDialog isOpen={Boolean(reportMessage)} onClose={() => setReportMessage(undefined)} onSubmit={() => void submitReport()} title="举报消息" description="平台管理员只能在举报审核中查看有限上下文，所有查看都会记录审计。" submitText="提交举报" danger loading={busy}><label className={styles.field}>举报原因<Input value={reportReason} maxLength={100} onChange={event => setReportReason(event.target.value)} /></label></FormDialog>
    <ConfirmDialog isOpen={Boolean(confirmAction)} onClose={() => { setConfirmAction(null); setActionTarget(undefined) }} onConfirm={() => void runConversationAction()} title={confirmation.title} message={confirmation.message} confirmText={confirmation.text} danger={confirmAction !== 'archive'} loading={busy} />
  </PageFrame>
}
