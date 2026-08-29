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
  timeout?: number  // 自定义超时时间（毫秒），默认 10000
  /** Public telemetry/probes that must not copy session or workspace identity. */
  anonymous?: boolean
}

export type ApiErrorKind =
  | 'http'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'cancelled'

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  status: number
  code?: string
  requestId?: string
  errorKind?: ApiErrorKind
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly code?: string
  readonly retryable: boolean
  readonly requestId?: string
  readonly data?: unknown

  constructor(input: {
    kind: ApiErrorKind
    status: number
    message: string
    code?: string
    retryable?: boolean
    requestId?: string
    data?: unknown
  }) {
    super(input.message)
    this.name = 'ApiError'
    this.kind = input.kind
    this.status = input.status
    this.code = input.code
    this.retryable = input.retryable ?? isRetryableStatus(input.status, input.kind)
    this.requestId = input.requestId
    this.data = input.data
  }
}

export type MutationResult<T> =
  | { ok: true; data: T; status: number; requestId?: string }
  | { ok: false; error: ApiError }

export interface DownloadResult {
  blob: Blob
  contentDisposition?: string
  requestId?: string
}

export const AUTH_UNAUTHORIZED_EVENT = 'oi-manager:auth-unauthorized'

function isRetryableStatus(status: number, kind: ApiErrorKind): boolean {
  if (kind === 'network') return true
  if (kind === 'timeout' || kind === 'cancelled' || kind === 'invalid_response') return false
  return status >= 500
}

function apiErrorFromResponse<T>(response: ApiResponse<T>): ApiError {
  const kind = response.errorKind || (response.status === 0 ? 'network' : 'http')
  return new ApiError({
    kind,
    status: response.status,
    code: response.code,
    message: response.message || '请求失败',
    requestId: response.requestId,
    data: response.data,
  })
}

export async function parseApiResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text()
  let payload: Record<string, unknown> = {}
  let invalidJson = false

  if (text) {
    try {
      const parsed = JSON.parse(text)
      payload = parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : { data: parsed }
    } catch {
      payload = { message: text }
      invalidJson = true
    }
  }

  const success = typeof payload.success === 'boolean'
    ? payload.success
    : res.ok
  const requestId = res.headers.get('x-request-id') || undefined
  const retryAfter = res.headers.get('retry-after')
  const rateLimitMessage =
    res.status === 429 && retryAfter
      ? /^\d+$/.test(retryAfter)
        ? `请求过于频繁，请在 ${retryAfter} 秒后重试`
        : '请求过于频繁，请稍后重试'
      : undefined

  if (invalidJson && res.ok) {
    return {
      success: false,
      status: res.status,
      message: '服务器返回了无法识别的数据',
      requestId,
      errorKind: 'invalid_response',
    }
  }

  return {
    ...payload,
    success,
    status: res.status,
    message: rateLimitMessage || (
      typeof payload.message === 'string'
        ? payload.message
        : success ? undefined : `请求失败（HTTP ${res.status}）`
    ),
    code: typeof payload.code === 'string' ? payload.code : undefined,
    requestId,
    errorKind: success ? undefined : 'http',
  } as ApiResponse<T>
}

