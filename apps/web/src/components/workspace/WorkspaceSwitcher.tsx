'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, School, UserRound } from 'lucide-react'
import { apiClient } from '@/lib/apiClient'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'
import { workspaceHref, workspaceModule } from './workspaceRouting'
import styles from './WorkspaceSwitcher.module.css'

type Payload = { workspaces: WorkspaceSummary[] }

export function WorkspaceSwitcher() {
  const { user, switchWorkspace } = useAuth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const currentOrganization = typeof window === 'undefined' ? undefined : window.location.pathname.match(/^\/org\/([^/]+)/)?.[1]
  const current = currentOrganization ? workspaces.find(item => item.organizationId === currentOrganization) : workspaces.find(item => item.type === 'personal')
  const visible = useMemo(() => workspaces.filter(item => !query || `${item.organizationName || ''} ${item.relationLabel || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query, workspaces])

  useEffect(() => {
    void apiClient.get<Payload>('/api/workspaces').then(result => { if (result.success && result.data) setWorkspaces(result.data.workspaces) })
  }, [user?.userId])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])

  const select = async (workspace: WorkspaceSummary) => {
    const module = workspaceModule(window.location.pathname)
    setOpen(false)
    const target = workspaceHref(workspace, module)
    const mode = workspace.type === 'personal' ? 'personal' : 'work'
    if ((user?.workspaceMode || 'work') !== mode) {
      await switchWorkspace(mode, target)
      return
    }
    window.location.assign(target)
  }
  const title = current?.type === 'personal' ? '个人工作区' : current?.organizationName || user?.schoolName || '选择工作区'
  const subtitle = current?.type === 'personal' ? user?.username : (current as WorkspaceSummary & { relationLabel?: string } | undefined)?.relationLabel || '校园工作区'
  const shouldSearch = workspaces.filter(item => item.type === 'organization').length > 5
  return <div className={styles.root} ref={rootRef}>
    <button className={styles.trigger} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="dialog">
      <span className={styles.badge}>{current?.type === 'personal' ? <UserRound size={17} /> : <School size={17} />}</span><span className={styles.currentText}><strong>{title}</strong><small>{subtitle}</small></span><ChevronDown size={16} />
    </button>
    {open && <section className={styles.menu} role="dialog" aria-label="切换工作区"><header><strong>切换工作区</strong></header>{shouldSearch && <label className={styles.search}><Search size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索学校" /></label>}<div className={styles.list}>{visible.map(item => <button key={item.organizationId || 'personal'} className={styles.item} type="button" onClick={() => void select(item)}><span className={styles.itemBadge}>{item.type === 'personal' ? <UserRound size={17} /> : <School size={17} />}</span><span><strong>{item.type === 'personal' ? '个人工作区' : item.organizationName}</strong><small>{item.type === 'personal' ? user?.username : (item as WorkspaceSummary & { relationLabel?: string }).relationLabel}</small></span>{(item.organizationId === currentOrganization || (item.type === 'personal' && !currentOrganization)) && <Check className={styles.check} size={17} />}</button>)}</div></section>}
  </div>
}
