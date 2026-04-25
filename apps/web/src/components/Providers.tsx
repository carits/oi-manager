'use client'

import { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { AuthProvider } from './AuthProvider'
import { ToastProvider } from './ui/Toast'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 10000,
      shouldRetryOnError: false,
    }}>
      <AuthProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </AuthProvider>
    </SWRConfig>
  )
}
