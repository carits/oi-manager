import { ENV } from '@/config/env'

export type ChatEventHandler = (event: { id?: string; type: string; data: string }) => void

function parseEventBlock(block: string): { id?: string; type: string; data: string } | null {
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
export function connectChatEvents(onEvent: ChatEventHandler): () => void {
  const controller = new AbortController()
  let lastEventId = ''

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
            const event = parseEventBlock(block)
            if (!event) continue
            if (event.id) lastEventId = event.id
            onEvent(event)
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

