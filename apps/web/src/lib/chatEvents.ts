import { ENV } from '@/config/env'

export type ChatEvent = { id?: string; type: string; data: string }
export type ChatEventHandler = (event: ChatEvent) => void

export function parseChatEventBlock(block: string): ChatEvent | null {
  let id: string | undefined
  let type = 'message'
  const data: string[] = []

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')
    if (field === 'id') id = value
    if (field === 'event') type = value
    if (field === 'data') data.push(value)
  }

  if (!data.length && type === 'message') return null
  return { id, type, data: data.join('\n') }
}

/**
 * Connect to the account-scoped chat stream. Fetch streaming is used instead of
 * EventSource so legacy Bearer sessions can authenticate without putting a token
 * in the URL. No organization header is ever copied to this account-level API.
 */
export function connectChatEvents(userId: string, onEvent: ChatEventHandler): () => void {
  const controller = new AbortController()
  const storageKey = `oi-chat-last-event-id:${userId}`
  let lastEventId = typeof window === 'undefined' ? '' : window.sessionStorage.getItem(storageKey) || ''

  void (async () => {
    let retryMs = 1_000
    while (!controller.signal.aborted) {
      try {
        const token = typeof window === 'undefined' ? null : window.localStorage.getItem('token')
        const headers: Record<string, string> = { Accept: 'text/event-stream' }
        if (token) headers.Authorization = `Bearer ${token}`
        if (lastEventId) headers['Last-Event-ID'] = lastEventId

        const response = await fetch(`${ENV.API_URL}/api/chat/events`, {
          credentials: 'include',
          headers,
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok || !response.body) throw new Error(`chat event stream failed: ${response.status}`)

        retryMs = 1_000
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value, { stream: !done })
          const blocks = buffer.split(/\r?\n\r?\n/)
          buffer = blocks.pop() || ''
          for (const block of blocks) {
            const event = parseChatEventBlock(block)
            if (!event) continue
            if (event.id) lastEventId = event.id
            if (event.type === 'ready' || event.type === 'resync_required') {
              try {
                const cursor = JSON.parse(event.data)?.cursor
                if (typeof cursor === 'string') lastEventId = cursor
              } catch { /* malformed control data is handled by the next resync */ }
            }
            if (lastEventId) window.sessionStorage.setItem(storageKey, lastEventId)
            onEvent(event)
            if (event.type === 'auth_revoked') controller.abort()
          }
          if (done) break
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (process.env.NODE_ENV === 'development') console.warn('chat event stream reconnecting', error)
      }

      await new Promise<void>(resolve => {
        const timer = window.setTimeout(resolve, retryMs)
        controller.signal.addEventListener('abort', () => {
          window.clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      retryMs = Math.min(retryMs * 2, 30_000)
    }
  })()

  return () => controller.abort()
}
