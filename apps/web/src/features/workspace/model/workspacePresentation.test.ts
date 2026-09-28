import { describe, expect, it } from 'vitest'
import type { WorkspaceSummary } from '@oi-manager/contracts'
import { filterWorkspaces, isCurrentWorkspace, workspaceSubtitle, workspaceTitle } from './workspacePresentation'

const personal: WorkspaceSummary = { type: 'personal', label: '个人', relationLabel: 'user', availableModules: ['overview'] }
const organization: WorkspaceSummary = { type: 'organization', label: '学校', organizationId: 'org-a', organizationName: 'Example School', relationLabel: 'teacher', availableModules: ['overview'] }

describe('workspace directory presentation', () => {
  it('uses the same titles and subtitles for a menu and the standalone chooser', () => {
    expect(workspaceTitle(personal)).toBe('个人空间')
    expect(workspaceSubtitle(personal, 'alice')).toBe('alice')
    expect(workspaceTitle(organization)).toBe('Example School')
    expect(workspaceSubtitle(organization, 'alice')).toBe('教师')
  })
  it('searches school names, role labels and personal usernames', () => {
    expect(filterWorkspaces([personal, organization], '  example  ', 'alice')).toEqual([organization])
    expect(filterWorkspaces([personal, organization], '教师', 'alice')).toEqual([organization])
    expect(filterWorkspaces([personal, organization], 'alice', 'alice')).toEqual([personal])
    expect(filterWorkspaces([personal, organization], '个人', 'alice')).toEqual([personal])
    expect(filterWorkspaces([personal, organization], 'missing', 'alice')).toEqual([])
  })
  it('recognizes the current workspace without treating any catalog role as an authorization decision', () => {
    expect(isCurrentWorkspace(organization, 'org-a')).toBe(true)
    expect(isCurrentWorkspace(organization, 'org-b')).toBe(false)
    expect(isCurrentWorkspace(personal, 'org-a')).toBe(false)
    expect(isCurrentWorkspace(personal, undefined)).toBe(true)
  })
})
