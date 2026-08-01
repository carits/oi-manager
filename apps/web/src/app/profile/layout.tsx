import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <RoleLayout
      allowedRoles={['student', 'teacher', 'school_principal', 'platform_admin', 'super_admin']}
      loginRole="student"
      homePath="/"
    >
      {children}
    </RoleLayout>
  )
}
