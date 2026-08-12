import { describe, expect, it } from 'vitest'
import { workspaceHref } from './workspaceRouting'

describe('workspaceHref', () => {
  const personalWorkspace = { type: 'personal' } as never

  it('个人空间不继承校园专属模块', () => {
    expect(workspaceHref(personalWorkspace, 'campus')).toBe('/personal')
    expect(workspaceHref(personalWorkspace, 'students')).toBe('/personal')
  })

  it('个人空间保留自身支持的模块', () => {
    expect(workspaceHref(personalWorkspace, 'contests')).toBe('/personal/contests')
    expect(workspaceHref(personalWorkspace, 'submissions')).toBe('/personal/submissions')
  })
})
