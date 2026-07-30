import { describe, expect, it } from 'vitest'
import { parseApiResponse } from './apiClient'

describe('parseApiResponse', () => {
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
      message: '未授权',
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
})
