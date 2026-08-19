'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, School, ShieldCheck, UserRound } from 'lucide-react'
import { apiClient } from '@/lib/apiClient'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'
import { workspaceHref, workspaceModule } from './workspaceRouting'
import styles from './WorkspaceSwitcher.module.css'

type Payload = { workspaces: WorkspaceSummary[] }

export function WorkspaceSwitcher() {
  const { user } = useAuth()
  const isGlobalAdmin = user?.role === 'super_admin' || user?.role === 'platform_admin'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const currentOrganization = typeof window === 'undefined' ? undefined : window.location.pathname.match(/^\/org\/([^/]+)/)?.[1]
  const current = currentOrganization ? workspaces.find(item => item.organizationId === currentOrganization) : workspaces.find(item => item.type === 'personal')
  const visible = useMemo(() => workspaces.filter(item => !query || ((item.organizationName || '') + ' ' + (item.relationLabel || '')).toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query, workspaces])

  useEffect(() => {
    void apiClient.get<Payload>('/api/workspaces').then(result => {
      if (result.success && result.data) setWorkspaces(result.data.workspaces)
    })
  }, [user?.userId])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  const select = (workspace: WorkspaceSummary) => {
    const module = workspaceModule(window.location.pathname)
    setOpen(false)
    window.location.assign(workspaceHref(workspace, module))
  }

  if (isGlobalAdmin) return null

  if (isGlobalAdmin) return null

  const title = current?.type === 'platform' ? '平台管理' : current?.type === 'personal' ? '个人' : current?.organizationName || user?.organizationName || '选择身份'
  const subtitle = current?.type === 'platform' ? '平台管理员' : current?.type === 'personal' ? user?.username : current?.relationLabel || '校园身份'
  const shouldSearch = workspaces.filter(item => item.type === 'organization').length > 5

  return <div className={styles.root} ref={rootRef}>
    <button className={styles.trigger} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="dialog">
      <span className={styles.badge}>{current?.type === 'platform' ? <ShieldCheck size={17} /> : current?.type === 'personal' ? <UserRound size={17} /> : <School size={17} />}</span><span className={styles.currentText}><strong>{title}</strong><small>{subtitle}</small></span><ChevronDown size={16} />
    </button>
    {open && <section className={styles.menu} role="dialog" aria-label="切换身份"><header><strong>切换身份</strong></header>{shouldSearch && <label className={styles.search}><Search size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索学校" /></label>}<div className={styles.list}>{visible.map(item => <button key={item.organizationId || item.type} className={styles.item} type="button" onClick={() => select(item)}><span className={styles.itemBadge}>{item.type === 'platform' ? <ShieldCheck size={17} /> : item.type === 'personal' ? <UserRound size={17} /> : <School size={17} />}</span><span><strong>{item.type === 'platform' ? '平台管理' : item.type === 'personal' ? '个人' : item.organizationName}</strong><small>{item.type === 'platform' ? '平台管理员' : item.type === 'personal' ? user?.username : item.relationLabel}</small></span>{(item.organizationId === currentOrganization || (item.type === 'personal' && !currentOrganization)) && <Check className={styles.check} size={17} />}</button>)}</div></section>}
  </div>
}
