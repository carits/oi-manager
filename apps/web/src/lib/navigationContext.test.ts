import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { knowledgeHref, navigationHome, resolveNavigationContext } from './navigationContext'

describe('navigation context', () => {
  it('keeps organization, personal and platform identities explicit', () => {
    const organization = resolveNavigationContext('/org/school-1/knowledge', { accountRole: 'user', organizationRole: 'teacher' })
    expect(organization).toEqual({
      workspace: 'organization', accountRole: 'user', organizationRole: 'teacher', organizationId: 'school-1',
      basePath: '/org/school-1', homeHref: '/org/school-1/overview',
    })
    expect(knowledgeHref(organization)).toBe('/org/school-1/knowledge')
    expect(navigationHome(organization)).toBe('/org/school-1/overview')
    expect(knowledgeHref(resolveNavigationContext('/personal/knowledge', { accountRole: 'user' }))).toBe('/personal/knowledge')
    expect(resolveNavigationContext('/account/profile', { accountRole: 'super_admin' })).toEqual({ workspace: 'platform', accountRole: 'super_admin', basePath: '/admin', homeHref: '/admin', platformBasePath: '/admin' })
    expect(resolveNavigationContext('/account/profile', { accountRole: 'platform_admin' })).toEqual({ workspace: 'platform', accountRole: 'platform_admin', basePath: '/platform-admin', homeHref: '/platform-admin', platformBasePath: '/platform-admin' })
  })

  it('uses one root AuthProvider and a persistent shell while preserving server access checks', () => {
    const root = fs.readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
    const providers = fs.readFileSync(new URL('../components/Providers.tsx', import.meta.url), 'utf8')
    const roleLayout = fs.readFileSync(new URL('../components/RoleLayout.tsx', import.meta.url), 'utf8')
    const shell = fs.readFileSync(new URL('../components/RoleShell.tsx', import.meta.url), 'utf8')
    expect(root).toContain('getServerSession(organizationIdFromRequestPath(requestedPath))')
    expect(root).toMatch(/<Providers\s+initialUser=\{initialUser\}\s+initialSidebarExpanded=/)
    expect(providers.match(/<AuthProvider\b/g)).toHaveLength(1)
    expect(providers.match(/<RoleShell\b/g)).toHaveLength(1)
    expect(roleLayout).not.toMatch(/<(?:AuthProvider|RoleShell|AppShell|ChatProvider)\b/)
    expect(roleLayout).toContain('getServerSession(organizationId)')
    expect(roleLayout).toContain('authorizationRoleForContext(session.user, requiredContext)')
    expect(roleLayout).toContain("session.state === 'context_denied'")
    expect(shell.match(/<AppShell\b/g)).toHaveLength(1)
    expect(shell).toContain('accountContextMatches(pathname, user)')
    expect(shell).not.toMatch(/<AppShell[^>]*key=/)
  })
})
