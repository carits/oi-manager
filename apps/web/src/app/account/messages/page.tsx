'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { ENV } from '@/config/env'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Input, SearchField, Switch, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import styles from './page.module.css'

type User = { id: string; username: string; avatar?: string | null; discovery?: string }
type Conversation = { id: string; other: User; lastMessageSeq: number; lastMessagePreview?: string | null; lastMessageAt?: string | null; unreadCount: number; canSend: boolean }
type Message = { id: string; conversationId: string; senderUserId: string; seq: number; content: string; createdAt: string }
type Friend = { friendshipId: string; since: string; user: User }
type FriendRequest = { id: string; requesterId: string; addresseeId: string; message?: string; status: string; createdAt: string; Requester: User; Addressee: User }
type Block = { id: string; blockedId: string; Blocked: User }
type Tab = 'messages' | 'friends' | 'requests' | 'blocks'

const account = { accountScoped: true } as const

export default function MessagesPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('messages')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [requestMessage, setRequestMessage] = useState('')
  const [requestTarget, setRequestTarget] = useState<User>()
  const [reportMessage, setReportMessage] = useState<Message>()
  const [reportReason, setReportReason] = useState('骚扰或不当内容')
  const [privacy, setPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = useMemo(() => conversations.find(item => item.id === selectedId), [conversations, selectedId])

  const loadCore = useCallback(async () => {
    const [conversationResponse, friendResponse, requestResponse, blockResponse, privacyResponse] = await Promise.all([
      apiClient.get<Conversation[]>('/api/chat/conversations', account),
      apiClient.get<Friend[]>('/api/chat/friends', account),
      apiClient.get<FriendRequest[]>('/api/chat/friend-requests', account),
      apiClient.get<Block[]>('/api/chat/blocks', account),
      apiClient.get<{ allowExactUsernameDiscovery: boolean }>('/api/chat/privacy', account),
    ])
    if (conversationResponse.success) setConversations(conversationResponse.data || [])
    if (friendResponse.success) setFriends(friendResponse.data || [])
    if (requestResponse.success) setRequests(requestResponse.data || [])
    if (blockResponse.success) setBlocks(blockResponse.data || [])
    if (privacyResponse.success) setPrivacy(Boolean(privacyResponse.data?.allowExactUsernameDiscovery))
  }, [])

  const loadMessages = useCallback(async (conversationId: string) => {
    const response = await apiClient.get<Message[]>(`/api/chat/conversations/${conversationId}/messages`, account)
    if (!response.success) return toast.error(response.message || '消息加载失败')
    const rows = response.data || []
    setMessages(rows)
    const throughSeq = rows.at(-1)?.seq
    if (throughSeq) await apiClient.post(`/api/chat/conversations/${conversationId}/read`, { throughSeq }, account)
  }, [toast])

  useEffect(() => { void loadCore() }, [loadCore])
  useEffect(() => { if (selectedId) void loadMessages(selectedId); else setMessages([]) }, [selectedId, loadMessages])
  useEffect(() => {
    const source = new EventSource(`${ENV.API_URL}/api/chat/events`, { withCredentials: true })
    const refresh = () => { void loadCore(); if (selectedId) void loadMessages(selectedId) }
    ;['message_created', 'friend_request_created', 'friend_request_accepted', 'friend_request_rejected', 'friend_request_cancelled', 'friend_request_blocked'].forEach(type => source.addEventListener(type, refresh))
    return () => source.close()
  }, [loadCore, loadMessages, selectedId])

  const search = async () => {
    if (query.trim().length < 2) return
    const response = await apiClient.get<User[]>(`/api/chat/users/search?q=${encodeURIComponent(query.trim())}`, account)
    if (response.success) setResults(response.data || [])
    else toast.error(response.message || '搜索失败')
  }
  const sendRequest = async () => {
    if (!requestTarget) return
    setBusy(true)
    const response = await apiClient.post('/api/chat/friend-requests', { addresseeId: requestTarget.id, message: requestMessage }, account)
    setBusy(false)
    if (!response.success) return toast.error(response.message || '申请发送失败')
    setRequestTarget(undefined); setRequestMessage(''); toast.success('好友申请已发送'); await loadCore()
  }
  const actRequest = async (request: FriendRequest, action: 'accept' | 'reject' | 'cancel') => {
    const response = await apiClient.post(`/api/chat/friend-requests/${request.id}/${action}`, {}, account)
    if (!response.success) toast.error(response.message || '操作失败')
    await loadCore()
  }
  const openFriend = async (friend: Friend) => {
    const response = await apiClient.post<{ id: string }>('/api/chat/conversations', { userId: friend.user.id }, account)
    if (!response.success || !response.data) return toast.error(response.message || '无法创建会话')
    await loadCore(); setSelectedId(response.data.id); setTab('messages')
  }
  const send = async () => {
    if (!selectedId || !draft.trim()) return
    setBusy(true)
    const response = await apiClient.post<Message>(`/api/chat/conversations/${selectedId}/messages`, { content: draft, clientMessageId: crypto.randomUUID() }, account)
    setBusy(false)
    if (!response.success) return toast.error(response.message || '发送失败')
    setDraft(''); await loadMessages(selectedId); await loadCore()
  }
  const submitReport = async () => {
    if (!reportMessage) return
    setBusy(true)
    const response = await apiClient.post('/api/chat/reports', { messageId: reportMessage.id, reason: reportReason }, account)
    setBusy(false)
    if (!response.success) return toast.error(response.message || '举报提交失败')
    setReportMessage(undefined); toast.success('举报已提交，平台将进行审核')
  }

  const pending = requests.filter(item => item.status === 'pending')
  return <PageFrame width="workbench">
    <PageHeader title="好友与私信" description="私聊属于平台账号空间，不随当前学校身份变化。" actions={<Switch label="允许完整用户名找到我" description="默认关闭；共享学校或团队成员不受此项影响。" checked={privacy} onChange={async checked => { const response = await apiClient.patch('/api/chat/privacy', { allowExactUsernameDiscovery: checked }, account); if (response.success) setPrivacy(checked); else toast.error(response.message || '设置失败') }} />} />
    <Tabs<Tab> value={tab} onChange={setTab} items={[{ value: 'messages', label: '消息' }, { value: 'friends', label: '好友', count: friends.length }, { value: 'requests', label: '好友申请', count: pending.length }, { value: 'blocks', label: '黑名单', count: blocks.length }]} />

    {tab === 'messages' && <div className={styles.workspace}>
      <aside className={`${styles.panel} ${selectedId ? styles.mobileHidden : ''}`} aria-label="会话列表">
        <h2>最近会话</h2>
        {conversations.length === 0 ? <Empty title="暂无会话" description="从好友列表选择好友开始聊天。" /> : conversations.map(item => <Button key={item.id} variant="ghost" className={`${styles.conversation} ${item.id === selectedId ? styles.active : ''}`} onClick={() => setSelectedId(item.id)}><strong>{item.other.username}</strong><span>{item.lastMessagePreview || '尚无消息'}</span>{item.unreadCount > 0 && <b>{item.unreadCount}</b>}</Button>)}
      </aside>
      <section className={`${styles.chat} ${!selectedId ? styles.mobileHiddenDetail : ''}`}>
        {!selected ? <Empty title="选择一个会话" description="消息内容只对会话双方可见。" /> : <>
          <header className={styles.chatHeader}><Button variant="ghost" className={styles.back} onClick={() => setSelectedId(undefined)}>返回</Button><div><strong>{selected.other.username}</strong><span>{selected.canSend ? '好友' : '当前不是好友，无法发送'}</span></div></header>
          <div className={styles.messageList}>{messages.length === 0 ? <Empty title="还没有消息" description="发送第一条消息开始交流。" /> : messages.map(message => <article key={message.id} className={`${styles.message} ${message.senderUserId === user?.userId ? styles.mine : ''}`}><div>{message.content}</div><footer><time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time>{message.senderUserId !== user?.userId && <Button variant="ghost" onClick={() => setReportMessage(message)}>举报</Button>}</footer></article>)}</div>
          <div className={styles.composer}><Textarea aria-label="消息内容" rows={3} maxLength={5000} value={draft} disabled={!selected.canSend || busy} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={selected.canSend ? '输入消息，Enter 发送，Shift+Enter 换行' : '重新成为好友后才能继续发送'} /><Button disabled={!selected.canSend || !draft.trim()} loading={busy} onClick={() => void send()}>发送</Button></div>
        </>}
      </section>
    </div>}

    {tab === 'friends' && <section className={styles.stack}><div className={styles.search}><SearchField aria-label="搜索用户" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search() }} placeholder="搜索共享成员，或输入完整用户名" /><Button onClick={() => void search()}>搜索</Button></div>{results.map(result => <article className={styles.row} key={result.id}><div><strong>{result.username}</strong><span>{result.discovery === 'shared' ? '共享学校或团队' : '完整用户名匹配'}</span></div><Button variant="secondary" onClick={() => setRequestTarget(result)}>添加好友</Button></article>)}<h2>我的好友</h2>{friends.length === 0 ? <Empty title="暂无好友" description="搜索用户并发送好友申请。" /> : friends.map(friend => <article className={styles.row} key={friend.friendshipId}><div><strong>{friend.user.username}</strong><span>成为好友于 {new Date(friend.since).toLocaleDateString('zh-CN')}</span></div><div className={styles.actions}><Button onClick={() => void openFriend(friend)}>发消息</Button><Button variant="secondary" onClick={async () => { await apiClient.delete(`/api/chat/friends/${friend.user.id}`, account); await loadCore() }}>删除好友</Button><Button variant="danger" onClick={async () => { await apiClient.post(`/api/chat/blocks/${friend.user.id}`, {}, account); await loadCore() }}>拉黑</Button></div></article>)}</section>}

    {tab === 'requests' && <section className={styles.stack}>{requests.length === 0 ? <Empty title="暂无好友申请" description="收到和发出的申请会显示在这里。" /> : requests.map(request => { const incoming = request.addresseeId === user?.userId; const peer = incoming ? request.Requester : request.Addressee; return <article className={styles.row} key={request.id}><div><strong>{peer.username}</strong><span>{incoming ? '向你发送好友申请' : '你发送的好友申请'} · {request.status}</span>{request.message && <p>{request.message}</p>}</div>{request.status === 'pending' && <div className={styles.actions}>{incoming ? <><Button onClick={() => void actRequest(request, 'accept')}>接受</Button><Button variant="secondary" onClick={() => void actRequest(request, 'reject')}>拒绝</Button></> : <Button variant="secondary" onClick={() => void actRequest(request, 'cancel')}>撤销</Button>}</div>}</article> })}</section>}

    {tab === 'blocks' && <section className={styles.stack}>{blocks.length === 0 ? <Empty title="黑名单为空" description="被拉黑的用户不能向你发送好友申请或消息。" /> : blocks.map(block => <article className={styles.row} key={block.id}><strong>{block.Blocked.username}</strong><Button variant="secondary" onClick={async () => { await apiClient.delete(`/api/chat/blocks/${block.blockedId}`, account); await loadCore() }}>解除拉黑</Button></article>)}</section>}

    <FormDialog isOpen={Boolean(requestTarget)} onClose={() => setRequestTarget(undefined)} onSubmit={() => void sendRequest()} title={`添加 ${requestTarget?.username || ''} 为好友`} submitText="发送申请" loading={busy} dirty={Boolean(requestMessage)}><label className={styles.field}>申请附言（可选）<Textarea value={requestMessage} maxLength={500} rows={4} onChange={event => setRequestMessage(event.target.value)} /></label></FormDialog>
    <FormDialog isOpen={Boolean(reportMessage)} onClose={() => setReportMessage(undefined)} onSubmit={() => void submitReport()} title="举报消息" description="平台管理员只能在举报审核中查看有限上下文，所有查看都会记录审计。" submitText="提交举报" danger loading={busy}><label className={styles.field}>举报原因<Input value={reportReason} maxLength={100} onChange={event => setReportReason(event.target.value)} /></label></FormDialog>
  </PageFrame>
}
