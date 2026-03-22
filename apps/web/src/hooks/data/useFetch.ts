'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import apiClient from '@/lib/apiClient'

export interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useFetch<T>(
  url: string | null,
  sessionKey?: string | null,
  options?: RequestInit
): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const refetch = useCallback(async () => {
    // 取消之前的请求
    abortControllerRef.current?.abort()

    if (!url || !sessionKey) {
      setLoading(false)
      setData(null)  // sessionKey 变化时清空数据
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setLoading(true)
    setError(null)
    try {
      const result = await apiClient.get<T>(url, {
        signal: controller.signal,
        ...options,
        headers: options?.headers
      })

      if (result.success) {
        setData(result.data ?? null)
      } else {
        setError(result.message || '请求失败')
      }
    } catch (e: unknown) {
      // 忽略取消的请求
      if (e instanceof Error && e.name === 'AbortError') return
      setError('网络错误')
      console.error('Fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [url, sessionKey, options])

  useEffect(() => {
    refetch()
    return () => abortControllerRef.current?.abort()
  }, [refetch])

  return { data, loading, error, refetch }
}