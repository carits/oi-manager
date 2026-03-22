// API 客户端工具
// 封装 fetch 调用，统一处理认证、错误等

import { getAuthHeaders } from './auth'
import { ENV } from '@/config/env'

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
}

export class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = ENV.API_URL) {
    this.baseUrl = baseUrl
  }

  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
          ...options?.headers
        }
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      return await res.json()
    } catch (error) {
      console.error('API request failed:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : '网络错误'
      }
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' })
  }

  async post<T>(endpoint: string, data: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async put<T>(endpoint: string, data: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

// 导出单例
export const api = new ApiClient()
