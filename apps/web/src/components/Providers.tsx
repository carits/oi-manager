'use client'

import { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { AuthProvider } from './AuthProvider'
import { ToastProvider } from './ui/Toast'
import { ErrorBoundary } from './ErrorBoundary'
import { NetworkStatusBanner } from './NetworkStatusBanner'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <SWRConfig value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 10000,
        shouldRetryOnError: false,
      }}>
        <AuthProvider>
          <ToastProvider>
            <NetworkStatusBanner />
            {children}
          </ToastProvider>
        </AuthProvider>
      </SWRConfig>
    </ErrorBoundary>
  )
}
