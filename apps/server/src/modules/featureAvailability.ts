import type { JwtPayload } from '@oi-manager/shared'

export type PlannedFeature = 'carits' | 'contributions'
export type PlannedFeatureScope = 'personal' | 'organization' | 'platform'

const copy: Record<PlannedFeature, { title: string; message: string; nextSteps: string[] }> = {
  carits: {
    title: 'Carits币功能暂未开放',
    message: 'Carits币正在完善安全账本、审计与组织权限基础，当前不会生成余额、账户或流水。',
    nextSteps: ['确定首个可定价资源与合法来源', '完成内部账本与审计流程', '开放具体资源的受控购买入口'],
  },
  contributions: {
    title: '贡献功能暂未开放',
    message: '贡献规则、采纳标准与撤销流程仍在设计中，当前不会生成贡献值、事件或排行榜。',
    nextSteps: ['确定首批可验证的贡献来源', '完成采纳、撤销与证据留存流程', '开放公开用户名贡献榜'],
  },
}

export function plannedFeatureResponse(feature: PlannedFeature, scope: PlannedFeatureScope) {
  return {
    featureStatus: 'planned' as const,
    scope,
    ...copy[feature],
    items: [],
  }
}

export function hasOrganizationContext(user: JwtPayload | undefined, organizationId: string) {
  return Boolean(
    user
    && user.workspaceMode === 'work'
    && user.organizationId === organizationId
    && user.organizationMembershipId,
  )
}

export function isPlatformAdministrator(user: JwtPayload | undefined) {
  return user?.role === 'platform_admin' || user?.role === 'super_admin'
}
