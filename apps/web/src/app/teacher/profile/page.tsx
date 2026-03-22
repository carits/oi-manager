'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProfileEditor } from '@/components/profile'

export default function TeacherProfilePage() {
  return (
    <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
          个人信息
        </h2>
        <ProfileEditor userType="teacher" />
      </div>
    </ProtectedRoute>
  )
}