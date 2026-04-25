import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'

export interface UseQueryOptions {
  enabled?: boolean
  refreshInterval?: number
  dedupingInterval?: number
}

export function useQuery<T>(key: string | null, options?: UseQueryOptions) {
  const swrKey = options?.enabled === false ? null : key
  const { data, error, isLoading, mutate } = useSWR<T>(swrKey, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: options?.dedupingInterval ?? 10000,
    refreshInterval: options?.refreshInterval,
  })
  return { data: data ?? null, error, isLoading, mutate }
}
