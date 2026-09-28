'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { getActiveNavItem, getNavConfig, type NavItem } from '@/config/navigation'
import { getNavigationIcon } from '@/config/navigationIcons'
import { resolveNavigationContext } from '@/lib/navigationContext'
import { accountContextMatches } from '@/lib/applicationShell'
import styles from '../AppShell.module.css'

export function PrimaryNavigation({ label, onNavigate }: { label: string; onNavigate: () => void }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const { user } = useAuth()
  const context = resolveNavigationContext(pathname, user)
  const role = context.workspace === 'organization' ? context.organizationRole || '' : context.accountRole
  const config = getNavConfig(role, context.workspace)
  const active = getActiveNavItem(`${pathname}?${params.toString()}`, role, context.workspace)
  const groups: Array<{ label: string | undefined; items: NavItem[] }> = []
  for (const item of config.items) {
    const previous = groups.at(-1)
    if (previous && previous.label === item.group) previous.items.push(item)
    else groups.push({ label: item.group, items: [item] })
  }
  if (!accountContextMatches(pathname, user)) return <nav className={styles.sidebarNav} aria-label={label} aria-busy="true"><p role="status">正在确认工作区…</p></nav>
  return <nav className={styles.sidebarNav} aria-label={label}>{groups.map((group, index) =>
    <div className={styles.navGroup} key={`${group.label || 'primary'}-${index}`}>
      {group.label && <p className={styles.navGroupLabel}>{group.label}</p>}
      <div className={styles.navGroupLinks}>{group.items.map(item => {
        const href = context.organizationId && item.scope !== 'global' ? `/org/${encodeURIComponent(context.organizationId)}/${item.href}` : item.href
        const Icon = getNavigationIcon(item.label)
        return <Link key={item.href} href={href} className={styles.sidebarLink} aria-current={active === item.label ? 'page' : undefined} title={item.label} onClick={onNavigate}>
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span>
        </Link>
      })}</div>
    </div>,
  )}</nav>
}
