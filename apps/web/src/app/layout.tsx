import '@/styles/globals.css'
import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { ClientTelemetry } from '@/components/telemetry/ClientTelemetry'
import { getServerSession } from '@/lib/serverSession'
import { headers } from 'next/headers'
import { organizationIdFromRequestPath } from '@/lib/serverRequestContext'

export const metadata: Metadata = {
  title: 'Carits',
  description: 'Carits - 信息学竞赛三端成长管理平台',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const requestHeaders = await headers()
  const requestedPath = requestHeaders.get('x-oi-request-path') || '/'
  const organizationId = organizationIdFromRequestPath(requestedPath)
  const session = await getServerSession(organizationId)
  const initialUser = session.state === 'authenticated' ? session.user : null

  return (
    <html lang="zh-CN">
      <body>
        <Providers initialUser={initialUser}>{children}</Providers>
        <ClientTelemetry />
      </body>
    </html>
  )
}
