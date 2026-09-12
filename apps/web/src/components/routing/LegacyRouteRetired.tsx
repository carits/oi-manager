'use client'

import Link from 'next/link'
import { PageFrame } from '@/components/ui/PageFrame'
import { Empty } from '@/components/ui/Empty'

export function LegacyRouteRetired() {
  return <PageFrame><Empty title="入口已停用" description="校园功能已迁移到身份选择后的学校页面。" action={<Link href="/identity">返回身份选择</Link>} /></PageFrame>
}
