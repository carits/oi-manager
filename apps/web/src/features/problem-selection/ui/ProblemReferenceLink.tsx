'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { getOjPlatformLabel } from '@/lib/oj-platforms'
import type { SelectedCanonicalProblem } from '../model/problemSelection'
import styles from './ProblemReferenceSelector.module.css'

export function ProblemReferenceLink({
  problem,
  showIdentity = true,
}: {
  problem: Pick<SelectedCanonicalProblem, 'id' | 'platform' | 'problemId' | 'title'>
  showIdentity?: boolean
}) {
  const pathname = usePathname()
  const { user } = useAuth()
  const prefix = currentWorkspacePrefix(pathname, user?.accountRole === 'platform_admin' ? '/platform-admin' : '/personal')
  const href = `${prefix}/problems/${problem.id}?returnTo=${encodeURIComponent(pathname)}`
  return <span className={styles.problemLink}>
    {showIdentity && <span className={styles.problemIdentity}>{getOjPlatformLabel(problem.platform)} · {problem.problemId}</span>}
    <Link className={styles.problemTitle} href={href}>{problem.title}</Link>
  </span>
}
