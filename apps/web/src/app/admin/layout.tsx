import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleLayout
      allowedRoles={['super_admin']}
      loginRole="admin"
      homePath="/admin"
      requiredContext="platform"
    >
      {children}
    </RoleLayout>
  )
}
