import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'

/**
 * 统一数据获取 hook，基于 SWR
 *
 * 用法：
 *   const { data, isLoading, error, mutate } = useQuery<UserType>('/api/users/me')
 *
 * 优势（对比 useState + useEffect）：
 * - 自动缓存，切换 Tab 再回来不会重复请求
 * - 5 秒内去重，多个组件请求同一接口只发一次
 * - mutate() 手动刷新
 * - key 为 null 时不发请求（条件获取）
 */
export function useQuery<T>(key: string | null) {
  const { data, error, isLoading, mutate } = useSWR<T>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  })
  return { data: data ?? null, error, isLoading, mutate }
}
