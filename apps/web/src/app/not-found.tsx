'use client'

import { ContextualRecovery } from '@/components/navigation/ContextualRecovery'

export default function NotFound() {
  return <ContextualRecovery status="404" title="这里没有这个页面" description="链接可能已经失效，或功能位置发生了变化。你可以返回上一页或当前工作区首页。" />
}
