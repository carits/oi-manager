'use client'

import { Fragment, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { ChatProvider } from '@/features/chat'
import { accountContextMatches, isApplicationPath } from '@/lib/applicationShell'
import { AppShell } from './AppShell'
import { SkeletonRegion } from './ui/AsyncRegion'
import { LoadError } from './ui/LoadError'

/** Mounted once under root Providers. Role layouts remain server access boundaries. */
export function RoleShell({ children, initialSidebarExpanded = true }: { children: ReactNode; initialSidebarExpanded?: boolean }) {
  const pathname = usePathname()
  const { user, status, sessionKey, refreshUser } = useAuth()
  if (!isApplicationPath(pathname) || !user) return <>{children}</>
  const contextReady = accountContextMatches(pathname, user)
  return <ChatProvider><AppShell initialSidebarExpanded={initialSidebarExpanded}>
    <Fragment key={sessionKey}>
      {contextReady ? children : status === 'degraded'
        ? <LoadError message="工作区身份暂时无法确认。原工作区内容不会显示在这里，请重试。" onRetry={() => void refreshUser()} />
        : <SkeletonRegion label="正在确认工作区" />}
    </Fragment>
  </AppShell></ChatProvider>
}
