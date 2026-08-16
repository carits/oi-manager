import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const legacy = request.nextUrl.pathname.match(/^\/(teacher|student)(?:\/|$)/)
  if (legacy) {
    return new NextResponse('410 已停用：请从统一登录后的身份选择页进入组织或个人空间。', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  const headers = new Headers(request.headers)
  headers.set(
    'x-oi-request-path',
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  )
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo.png).*)'],
}
