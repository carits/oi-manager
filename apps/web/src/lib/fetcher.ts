import apiClient from '@/lib/apiClient'

/**
 * SWR fetcher — 统一 API 数据获取函数
 *
 * 配合 useQuery hook 使用：
 *   const { data, isLoading } = useQuery<UserType>('/api/users/me')
 */
export const fetcher = async <T>(key: string): Promise<T> => {
  return apiClient.query<T>(key)
}
