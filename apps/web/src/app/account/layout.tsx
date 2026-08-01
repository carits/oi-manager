import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <RoleLayout
      allowedRoles={['super_admin', 'platform_admin', 'school_principal', 'teacher', 'student']}
      loginRole="student"
      homePath="/account/profile"
    >
      {children}
    </RoleLayout>
  )
}
