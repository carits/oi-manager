import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, accountClient, apiClient, organizationClient, parseApiResponse } from './apiClient'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('parseApiResponse', () => {
  it('uses cookie-only browser authentication and keeps account APIs out of the organization context', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'account-token' },
      location: { pathname: '/org/org-school/overview' },
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('localStorage', { getItem: () => 'account-token' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await accountClient.get('/api/chat/unread')
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options.headers).not.toHaveProperty('Authorization')
    expect(options.headers).not.toHaveProperty('X-OI-Organization-ID')
  })

  it('can send anonymous telemetry without account or workspace headers', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'secret-bearer-token' },
      location: { pathname: '/org/org-secret/problems' },
      dispatchEvent: vi.fn(),
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await apiClient.post('/api/telemetry/client-errors', { message: 'probe' }, {
      anonymous: true,
      credentials: 'omit',
    })

    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options.credentials).toBe('omit')
    expect(options.headers).not.toHaveProperty('Authorization')
    expect(options.headers).not.toHaveProperty('X-OI-Organization-ID')
  })

  it('preserves structured HTTP errors', async () => {
    const response = new Response(
      JSON.stringify({
        success: false,
        message: '未授权',
        code: 'AUTH_REQUIRED',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    )

    await expect(parseApiResponse(response)).resolves.toMatchObject({
      success: false,
      status: 401,
      message: '登录已失效，请重新登录。',
      code: 'AUTH_REQUIRED',
    })
  })

  it('handles empty successful responses', async () => {
    const result = await parseApiResponse(new Response(null, { status: 204 }))
    expect(result).toMatchObject({ success: true, status: 204 })
  })

  it('keeps HTML proxy errors as HTTP errors instead of network errors', async () => {
    const result = await parseApiResponse(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    expect(result).toMatchObject({
      success: false,
      status: 502,
      message: 'Bad Gateway',
    })
  })

  it('classifies malformed successful payloads as invalid responses', async () => {
    const result = await parseApiResponse(
      new Response('<html>unexpected</html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'X-Request-ID': 'request-123',
        },
      }),
    )

    expect(result).toMatchObject({
      success: false,
      status: 200,
      errorKind: 'invalid_response',
      requestId: 'request-123',
    })
  })

  it('uses Retry-After to explain a rate limit response', async () => {
    const result = await parseApiResponse(
      new Response(JSON.stringify({
        success: false,
        message: 'generic rate limit message',
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '12',
        },
      }),
    )

    expect(result).toMatchObject({
      success: false,
      status: 429,
      message: '请求过于频繁，请在 12 秒后重试',
    })
  })

  it('throws an ApiError for failed reads and does not retry a 403', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(apiClient.query('/api/private')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'http',
      status: 403,
      retryable: false,
    } satisfies Partial<ApiError>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the explicitly selected organization instead of URL-derived context', async () => {
    vi.stubGlobal('window', {
      location: { pathname: '/org/wrong-organization/overview' },
      dispatchEvent: vi.fn(),
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
    )
    await organizationClient('expected-organization').get('/api/teams')
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options.headers).toMatchObject({ 'X-OI-Organization-ID': 'expected-organization' })
  })

  it('evicts only an unavailable organization workspace for explicit organization access errors', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { location: { pathname: '/org/org-a/overview' }, dispatchEvent })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: false, code: 'ORGANIZATION_ACCESS_DENIED', message: 'forbidden',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
    await apiClient.get('/api/private')
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
  })

  it('does not evict account pages or generic forbidden resources', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { location: { pathname: '/account/profile' }, dispatchEvent })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: false, code: 'ORGANIZATION_ACCESS_DENIED', message: 'forbidden',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
    await apiClient.get('/api/private')
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('retries one early 5xx response within the same deadline', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, message: 'temporary' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { value: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    await expect(apiClient.query('/api/retry')).resolves.toEqual({ value: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts a read when its total deadline expires', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      }),
    )

    await expect(
      apiClient.query('/api/slow', { timeout: 25, retry: false }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'timeout',
      retryable: false,
    } satisfies Partial<ApiError>)
  })

  it('classifies caller cancellation separately from timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      }),
    )
    const controller = new AbortController()
    const promise = apiClient.query('/api/cancelled', {
      signal: controller.signal,
      retry: false,
    })
    controller.abort()

    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'cancelled',
      retryable: false,
    } satisfies Partial<ApiError>)
  })

  it('downloads authenticated files with the session cookie contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('fixture', {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="fixture.txt"',
          'X-Request-ID': 'download-1',
        },
      }),
    )

    const result = await apiClient.download('/api/files/fixture/download')
    expect(await result.blob.text()).toBe('fixture')
    expect(result.contentDisposition).toContain('fixture.txt')
    expect(result.requestId).toBe('download-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/files/fixture/download',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('throws a structured error when a download is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      apiClient.download('/api/files/private/download'),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      retryable: false,
    } satisfies Partial<ApiError>)
  })
})
