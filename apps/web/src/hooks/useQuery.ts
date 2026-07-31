import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'

export interface UseQueryOptions {
  enabled?: boolean
  refreshInterval?: number
  dedupingInterval?: number
}

export function useQuery<T>(
  key: string | null,
  options?: UseQueryOptions,
  cacheScope?: string | null,
) {
  const swrKey = options?.enabled === false || !key
    ? null
    : cacheScope
      ? [key, cacheScope] as const
      : key
  const { data, error, isLoading, mutate } = useSWR<T>(
    swrKey,
    resourceKey => fetcher<T>(
      Array.isArray(resourceKey) ? resourceKey[0] : resourceKey,
    ),
    {
    revalidateOnFocus: false,
    dedupingInterval: options?.dedupingInterval ?? 10000,
    refreshInterval: options?.refreshInterval,
    },
  )
  return { data: data ?? null, error, isLoading, mutate }
}
