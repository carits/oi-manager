import type { ReactNode } from 'react'
import { RoleLayout } from '@/components/RoleLayout'
import { validOrganizationContextId } from '@/lib/serverRequestContext'

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const validatedOrganizationId = validOrganizationContextId(organizationId)
  return (
    <RoleLayout
      allowedRoles={['student', 'teacher', 'school_principal']}
      loginRole="student"
      homePath="/identity"
      requiredContext="organization"
      organizationId={validatedOrganizationId}
    >
      {children}
    </RoleLayout>
  )
}
