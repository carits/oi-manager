'use client'

import { ProfileEditor } from '@/features/auth'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'

export default function AccountProfilePage() {
  return <PageFrame width="reading"><PageHeader title="个人信息" description="头像、公开简介和账号资料在两个工作区共用。" /><ProfileEditor /></PageFrame>
}
