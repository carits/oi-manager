'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Building2, ChevronRight, ShieldCheck, UserRound } from 'lucide-react'
import type { AuthUser } from '@/features/auth'
import type { WorkspaceSummary } from '@oi-manager/contracts'
import { organizationUnavailableMessage, workspaceHref } from '../model/workspaceRouting'
import { useWorkspaceDirectory } from '../model/useWorkspaceDirectory'
import { workspaceSubtitle, workspaceTitle } from '../model/workspacePresentation'
import { getRoleHome } from '@/lib/roleAccess'
import { isGlobalAdministrator } from '@/lib/capabilities'
import styles from './IdentityChooser.module.css'

export function IdentityChooser({ user, unavailableReason }: { user: AuthUser; unavailableReason?: string }) {
  const isGlobalAdmin = isGlobalAdministrator(user.accountRole)
  const directory = useWorkspaceDirectory(user.userId, !isGlobalAdmin)
  const workspaces = directory.data?.workspaces
  const [entering, setEntering] = useState<string | null>(null)
  const entered = useRef(false)

  useEffect(() => {
    if (entered.current) return
    if (isGlobalAdmin) {
      entered.current = true
      window.location.replace(getRoleHome(user.accountRole, 'organization'))
    } else if (workspaces?.length === 1 && !directory.error && !directory.refreshing && !unavailableReason) {
      entered.current = true
      window.location.replace(workspaceHref(workspaces[0], 'overview'))
    }
  }, [directory.error, directory.refreshing, isGlobalAdmin, unavailableReason, user.accountRole, workspaces])

  const enter = (workspace: WorkspaceSummary) => {
    if (entered.current) return
    entered.current = true
    setEntering(workspace.organizationId || workspace.type)
    window.location.assign(workspaceHref(workspace, 'overview'))
  }
  return <main className={styles.page}>
    <section className={styles.panel} aria-labelledby="identity-title">
      <img className={styles.logo} src="/logo.png" alt="Carits" />
      <header><h1 id="identity-title">选择工作区</h1><p>你好，{user.username}</p></header>
      {unavailableReason && <div className={styles.notice} role="status">
        <strong>原学校身份已不可用</strong><p>{organizationUnavailableMessage(unavailableReason)}</p>
        <p>请选择个人空间或其他有效工作区；如需恢复学校权限，请联系学校管理员。</p>
        <Button variant="outline" disabled={directory.refreshing} onClick={() => void directory.retry()}>刷新成员身份</Button>
      </div>}
      {directory.error && <div className={styles.error} role="alert"><p>{directory.error.message}</p><Button variant="secondary" onClick={() => void directory.retry()}>重新加载</Button></div>}
      {!workspaces && !directory.error && <p className={styles.loading} role="status">正在加载可进入的工作区…</p>}
      {workspaces && <div className={styles.list}>{workspaces.map(workspace => {
        const Icon = workspace.type === 'platform' ? ShieldCheck : workspace.type === 'personal' ? UserRound : Building2
        return <Button variant="ghost" key={workspace.organizationId || workspace.type} type="button" className={styles.item} onClick={() => enter(workspace)} disabled={entering !== null}>
          <span className={styles.icon}><Icon size={20} /></span>
          <span><strong>{workspaceTitle(workspace)}</strong><small>{workspaceSubtitle(workspace, user.username)}</small></span><ChevronRight size={18} />
        </Button>
      })}</div>}
      {workspaces && !workspaces.length && !directory.error && <div className={styles.error} role="status"><p>暂时没有可进入的工作区。</p><Button variant="secondary" onClick={() => void directory.retry()}>重新加载</Button></div>}
    </section>
  </main>
}
