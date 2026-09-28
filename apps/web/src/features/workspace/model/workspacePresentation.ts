import type { WorkspaceSummary } from '@oi-manager/contracts'
import { workspaceRoleLabel } from './workspaceRouting'

export function workspaceTitle(workspace: WorkspaceSummary): string {
  return workspace.type === 'platform' ? '平台管理' : workspace.type === 'personal' ? '个人空间' : workspace.organizationName || '学校工作区'
}
export function workspaceSubtitle(workspace: WorkspaceSummary, username: string): string {
  return workspace.type === 'platform' ? '平台管理员' : workspace.type === 'personal' ? username : workspaceRoleLabel(workspace.relationLabel)
}
export function isCurrentWorkspace(workspace: WorkspaceSummary, organizationId: string | undefined): boolean {
  return workspace.type === 'organization'
    ? Boolean(organizationId && workspace.organizationId === organizationId)
    : workspace.type === 'personal' && !organizationId
}
export function filterWorkspaces(workspaces: WorkspaceSummary[], query: string, username: string): WorkspaceSummary[] {
  const search = query.trim().toLocaleLowerCase()
  return search ? workspaces.filter(workspace => `${workspaceTitle(workspace)} ${workspaceSubtitle(workspace, username)}`.toLocaleLowerCase().includes(search)) : workspaces
}
