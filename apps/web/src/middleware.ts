import { NextResponse, type NextRequest } from 'next/server'
import {
  buildContentSecurityPolicy,
  contentSecurityPolicyHeader,
  parseContentSecurityPolicyMode,
} from '@/lib/contentSecurityPolicy'

function createRequestSecurity(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(
    'x-oi-request-path',
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  )

  const mode = parseContentSecurityPolicyMode(process.env.CSP_MODE)
  const headerName = contentSecurityPolicyHeader(mode)
  if (!headerName) return { headers, headerName: null, policy: null }

  const nonce = btoa(crypto.randomUUID())
  const policy = buildContentSecurityPolicy(nonce)
  headers.set('x-nonce', nonce)
  headers.set(headerName, policy)
  return { headers, headerName, policy }
}

function applyResponseSecurity(
  response: NextResponse,
  security: ReturnType<typeof createRequestSecurity>,
) {
  if (security.headerName && security.policy) {
    response.headers.set(security.headerName, security.policy)
  }
  return response
}

export function middleware(request: NextRequest) {
  const security = createRequestSecurity(request)
  const legacy = request.nextUrl.pathname.match(/^\/(teacher|student)(?:\/|$)/)
  if (legacy) {
    return applyResponseSecurity(
      new NextResponse('410 已停用：请从统一登录后的身份选择页进入组织或个人空间。', {
        status: 410,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      }),
      security,
    )
  }
  return applyResponseSecurity(
    NextResponse.next({ request: { headers: security.headers } }),
    security,
  )
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo.png).*)'],
}
