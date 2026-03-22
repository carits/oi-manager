'use client'

import { useMemo } from 'react'
import { useFetch, UseFetchResult } from './useFetch'

export interface ListResponse<T> {
  list: T[]
  total: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export function useList<T>(
  endpoint: string,
  filters?: Record<string, any> | null
): UseFetchResult<ListResponse<T>> {
  const url = useMemo(() => {
    // 当 filters 为 null 或 undefined 时，不发起请求
    if (filters === null || filters === undefined) {
      return null
    }
    if (Object.keys(filters).length === 0) {
      return null  // 空对象也不发起请求
    }
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value))
      }
    })
    const queryString = params.toString()
    return queryString ? `${endpoint}?${queryString}` : null
  }, [endpoint, filters])

  return useFetch<ListResponse<T>>(url)
}
