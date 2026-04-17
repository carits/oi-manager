import apiClient from '@/lib/apiClient'

/**
 * SWR fetcher — 统一 API 数据获取函数
 *
 * 配合 useQuery hook 使用：
 *   const { data, isLoading } = useQuery<UserType>('/api/users/me')
 */
export const fetcher = async <T>(key: string): Promise<T> => {
  const res = await apiClient.get<T>(key)
  if (!res.success) {
    throw new Error(res.message || '请求失败')
  }
  return res.data as T
}
