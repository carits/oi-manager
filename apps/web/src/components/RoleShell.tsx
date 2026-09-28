'use client'

import type { ReactNode } from 'react'
import { AppShell } from './AppShell'

export function RoleShell({
  children,
  homePath: _homePath,
  contentClassName,
  initialSidebarExpanded = true,
}: {
  children: ReactNode
  homePath: string
  contentClassName?: string
  initialSidebarExpanded?: boolean
}) {
  return (
    <AppShell initialSidebarExpanded={initialSidebarExpanded}>
      {contentClassName
        ? <div className={contentClassName}>{children}</div>
        : children}
    </AppShell>
  )
}
