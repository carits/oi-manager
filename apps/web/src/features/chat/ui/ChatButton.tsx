'use client'

import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { useChat } from '../model/ChatProvider'
import styles from './ChatButton.module.css'

export function ChatButton() {
  const { unread } = useChat()

  return <Link className={styles.button} href="/account/messages" aria-label={`私信${unread.total ? `，${unread.total} 项未处理` : ''}`} title="私信">
    <MessageCircle size={20} aria-hidden="true" />
    {unread.total > 0 && <span className={styles.badge}>{unread.total > 99 ? '99+' : unread.total}</span>}
  </Link>
}
