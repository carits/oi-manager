import 'server-only'

import { cookies } from 'next/headers'
import type { AuthUser } from '@/components/AuthProvider'
import { ENV } from '@/config/env'
import { cache } from 'react'

export type ServerSessionResult =
  | { state: 'authenticated'; user: AuthUser }
  | { state: 'anonymous' }
  | { state: 'unavailable'; message: string; requestId?: string }

export const getServerSession = cache(async (): Promise<ServerSessionResult> => {
  const cookieHeader = (await cookies()).toString()
  if (!cookieHeader.includes('oi_session=')) {
    return { state: 'anonymous' }
  }

  try {
    const response = await fetch(`${ENV.BACKEND_URL}/api/auth/me`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })

    if (response.status === 401 || response.status === 403) {
      return { state: 'anonymous' }
    }

    const payload = await response.json()
    if (!response.ok || !payload?.success || !payload.data) {
      return {
        state: 'unavailable',
        message: payload?.message || '会话服务暂时不可用',
        requestId: response.headers.get('x-request-id') || undefined,
      }
    }

    return { state: 'authenticated', user: payload.data as AuthUser }
  } catch {
    return {
      state: 'unavailable',
      message: '会话服务暂时不可用，请重试',
    }
  }
})
