import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <RoleLayout
      allowedRoles={['teacher', 'school_principal']}
      loginRole="teacher"
      homePath="/teacher"
      contentClassName="teacher-page-content"
    >
      {children}
    </RoleLayout>
  )
}
