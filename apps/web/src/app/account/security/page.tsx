'use client'

import { PasswordEditor } from '@/features/auth'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'

export default function AccountSecurityPage() {
  return <PageFrame width="reading"><PageHeader title="账号安全" description="修改登录密码和账号安全设置。" /><PasswordEditor /></PageFrame>
}
