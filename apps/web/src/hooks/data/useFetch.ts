'use client'

import { useQuery, UseQueryOptions } from '../useQuery'

export interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useFetch<T>(
  url: string | null,
  sessionKey?: string | null,
  _options?: RequestInit
): UseFetchResult<T> {
  const enabled = !!url && !!sessionKey
  const { data, error, isLoading, mutate } = useQuery<T>(
    enabled ? url : null,
    undefined,
    sessionKey,
  )
  return {
    data: data ?? null,
    loading: isLoading,
    error: error?.message || null,
    refetch: async () => { await mutate() },
  }
}
