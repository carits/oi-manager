import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'

export default function PersonalLayout({ children }: { children: ReactNode }) {
  return (
    <RoleLayout
      allowedRoles={['school_principal', 'teacher', 'student', 'user']}
      homePath="/personal"
      requiredContext="personal"
    >
      {children}
    </RoleLayout>
  )
}
