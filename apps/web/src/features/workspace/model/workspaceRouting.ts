import type { WorkspaceSummary } from '@oi-manager/contracts'
import type { NavigationContext } from '@/lib/navigationContext'
export type { NavigationContext } from '@/lib/navigationContext'

export const personalWorkspaceModules = new Set(['teams', 'problems', 'contests', 'training-sessions', 'problem-lists', 'rankings', 'submissions', 'knowledge'])
export const organizationModules = new Set(['overview', 'campus', 'management', 'teams', 'homeworks', 'contests', 'training-sessions', 'problems', 'problem-lists', 'rankings', 'submissions', 'knowledge'])
export type ResourceKind = 'team' | 'contest' | 'homework' | 'training' | 'submission'

export function canNavigate(id?: string | number | null) { return id !== undefined && id !== null && String(id).trim() !== '' }
export function fallbackHref(context: NavigationContext) {
  if (context.workspace === 'personal') return '/personal'
  if (context.workspace === 'platform') return context.platformBasePath || '/platform-admin'
  return context.organizationId ? `/org/${context.organizationId}/overview` : '/identity'
}

export function resourceHref(kind: ResourceKind, context: NavigationContext, id?: string | number | null) {
  if (!canNavigate(id)) return null
  const value = String(id)
  if (context.workspace === 'platform') {
    const prefix = context.platformBasePath || '/platform-admin'
    const paths: Partial<Record<ResourceKind, string>> = {
      contest: `${prefix}/contests/${value}`,
      submission: `${prefix}/submissions/${value}`,
    }
    return paths[kind] || null
  }
  if (context.workspace === 'personal') {
    const paths: Partial<Record<ResourceKind, string>> = { team: `/personal/teams/${value}`, contest: `/personal/contests/${value}`, submission: `/personal/submissions/${value}` }
    return paths[kind] || null
  }
  if (!context.organizationId) return null
  const prefix = `/org/${context.organizationId}`
  if (kind === 'team') return `${prefix}/teams/${value}`
  if (kind === 'contest') return `${prefix}/contests/${value}`
  if (kind === 'homework') return `${prefix}/homeworks/${value}`
  if (kind === 'submission') return `${prefix}/submissions/${value}`
  return null
}

export function listHref(kind: 'contest' | 'homework' | 'training', context: NavigationContext) {
  if (context.workspace === 'platform') return kind === 'contest' ? `${context.platformBasePath || '/platform-admin'}/contests` : context.platformBasePath || '/platform-admin'
  if (context.workspace === 'personal') {
    if (kind === 'contest') return '/personal/contests'
    if (kind === 'training') return '/personal/training-sessions'
    return '/personal'
  }
  if (!context.organizationId) return '/identity'
  if (kind === 'contest') return `/org/${context.organizationId}/contests`
  if (kind === 'homework') return `/org/${context.organizationId}/homeworks`
  return `/org/${context.organizationId}/training-sessions`
}

export function workspaceModule(pathname: string) {
  const match = pathname.match(/^\/org\/[^/]+\/([^/?#]+)/)
  return match?.[1] || (pathname.startsWith('/personal/') ? pathname.split('/')[2] || 'overview' : 'overview')
}
export function workspaceHref(workspace: WorkspaceSummary, module: string) {
  if (workspace.type === 'platform') return '/platform-admin'
  if (workspace.type === 'personal') return personalWorkspaceModules.has(module) ? `/personal/${module}` : '/personal'
  const target = organizationModules.has(module) && (module === 'knowledge' || workspace.availableModules.includes(module)) ? module : 'overview'
  return `/org/${workspace.organizationId}/${target}`
}
export const moduleHref = workspaceHref

export function notificationTeamHref(workspace: NavigationContext['workspace'], organizationId: string | undefined, notificationValue?: string | null) {
  if (!notificationValue) return null
  if (notificationValue.startsWith('organization:')) { const id = notificationValue.slice('organization:'.length); return id ? `/org/${id}/overview` : null }
  if (!notificationValue.startsWith('team:')) return null
  const teamId = notificationValue.slice('team:'.length)

  if (!teamId) return null
  return workspace === 'personal' ? `/personal/teams/${teamId}` : workspace === 'organization' && organizationId ? `/org/${organizationId}/teams/${teamId}` : null
}
export function resolveNotificationHref(workspace: NavigationContext['workspace'], organizationId: string | undefined, notificationValue?: string | null) {
  if (!notificationValue) return null
  if (notificationValue.startsWith('/')) return notificationValue
  return notificationTeamHref(workspace, organizationId, notificationValue)
}
export const notificationHref = resolveNotificationHref

export function workspaceRoleLabel(label?: string | null) {
  if (label === '本校学生' || label === '预选学生') return '学生'
  if (label === '本校教师') return '教师'
  if (label === '学校负责人') return '负责人'
  return label || '学校成员'
}

export function organizationUnavailableMessage(reason?: string | null) {
  if (reason === 'ORGANIZATION_ACCESS_DENIED') {
    return '你的学校成员身份已被移除或停用，原学校数据已停止显示。'
  }
  if (reason === 'ORGANIZATION_NOT_AVAILABLE') {
    return '该学校当前不可用，原学校数据已停止显示。'
  }
  if (reason === 'ORGANIZATION_AUTHORIZATION_INCOMPLETE') {
    return '你的学校成员资料或权限尚未配置完整，暂时不能进入该学校。'
  }
  return '原学校身份已失效或不可用，相关学校数据已停止显示。'
}
