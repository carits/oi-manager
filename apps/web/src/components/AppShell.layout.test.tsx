import { createElement, type AnchorHTMLAttributes } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/org/org-a/overview',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props) }))
vi.mock('@/features/auth', () => ({ useAuth: () => ({
  user: { userId: 'user-1', username: 'teacher1', accountRole: 'user', organizationId: 'org-a', organizationName: 'School A', organizationRole: 'teacher' },
  logout: () => undefined,
}) }))
vi.mock('@/features/workspace', () => ({ WorkspaceSwitcher: ({ compact }: { compact?: boolean }) => createElement('button', { 'data-workspace-trigger': true, 'data-compact': compact || undefined }, 'School A') }))
vi.mock('@/features/chat', () => ({ ChatButton: () => createElement('button', { 'data-chat-trigger': true }, 'Chat') }))
vi.mock('@/features/notification', () => ({ NotificationBell: () => createElement('button', { 'data-notification-trigger': true }, 'Notifications') }))
vi.mock('@/components/navigation/UnsavedChangesProvider', () => ({ useNavigationGuard: () => ({ requestAction: () => undefined }) }))
vi.mock('@/components/user/UserAvatar', () => ({ UserAvatar: () => null }))

describe('AppShell server first frame', () => {
  it.each([true, false])('serializes the resolved desktop preference (%s) without an effect correction', expanded => {
    const html = renderToString(<AppShell initialSidebarExpanded={expanded}><p>Content</p></AppShell>)
    expect(html).toContain(`data-desktop-sidebar="${expanded ? 'expanded' : 'collapsed'}"`)
    expect(html).toContain('data-drawer-open="false"')
    expect(html).toContain('data-navigation-motion="false"')
    // CSS handles the actual viewport before JavaScript can run.
    expect(html).toContain('data-navigation-mode="pending"')
    expect(html).not.toMatch(/<aside[^>]*aria-hidden="true"/)
  })
  it('keeps one brand in the header and makes workspace switching the first sidebar control', () => {
    const html = renderToString(<AppShell><p>Content</p></AppShell>)
    const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] || ''
    const aside = html.match(/<aside\b[\s\S]*?<\/aside>/)?.[0] || ''
    expect(html.match(/alt="Carits"/g)).toHaveLength(1)
    expect(html.match(/data-workspace-trigger/g)).toHaveLength(1)
    expect(header).not.toContain('data-workspace-trigger')
    expect(aside.indexOf('data-workspace-trigger')).toBeGreaterThan(-1)
    expect(aside.indexOf('data-workspace-trigger')).toBeLessThan(aside.indexOf('<nav'))
    expect(header.indexOf('data-chat-trigger')).toBeGreaterThan(-1)
    expect(header.indexOf('data-chat-trigger')).toBeLessThan(header.indexOf('data-notification-trigger'))
    expect(html).toContain('data-app-content="true"')
  })
  it('keeps the workspace control available when the desktop sidebar preference is collapsed', () => {
    const html = renderToString(<AppShell initialSidebarExpanded={false}><p>Content</p></AppShell>)
    expect(html).toContain('data-desktop-sidebar="collapsed"')
    expect(html).toContain('data-workspace-trigger="true"')
    expect(html).toContain('data-compact="true"')
  })
})
