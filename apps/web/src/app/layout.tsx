import '@/styles/globals.css'
import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { ClientTelemetry } from '@/components/telemetry/ClientTelemetry'
import { getServerSession } from '@/lib/serverSession'

export const metadata: Metadata = {
  title: 'Carits',
  description: 'Carits - 信息学竞赛三端成长管理平台',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession()
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
