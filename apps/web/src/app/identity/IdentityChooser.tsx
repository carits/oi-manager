'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Building2, ChevronRight, ShieldCheck, UserRound } from 'lucide-react'
import type { AuthUser, WorkspaceSummary } from '@/components/AuthProvider'
import { apiClient } from '@/lib/apiClient'
import { workspaceHref, workspaceRoleLabel } from '@/components/workspace/workspaceRouting'
import { getRoleHome } from '@/lib/roleAccess'
import { isGlobalAdministrator } from '@/lib/capabilities'
import styles from './identity.module.css'

type Payload = { workspaces: WorkspaceSummary[] }

export function IdentityChooser({ user }: { user: AuthUser }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const [error, setError] = useState('')
  const [entering, setEntering] = useState<string | null>(null)

  const load = async () => {
    setError('')
    setWorkspaces(null)
    const result = await apiClient.get<Payload>('/api/workspaces')
    if (!result.success || !result.data) return setError(result.message || '身份列表加载失败')
    const items = result.data.workspaces
    setWorkspaces(items)
    if (items.length === 1) window.location.replace(workspaceHref(items[0], 'overview'))
  }

  useEffect(() => {
    if (isGlobalAdministrator(user.role)) {
      window.location.replace(getRoleHome(user.role, 'organization'))
      return
    }
    void load()
  }, [])

  const enter = (workspace: WorkspaceSummary) => {
    setEntering(workspace.organizationId || workspace.type)
    window.location.assign(workspaceHref(workspace, 'overview'))
  }

  return <main className={styles.page}>
    <section className={styles.panel} aria-labelledby="identity-title">
      <img className={styles.logo} src="/logo.png" alt="Carits" />
      <header><h1 id="identity-title">选择身份</h1><p>你好，{user.username}</p></header>
      {error && <div className={styles.error}><p>{error}</p><Button variant="secondary" onClick={() => void load()}>重新加载</Button></div>}
      {!workspaces && !error && <p className={styles.loading}>正在加载可进入的身份…</p>}
      {workspaces && <div className={styles.list}>{workspaces.map(workspace => {
        const Icon = workspace.type === 'platform' ? ShieldCheck : workspace.type === 'personal' ? UserRound : Building2
        const title = workspace.type === 'platform' ? '平台管理' : workspace.type === 'personal' ? '个人' : workspace.organizationName || '校园'
        const subtitle = workspace.type === 'platform' ? '平台管理员' : workspace.type === 'personal' ? user.username : workspaceRoleLabel(workspace.relationLabel)
        return <Button variant="ghost" key={workspace.organizationId || workspace.type} type="button" className={styles.item} onClick={() => enter(workspace)} disabled={entering !== null}><span className={styles.icon}><Icon size={20} /></span><span><strong>{title}</strong><small>{subtitle}</small></span><ChevronRight size={18} /></Button>
      })}</div>}
    </section>
  </main>
}
