import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
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
