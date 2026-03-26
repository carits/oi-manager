'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell } from '@/components/AppShell'

export default function StudentContestsPage() {
  return (
    <ProtectedRoute requiredRole="student">
      <AppShell>
        <div style={{
          minHeight: '100vh',
          background: 'var(--gray-50)',
          padding: '4rem 2rem',
          textAlign: 'center'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            padding: '3rem',
            maxWidth: '400px',
            margin: '0 auto'
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              功能暂未开放
            </h2>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>
              比赛模块正在建设中，敬请期待
            </p>
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}