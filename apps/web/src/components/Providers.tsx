'use client'

import { type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { AuthProvider, type AuthUser } from '@/features/auth'
import { ToastProvider } from './ui/Toast'
import { ErrorBoundary } from './ErrorBoundary'
import { NetworkStatusBanner } from './NetworkStatusBanner'
import { UnsavedChangesProvider } from './navigation/UnsavedChangesProvider'
import { RoleShell } from './RoleShell'

export function Providers({ children, initialUser = null, initialSidebarExpanded = true }: {
  children: ReactNode
  initialUser?: AuthUser | null
  initialSidebarExpanded?: boolean
}) {
  return (
    <ErrorBoundary>
      <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: true, dedupingInterval: 10000, shouldRetryOnError: false }}>
        <AuthProvider initialUser={initialUser}>
          <ToastProvider>
            <UnsavedChangesProvider>
              <NetworkStatusBanner />
              <RoleShell initialSidebarExpanded={initialSidebarExpanded}>{children}</RoleShell>
            </UnsavedChangesProvider>
          </ToastProvider>
        </AuthProvider>
      </SWRConfig>
    </ErrorBoundary>
  )
}
