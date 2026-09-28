'use client'

import { useCallback, useEffect, useRef } from 'react'

/** Small, per-tab UI preference only. Failure to access storage never blocks navigation. */
export function useListScrollRestoration(key: string, ready: boolean) {
  const restoredKey = useRef<string | null>(null)
  const storageKey = `oi:list-scroll:${key}`
  const remember = useCallback(() => {
    try { window.sessionStorage.setItem(storageKey, String(Math.max(0, Math.round(window.scrollY)))) } catch { /* Storage may be disabled. */ }
  }, [storageKey])
  useEffect(() => () => { remember() }, [remember])
  useEffect(() => {
    if (!ready || restoredKey.current === storageKey) return
    restoredKey.current = storageKey
    let saved: string | null = null
    try { saved = window.sessionStorage.getItem(storageKey) } catch { return }
    if (saved === null) return
    const y = Number(saved)
    if (!Number.isFinite(y) || y < 0 || y > 10000000) return
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' }))
    return () => window.cancelAnimationFrame(frame)
  }, [ready, storageKey])
  return remember
}
