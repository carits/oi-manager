'use client'

import AdminPlatformBindingsPage from '@/app/admin/platform-bindings/page'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export default function PlatformAdminPlatformBindingsPage() {
  return (
    <ProtectedRoute requiredRole="platform_admin">
      <AdminPlatformBindingsPage />
    </ProtectedRoute>
  )
}