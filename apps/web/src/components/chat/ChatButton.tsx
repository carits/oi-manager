'use client'

import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { connectChatEvents } from '@/lib/chatEvents'
import styles from './ChatButton.module.css'

type Unread = { messageUnread: number; pendingFriendRequests: number; total: number }

export function ChatButton() {
  const [unread, setUnread] = useState<Unread>({ messageUnread: 0, pendingFriendRequests: 0, total: 0 })
  const load = useCallback(async () => {
    const response = await apiClient.get<Unread>('/api/chat/unread', { accountScoped: true })
    if (response.success && response.data) setUnread(response.data)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 45_000)
    const refreshEvents = new Set(['message_created', 'conversation_read', 'friend_request_created', 'friend_request_accepted', 'friend_request_rejected', 'friend_request_cancelled', 'friend_request_blocked', 'friendship_removed', 'service_restart', 'resync_required'])
    const disconnect = connectChatEvents(event => {
      if (refreshEvents.has(event.type)) void load()
    })
    return () => { window.clearInterval(timer); disconnect() }
  }, [load])

  return <Link className={styles.button} href="/account/messages" aria-label={`私信${unread.total ? `，${unread.total} 项未处理` : ''}`} title="私信">
    <MessageCircle size={20} aria-hidden="true" />
    {unread.total > 0 && <span className={styles.badge}>{unread.total > 99 ? '99+' : unread.total}</span>}
  </Link>
}
