'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'

export default function TeacherProblemsPage() {
  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{
        minHeight: '100vh',
        background: 'var(--gray-50)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          background: 'white',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          maxWidth: '400px'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            margin: '0 auto 1.5rem',
            borderRadius: '50%',
            background: 'var(--gray-100)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem'
          }}>
            📚
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            题库
          </h2>
          <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem' }}>
            题库功能正在紧张开发中，敬请期待...
          </p>
          <div style={{
            display: 'inline-block',
            padding: '0.375rem 0.75rem',
            background: 'var(--gray-100)',
            borderRadius: '4px',
            fontSize: '0.75rem',
            color: 'var(--gray-500)'
          }}>
            即将上线
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
