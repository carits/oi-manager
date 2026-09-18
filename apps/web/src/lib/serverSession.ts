import 'server-only'

import { cookies } from 'next/headers'
import { CurrentAccountSchema, type CurrentAccount } from '@oi-manager/contracts'
import { ENV } from '@/config/env'
import { cache } from 'react'
import { buildServerSessionHeaders, isOrganizationContextDenied } from './serverSessionCore'

export type ServerSessionResult =
  | { state: 'authenticated'; user: CurrentAccount }
  | { state: 'anonymous' }
  | { state: 'context_denied'; code: string; message: string }
  | { state: 'unavailable'; message: string; requestId?: string }

export const getServerSession = cache(async (organizationId?: string): Promise<ServerSessionResult> => {
  const cookieHeader = (await cookies()).toString()
  if (!cookieHeader.includes('oi_session=')) {
    return { state: 'anonymous' }
  }

  try {
    const response = await fetch(`${ENV.BACKEND_URL}/api/auth/me`, {
      headers: buildServerSessionHeaders(cookieHeader, organizationId),
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })

    if (response.status === 401) {
      return { state: 'anonymous' }
    }

    const payload = await response.json()
    if (isOrganizationContextDenied(response.status, payload?.code, organizationId)) {
      return {
        state: 'context_denied',
        code: payload.code,
        message: payload.message || '当前组织不可用或你已无权访问',
      }
    }
    if (response.status === 403) return { state: 'anonymous' }
    if (!response.ok || !payload?.success || !payload.data) {
      return {
        state: 'unavailable',
        message: payload?.message || '会话服务暂时不可用',
        requestId: response.headers.get('x-request-id') || undefined,
      }
    }

    const account = CurrentAccountSchema.safeParse(payload.data)
    if (!account.success) {
      return {
        state: 'unavailable',
        message: '会话响应格式无效，请重试',
        requestId: response.headers.get('x-request-id') || undefined,
      }
    }

    return { state: 'authenticated', user: account.data }
  } catch {
    return {
      state: 'unavailable',
      message: '会话服务暂时不可用，请重试',
    }
  }
})
