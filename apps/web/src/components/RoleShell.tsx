'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { ChatProvider } from '@/features/chat'
import { accountContextMatches, isApplicationPath } from '@/lib/applicationShell'
import { AppShell } from './AppShell'
import { SkeletonRegion } from './ui/AsyncRegion'
import { LoadError } from './ui/LoadError'

/** Mounted once under the root Providers, never once per role or route module. */
export function RoleShell({ children, initialSidebarExpanded = true }: {
  children: ReactNode
  initialSidebarExpanded?: boolean
}) {
  const pathname = usePathname()
  const { user, status, sessionKey, refreshUser } = useAuth()
  if (!isApplicationPath(pathname) || !user) return <>{children}</>

  const contextReady = accountContextMatches(pathname, user)
  return (
    <ChatProvider>
      <AppShell initialSidebarExpanded={initialSidebarExpanded}>
        <div data-workspace-content data-context-ready={contextReady} key={sessionKey}>
          {contextReady ? children : status === 'degraded'
            ? <LoadError message="工作区身份暂时无法确认。原工作区内容不会显示在这里，请重试。" onRetry={() => void refreshUser()} />
            : <SkeletonRegion label="正在确认工作区" />}
        </div>
      </AppShell>
    </ChatProvider>
  )
}
