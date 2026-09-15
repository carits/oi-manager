'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatUnread } from '@oi-manager/contracts'
import { useAuth } from '@/features/auth'
import { connectChatEvents, type ChatEvent } from '../api/chatEvents'
import { getChatUnread } from '../api/chatApi'

type Subscriber = (events: ChatEvent[]) => void
type ChatContextValue = { unread: ChatUnread; refreshUnread: () => Promise<void>; subscribe: (subscriber: Subscriber) => () => void }

const emptyUnread: ChatUnread = { messageUnread: 0, pendingFriendRequests: 0, total: 0 }
const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [unread, setUnread] = useState(emptyUnread)
  const subscribers = useRef(new Set<Subscriber>())
  const eventQueue = useRef<ChatEvent[]>([])
  const flushTimer = useRef<number>()
  const unreadTimer = useRef<number>()

  const refreshUnread = useCallback(async () => {
    if (!user?.userId) return setUnread(emptyUnread)
    try { setUnread(await getChatUnread()) }
    catch { /* keep the last known projection until the stream or fallback poll recovers */ }
  }, [user?.userId])

  const subscribe = useCallback((subscriber: Subscriber) => {
    subscribers.current.add(subscriber)
    return () => subscribers.current.delete(subscriber)
  }, [])

  useEffect(() => {
    if (!user?.userId) return
    void refreshUnread()
    const fallback = window.setInterval(() => void refreshUnread(), 45_000)
    const onFocus = () => void refreshUnread()
    window.addEventListener('focus', onFocus)
    const disconnect = connectChatEvents(user.userId, event => {
      eventQueue.current.push(event)
      if (flushTimer.current === undefined) flushTimer.current = window.setTimeout(() => {
        flushTimer.current = undefined
        const events = eventQueue.current.splice(0)
        for (const subscriber of subscribers.current) subscriber(events)
      }, 100)
      if (event.type !== 'ready' && unreadTimer.current === undefined) unreadTimer.current = window.setTimeout(() => {
        unreadTimer.current = undefined
        void refreshUnread()
      }, 100)
    })
    return () => {
      disconnect()
      window.clearInterval(fallback)
      window.removeEventListener('focus', onFocus)
      if (flushTimer.current !== undefined) window.clearTimeout(flushTimer.current)
      if (unreadTimer.current !== undefined) window.clearTimeout(unreadTimer.current)
      eventQueue.current = []
    }
  }, [refreshUnread, user?.userId])

  const value = useMemo(() => ({ unread, refreshUnread, subscribe }), [refreshUnread, subscribe, unread])
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const value = useContext(ChatContext)
  if (!value) throw new Error('useChat must be used within ChatProvider')
  return value
}
