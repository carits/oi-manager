'use client'

import type { ReactNode } from 'react'
import { AppShell } from './AppShell'

export function RoleShell({
  children,
  homePath: _homePath,
  contentClassName,
}: {
  children: ReactNode
  homePath: string
  contentClassName?: string
}) {
  return (
    <AppShell>
      {contentClassName
        ? <div className={contentClassName}>{children}</div>
        : children}
    </AppShell>
  )
}
