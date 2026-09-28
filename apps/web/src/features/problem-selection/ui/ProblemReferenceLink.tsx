'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getOjPlatformLabel } from '@/lib/oj-platforms'
import type { SelectedCanonicalProblem } from '../model/problemSelection'
import { problemReferenceHref } from '../model/problemReferencePath'
import styles from './ProblemReferenceSelector.module.css'

export function ProblemReferenceLink({
  problem,
  showIdentity = true,
  openInNewTab = true,
}: {
  problem: Pick<SelectedCanonicalProblem, 'id' | 'platform' | 'problemId' | 'title'>
  showIdentity?: boolean
  openInNewTab?: boolean
}) {
  const pathname = usePathname()
  return <span className={styles.problemLink}>
    {showIdentity && <span className={styles.problemIdentity}>{getOjPlatformLabel(problem.platform)} · {problem.problemId}</span>}
    <Link
      className={styles.problemTitle}
      href={problemReferenceHref(pathname, problem.id)}
      target={openInNewTab ? '_blank' : undefined}
      rel={openInNewTab ? 'noopener noreferrer' : undefined}
      title={openInNewTab ? '在新窗口查看题目' : undefined}
    >{problem.title}</Link>
  </span>
}
