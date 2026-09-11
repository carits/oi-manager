'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { Check, ChevronDown, Plus, Search, School, ShieldCheck, UserRound } from 'lucide-react'
import { apiClient } from '@/lib/apiClient'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'
import { isGlobalAdministrator } from '@/lib/capabilities'
import { workspaceHref, workspaceModule } from './workspaceRouting'
import styles from './WorkspaceSwitcher.module.css'
import { useNavigationGuard } from '@/components/navigation/UnsavedChangesProvider'
import { resolveNavigationContext } from '@/lib/navigationContext'

type Payload = { workspaces: WorkspaceSummary[] }

function compactRelationLabel(label?: string | null) {
  if (label === '本校学生' || label === '预选学生') return '学生'
  if (label === '本校教师') return '教师'
  if (label === '学校负责人') return '负责人'
  return label || '学校身份'
}

export function WorkspaceSwitcher() {
  const { user } = useAuth()
  const pathname = usePathname()
  const isGlobalAdmin = isGlobalAdministrator(user?.role)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const { requestNavigation } = useNavigationGuard()
  const currentOrganization = resolveNavigationContext(pathname, user).organizationId
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
    const module = workspaceModule(pathname)
    setOpen(false)
    requestNavigation(workspaceHref(workspace, module), { hard: true })
  }

  if (isGlobalAdmin) return null

  const title = current?.type === 'platform' ? '平台管理' : current?.type === 'personal' ? '个人' : current?.organizationName || user?.organizationName || '选择身份'
  const subtitle = current?.type === 'platform' ? '平台管理员' : current?.type === 'personal' ? user?.username : compactRelationLabel(current?.relationLabel)
  const shouldSearch = workspaces.filter(item => item.type === 'organization').length > 5

  return <div className={styles.root} ref={rootRef}>
    <Button variant="ghost" className={styles.trigger} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" aria-label="切换身份">
      <span className={styles.badge}>{current?.type === 'platform' ? <ShieldCheck size={17} /> : current?.type === 'personal' ? <UserRound size={17} /> : <School size={17} />}</span><span className={styles.currentText}><strong>{title}</strong><small>{subtitle}</small></span><ChevronDown size={16} />
    </Button>
    {open && <section className={styles.menu} role="menu" aria-label="切换身份"><header><strong>切换身份</strong></header>{shouldSearch && <label className={styles.search}><Search size={16} /><Input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索学校" /></label>}<div className={styles.list}>{visible.map(item => <Button variant="ghost" key={item.organizationId || item.type} className={styles.item} type="button" role="menuitem" onClick={() => select(item)}><span className={styles.itemBadge}>{item.type === 'platform' ? <ShieldCheck size={17} /> : item.type === 'personal' ? <UserRound size={17} /> : <School size={17} />}</span><span><strong>{item.type === 'platform' ? '平台管理' : item.type === 'personal' ? '个人' : item.organizationName}</strong><small>{item.type === 'platform' ? '平台管理员' : item.type === 'personal' ? user?.username : compactRelationLabel(item.relationLabel)}</small></span>{(item.organizationId === currentOrganization || (item.type === 'personal' && !currentOrganization)) && <Check className={styles.check} size={17} />}</Button>)}</div><div className={styles.footer}><Button variant="ghost" className={styles.joinAction} type="button" role="menuitem" onClick={() => { setOpen(false); requestNavigation('/personal/organizations', { hard: true }) }}><Plus size={17} /><span>加入或创建学校</span></Button></div></section>}
  </div>
}
