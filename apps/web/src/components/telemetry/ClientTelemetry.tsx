'use client'

import { useEffect } from 'react'
import { apiClient } from '@/lib/apiClient'

type ClientErrorPayload = {
  type: 'error' | 'unhandledrejection' | 'resource'
  message: string
  stack?: string
  route?: string
  source?: string
  line?: number
  column?: number
  buildId?: string
}

function detectBuildId(): string | undefined {
  const source = Array.from(document.scripts).map(script => script.src).find(value => value.includes('/_next/static/'))
  return source?.match(/\/_next\/static\/([^/]+)\//)?.[1]
}

function normalizeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message || reason.name, stack: reason.stack }
  if (typeof reason === 'string') return { message: reason }
  try { return { message: JSON.stringify(reason) } } catch { return { message: String(reason) } }
}

export function ClientTelemetry() {
  useEffect(() => {
    const sent = new Set<string>()
    const report = (payload: ClientErrorPayload) => {
      const normalized = {
        ...payload,
        message: payload.message.slice(0, 1000),
        stack: payload.stack?.slice(0, 8000),
        route: window.location.pathname.slice(0, 500),
        buildId: detectBuildId(),
      }
      const key = `${normalized.type}:${normalized.message}:${normalized.source || ''}:${normalized.line || 0}`
      if (sent.has(key) || sent.size >= 50) return
      sent.add(key)
      void apiClient.post('/api/telemetry/client-errors', normalized, {
        anonymous: true,
        credentials: 'omit',
        keepalive: true,
        timeout: 2000,
      })
    }

    const onError = (event: ErrorEvent) => {
      const target = event.target
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement || target instanceof HTMLImageElement) {
        report({
          type: 'resource',
          message: `Resource failed: ${target.tagName.toLowerCase()}`,
          source: 'src' in target ? target.src : target.href,
        })
        return
      }
      report({
        type: 'error',
        message: event.message || 'Unknown browser error',
        stack: event.error instanceof Error ? event.error.stack : undefined,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      })
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = normalizeReason(event.reason)
      report({ type: 'unhandledrejection', ...reason })
    }

    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  return null
}
