'use client'

import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import apiClient, { ApiError } from '@/lib/apiClient'
import { toResourceState } from '@/lib/resource'

interface UseResourceOptions<T> {
  enabled?: boolean
  fallbackData?: T
  keepPreviousData?: boolean
  dedupingInterval?: number
  refreshInterval?: number
  isEmpty?: (data: T) => boolean
  sessionKey?: string | null
}

function defaultIsEmpty<T>(data: T): boolean {
  return data == null || (Array.isArray(data) && data.length === 0)
}

export function useResource<T>(
  key: string | null,
  options: UseResourceOptions<T> = {},
) {
  const enabledKey = options.enabled === false ? null : key
  const cacheKey = enabledKey
    ? [enabledKey, options.sessionKey || 'anonymous'] as const
    : null
  const activeRequest = useRef<{
    key: string
    controller: AbortController
  } | null>(null)
  const fetchResource = useCallback(async ([endpoint]: readonly [string, string]) => {
    activeRequest.current?.controller.abort()
    const controller = new AbortController()
    activeRequest.current = { key: endpoint, controller }

    try {
      return await apiClient.query<T>(endpoint, { signal: controller.signal })
    } finally {
      if (activeRequest.current?.controller === controller) {
        activeRequest.current = null
      }
    }
  }, [])

  useEffect(() => () => {
    if (enabledKey && activeRequest.current?.key === enabledKey) {
      activeRequest.current.controller.abort()
    }
  }, [enabledKey])

  const result = useSWR<T, ApiError>(
    cacheKey,
    fetchResource,
    {
      fallbackData: options.fallbackData,
      keepPreviousData: options.keepPreviousData ?? true,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: options.dedupingInterval ?? 10000,
      refreshInterval: options.refreshInterval,
      shouldRetryOnError: false,
    },
  )

  const isEmpty = options.isEmpty || defaultIsEmpty
  const state = toResourceState(result, isEmpty)

  return {
    ...result,
    state,
    retry: async () => {
      await result.mutate()
    },
  }
}
