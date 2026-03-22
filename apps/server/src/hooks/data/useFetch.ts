'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getAuthHeaders } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useFetch<T>(url: string | null, options?: RequestInit): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFetched = useRef(false)

  const refetch = useCallback(async () => {
    if (!url) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    hasFetched.current = true
    try {
      const res = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers: { ...getAuthHeaders(), ...options?.headers }
      })
      const json = await res.json()
      if (json.success) {
        setData(json.data)
      } else {
        setError(json.message || '请求失败')
      }
    } catch (e) {
      setError('网络错误')
      console.error('Fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [url, options])

  useEffect(() => {
    if (url) {
      refetch()
    } else {
      setLoading(false)
    }
  }, [refetch, url])

  return { data, loading, error, refetch }
}
