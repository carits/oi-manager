'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProblemSelectionItem, ResolvedProblemSelection } from '@oi-manager/contracts'
import { resolveProblemSelection } from '../api/problemSelectionApi'
import { orderProblemSelectionResults, ProblemReferenceOperation } from './problemSelection'

export const PROBLEM_REFERENCE_DEBOUNCE_MS = 400

type Resolution = { key: string; loading: boolean; items: ResolvedProblemSelection[]; error: string }

export function useProblemReferenceResolver({
  items,
  enabled,
  contextKey,
  automatic = true,
}: {
  items: readonly ProblemSelectionItem[]
  enabled: boolean
  contextKey: string
  automatic?: boolean
}) {
  const serialized = JSON.stringify(items)
  const requestItems = useMemo(() => JSON.parse(serialized) as ProblemSelectionItem[], [serialized])
  const key = JSON.stringify([contextKey, serialized])
  const [state, setState] = useState<Resolution | null>(null)
  const operation = useRef(new ProblemReferenceOperation())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(false)
  const latest = useRef({ key, enabled })
  latest.current = { key, enabled }

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => {
    mounted.current = true
    const requests = operation.current
    return () => { mounted.current = false; clearTimer(); requests.cancel() }
  }, [clearTimer])

  const resolve = useCallback(async () => {
    clearTimer()
    if (!enabled || !requestItems.length || operation.current.isRunning(key)) return
    const ticket = operation.current.begin(key)
    const current = () => mounted.current && ticket.isCurrent() && latest.current.enabled && latest.current.key === key
    setState({ key, loading: true, items: [], error: '' })
    try {
      const response = await resolveProblemSelection({ items: requestItems }, { signal: ticket.signal })
      if (!current()) return
      if (!response.ok) throw response.error
      setState({ key, loading: false, items: orderProblemSelectionResults(requestItems, response.data.items), error: '' })
    } catch (error) {
      if (current()) setState({ key, loading: false, items: [], error: error instanceof Error ? error.message : '检索失败，请重试' })
    } finally {
      operation.current.finish(ticket)
    }
  }, [clearTimer, enabled, key, requestItems])

  useEffect(() => {
    const requests = operation.current
    clearTimer()
    requests.cancel()
    setState(null)
    if (enabled && requestItems.length && automatic) {
      timer.current = setTimeout(() => { timer.current = null; void resolve() }, PROBLEM_REFERENCE_DEBOUNCE_MS)
    }
    return () => { clearTimer(); requests.cancel() }
  }, [automatic, clearTimer, enabled, key, requestItems.length, resolve])

  const visible = enabled && state?.key === key ? state : null
  return {
    items: visible?.items || [],
    resolving: enabled && requestItems.length > 0 && (visible ? visible.loading : automatic),
    error: visible?.error || '',
    resolve,
  }
}
