import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'

export default function OrgLayout({ children }: { children: ReactNode }) {
  return <RoleLayout allowedRoles={['student', 'teacher', 'school_principal']} loginRole="student" homePath="/identity" requiredContext="organization">{children}</RoleLayout>
}
