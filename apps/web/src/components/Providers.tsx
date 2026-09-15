'use client'

import { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { AuthProvider } from '@/features/auth'
import { ToastProvider } from './ui/Toast'
import { ErrorBoundary } from './ErrorBoundary'
import { NetworkStatusBanner } from './NetworkStatusBanner'
import type { AuthUser } from '@/features/auth'
import { UnsavedChangesProvider } from './navigation/UnsavedChangesProvider'

export function Providers({ children, initialUser = null }: { children: ReactNode; initialUser?: AuthUser | null }) {
  return (
    <ErrorBoundary>
      <SWRConfig value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 10000,
        shouldRetryOnError: false,
      }}>
        <AuthProvider initialUser={initialUser}>
          <ToastProvider>
            <UnsavedChangesProvider>
              <NetworkStatusBanner />
              {children}
            </UnsavedChangesProvider>
          </ToastProvider>
        </AuthProvider>
      </SWRConfig>
    </ErrorBoundary>
  )
}
