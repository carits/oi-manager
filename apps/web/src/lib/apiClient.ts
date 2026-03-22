/**
 * 统一 API Client
 *
 * 用法规范：
 * 1. 页面层禁止直接写 `fetch('http://localhost:3001/api/...')`
 * 2. 优先使用 hooks (useTeams, useStudents 等)
 * 3. 特殊请求使用 apiClient.get/post/put/delete
 * 4. 支持 AbortSignal 用于请求取消
 */

import { ENV } from '@/config/env'

export interface ApiClientOptions extends Omit<RequestInit, 'body'> {
  signal?: AbortSignal
  body?: unknown
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
}

class ApiClient {
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {}

    // 从 localStorage 获取 token
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token')
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    }

    return headers
  }

  async request<T>(
    endpoint: string,
    options: ApiClientOptions = {}
  ): Promise<ApiResponse<T>> {
    const { signal, body, ...fetchOptions } = options
    const url = `${this.baseURL}${endpoint}`

    // 判断是否为 FormData
    const isFormData = body instanceof FormData

    const headers: HeadersInit = {
      ...this.getHeaders(),
      ...fetchOptions.headers
    }

    // FormData 不需要设置 Content-Type，让浏览器自动设置
    if (!isFormData && body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json'
    }

    try {
      const res = await fetch(url, {
        ...fetchOptions,
        signal,
        headers,
        body: isFormData
          ? (body as FormData)
          : body ? JSON.stringify(body) : undefined
      })

      const json = await res.json()
      return json
    } catch (error) {
      // AbortError 需要抛出让调用方处理
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }
      console.error('API request error:', error)
      return { success: false, message: '网络错误' }
    }
  }

  /** GET 请求 */
  get<T>(endpoint: string, options?: ApiClientOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' })
  }

  /** POST 请求 */
  post<T>(endpoint: string, body?: unknown, options?: ApiClientOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body })
  }

  /** POST 文件请求（FormData 便捷方法） */
  postFile<T>(endpoint: string, formData: FormData, options?: ApiClientOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body: formData })
  }

  /** PUT 请求 */
  put<T>(endpoint: string, body?: unknown, options?: ApiClientOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body })
  }

  /** PATCH 请求 */
  patch<T>(endpoint: string, body?: unknown, options?: ApiClientOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body })
  }

  /** DELETE 请求 */
  delete<T>(endpoint: string, options?: ApiClientOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' })
  }

  /** 获取资源完整 URL（用于头像等场景） */
  getAssetUrl(path: string | null | undefined): string {
    if (!path) return ''
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${this.baseURL}${normalizedPath}`
  }
}

export const apiClient = new ApiClient(ENV.API_URL)
export default apiClient