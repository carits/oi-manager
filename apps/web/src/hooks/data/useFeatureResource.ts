'use client'

import { useCallback, useRef } from 'react'
import useSWR from 'swr'
import { ApiError } from '@/lib/apiClient'
import { toResourceState } from '@/lib/resource'
import { featureResourceKey, visibleFeatureData, type FeatureSnapshot } from '@/lib/featureResource'

interface FeatureResourceOptions<T> {
  enabled?: boolean
  isEmpty?: (data: T) => boolean
  keepPreviousData?: boolean
  dedupingInterval?: number
}
const notEmpty = () => false

/** Presentation adapter: callers supply their owning Feature API, never a raw URL. */
export function useFeatureResource<T>(key: string, scope: string | null, load: () => Promise<T>, options: FeatureResourceOptions<T> = {}) {
  const loadRef = useRef(load)
  loadRef.current = load
  const cacheKey = featureResourceKey(scope, key, options.enabled !== false)
  const fetcher = useCallback(async ([, requestScope, requestKey]: readonly [string, string, string]): Promise<FeatureSnapshot<T>> => {
    const read = loadRef.current
    try { return { scope: requestScope, key: requestKey, data: await read() } }
    catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError({ kind: 'network', status: 0, message: error instanceof Error ? error.message : '内容加载失败，请重试', retryable: true })
    }
  }, [])
  const result = useSWR<FeatureSnapshot<T>, ApiError>(cacheKey, fetcher, {
    keepPreviousData: options.keepPreviousData ?? true,
    dedupingInterval: options.dedupingInterval ?? 10000,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    shouldRetryOnError: false,
  })
  const mutate = result.mutate
  const retry = useCallback(async () => {
    // SWR records this error for AsyncRegion; event handlers must not also leak a rejection.
    try { await mutate() } catch { /* Explicit resource error remains visible and retryable. */ }
  }, [mutate])
  const data = visibleFeatureData(result.data, scope || '')
  const showingPreviousQuery = data !== undefined && result.data?.key !== key
  const refreshing = Boolean(cacheKey) && (result.isValidating || (showingPreviousQuery && !result.error))
  return {
    data,
    error: result.error,
    isLoading: Boolean(cacheKey) && data === undefined && !result.error,
    refreshing,
    showingPreviousQuery,
    state: toResourceState({ data, error: result.error, isValidating: refreshing }, options.isEmpty || notEmpty),
    retry,
  }
}
