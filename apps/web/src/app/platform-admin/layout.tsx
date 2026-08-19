import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'

export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleLayout
      allowedRoles={['platform_admin']}
      loginRole="platform-admin"
      homePath="/platform-admin"
      requiredContext="platform"
    >
      {children}
    </RoleLayout>
  )
}
