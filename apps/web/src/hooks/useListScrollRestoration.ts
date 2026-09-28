'use client'

import { useCallback, useEffect, useRef } from 'react'

/** Per-tab UI preference only. A router's destination scroll must not overwrite the old list. */
export function useListScrollRestoration(key: string, ready: boolean) {
  const restoredKey = useRef<string | null>(null)
  const readyRef = useRef(ready)
  readyRef.current = ready
  const storageKey = `oi:list-scroll:${key}`
  const remember = useCallback(() => {
    try { window.sessionStorage.setItem(storageKey, String(Math.max(0, Math.round(window.scrollY)))) } catch { /* Optional storage. */ }
  }, [storageKey])
  useEffect(() => {
    const sourceHref = window.location.pathname + window.location.search
    let lastY = window.scrollY
    let observedScroll = false
    let frame = 0
    const persist = () => {
      frame = 0
      if (!observedScroll) return
      try { window.sessionStorage.setItem(storageKey, String(Math.max(0, Math.round(lastY)))) } catch { /* Optional storage. */ }
    }
    const onScroll = () => {
      if (!readyRef.current || sourceHref !== window.location.pathname + window.location.search) return
      lastY = window.scrollY
      observedScroll = true
      if (!frame) frame = window.requestAnimationFrame(persist)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
      // Persist the last position observed in the source route, not destination scrollY.
      persist()
    }
  }, [storageKey])
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
