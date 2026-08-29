import '@/styles/globals.css'
import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { ClientTelemetry } from '@/components/telemetry/ClientTelemetry'

export const metadata: Metadata = {
  title: 'Carits',
  description: 'Carits - 信息学竞赛三端成长管理平台',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
        <ClientTelemetry />
      </body>
    </html>
  )
}
