import '@/styles/globals.css'
import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { ClientTelemetry } from '@/components/telemetry/ClientTelemetry'
import { getServerSession } from '@/lib/serverSession'
import { cookies, headers } from 'next/headers'
import { organizationIdFromRequestPath } from '@/lib/serverRequestContext'
import { parseSidebarNavigationPreference, sidebarNavigationCookieName } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Carits',
  description: 'Carits - 信息学竞赛三端成长管理平台',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const requestedPath = requestHeaders.get('x-oi-request-path') || '/'
  const session = await getServerSession(organizationIdFromRequestPath(requestedPath))
  const initialUser = session.state === 'authenticated' ? session.user : null
  const preference = initialUser ? parseSidebarNavigationPreference(
    (await cookies()).get(sidebarNavigationCookieName(initialUser.userId))?.value,
  ) : null

  return (
    <html lang="zh-CN">
      <body>
        <Providers initialUser={initialUser} initialSidebarExpanded={preference !== 'closed'}>{children}</Providers>
        <ClientTelemetry />
      </body>
    </html>
  )
}
