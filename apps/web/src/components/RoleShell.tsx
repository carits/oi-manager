'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { AppShell } from './AppShell'

export function RoleShell({
  children,
  homePath,
  contentClassName,
}: {
  children: ReactNode
  homePath: string
  contentClassName?: string
}) {
  const pathname = usePathname()

  if (pathname === homePath) return <>{children}</>

  return (
    <AppShell>
      {contentClassName
        ? <div className={contentClassName}>{children}</div>
        : children}
    </AppShell>
  )
}