class ApiClient {
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}

    // 从 localStorage 获取 token
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token')
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      const organizationMatch = window.location.pathname.match(/^\/org\/([^/]+)/)
      if (organizationMatch) headers['X-OI-Organization-ID'] = organizationMatch[1]
    }

    return headers
  }

  async request<T>(
    endpoint: string,
    options: ApiClientOptions = {}
  ): Promise<ApiResponse<T>> {
    const { signal, body, timeout, anonymous = false, ...fetchOptions } = options
    const url = `${this.baseURL}${endpoint}`

    // 判断是否为 FormData
    const isFormData = body instanceof FormData

    const headers: Record<string, string> = {
      ...(anonymous ? {} : this.getHeaders()),
      ...(fetchOptions.headers as Record<string, string>)
    }

    // FormData 不需要设置 Content-Type，让浏览器自动设置
    if (!isFormData && body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json'
    }

    // 支持自定义超时，默认 10 秒
    const timeoutMs = timeout ?? 10000
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)

    // 合并用户 signal 和 timeout signal
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal

    try {
      const res = await fetch(url, {
        ...fetchOptions,
        signal: combinedSignal,
        headers,
        credentials: fetchOptions.credentials || 'include',
        body: isFormData
          ? (body as FormData)
          : body ? JSON.stringify(body) : undefined
      })

      clearTimeout(timeoutId)
      const parsed = await parseApiResponse<T>(res)
      if (
        parsed.status === 401 &&
        typeof window !== 'undefined' &&
        !endpoint.startsWith('/api/auth/login') &&
        !endpoint.startsWith('/api/auth/register') &&
        !endpoint.startsWith('/api/auth/session/migrate')
      ) {
        window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT))
      }
      return parsed
    } catch (error) {
      clearTimeout(timeoutId)
      // AbortError 需要抛出让调用方处理
      if (error instanceof Error && error.name === 'AbortError') {
        // 区分是用户主动取消还是超时
        if (timeoutController.signal.aborted && !signal?.aborted) {
          return {
            success: false,
            message: '请求超时，请稍后重试',
            status: 0,
            errorKind: 'timeout',
          }
        }
        return {
          success: false,
          message: '请求已取消',
          status: 0,
          errorKind: 'cancelled',
        }
      }
      console.warn('API request error:', error)
      // 网络错误：无法连接到服务器
      return {
        success: false,
        message: '网络错误：无法连接到服务器',
        status: 0,
        errorKind: 'network',
      }
    }
  }

  /**
   * Read a resource using a bounded deadline. Failed reads throw ApiError so
   * callers cannot accidentally treat a transport failure as an empty result.
   */
  async query<T>(
    endpoint: string,
    options: ApiClientOptions & { retry?: boolean } = {},
  ): Promise<T> {
    const startedAt = Date.now()
    const deadlineMs = options.timeout ?? 4000
    const { retry = true, ...requestOptions } = options

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = deadlineMs - (Date.now() - startedAt)
      if (remaining <= 0) {
        throw new ApiError({
          kind: 'timeout',
          status: 0,
          message: '请求超时，请重试',
          retryable: false,
        })
      }

      const response = await this.get<T>(endpoint, {
        ...requestOptions,
        timeout: remaining,
      })
      if (response.success && response.data !== undefined) return response.data as T
      if (response.success) {
        throw new ApiError({
          kind: 'invalid_response',
          status: response.status,
          message: '服务器返回了空响应',
          requestId: response.requestId,
          retryable: false,
        })
      }

      const error = apiErrorFromResponse(response)
      const canRetry = retry && attempt === 0 &&
        error.retryable && error.kind !== 'timeout' &&
        Date.now() - startedAt < deadlineMs - 250

      if (!canRetry) throw error
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    throw new ApiError({
      kind: 'network',
      status: 0,
      message: '请求失败，请重试',
    })
  }

  async mutate<T>(
    endpoint: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: unknown,
    options: ApiClientOptions = {},
  ): Promise<MutationResult<T>> {
    const response = await this.request<T>(endpoint, {
      ...options,
      method,
      body,
      timeout: options.timeout ?? 10000,
    })

    if (response.success) {
      return {
        ok: true,
        data: response.data as T,
        status: response.status,
        requestId: response.requestId,
      }
    }

    return { ok: false, error: apiErrorFromResponse(response) }
  }

  /** GET 请求 */
  get<T>(endpoint: string, options?: ApiClientOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'GET',
      timeout: options?.timeout ?? 4000,
    })
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

  async download(
    endpoint: string,
    options: Pick<ApiClientOptions, 'signal' | 'timeout'> = {},
  ): Promise<DownloadResult> {
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      options.timeout ?? 10000,
    )
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'GET',
        credentials: 'include',
        headers: this.getHeaders(),
        signal,
      })

      if (!response.ok) {
        throw apiErrorFromResponse(await parseApiResponse(response))
      }

      return {
        blob: await response.blob(),
        contentDisposition:
          response.headers.get('content-disposition') || undefined,
        requestId: response.headers.get('x-request-id') || undefined,
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        const timedOut =
          timeoutController.signal.aborted && !options.signal?.aborted
        throw new ApiError({
          kind: timedOut ? 'timeout' : 'cancelled',
          status: 0,
          message: timedOut ? '下载超时，请重试' : '下载已取消',
          retryable: false,
        })
      }
      throw new ApiError({
        kind: 'network',
        status: 0,
        message: '下载失败，请检查网络后重试',
      })
    } finally {
      clearTimeout(timeoutId)
    }
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
