'use client'

import type { SelectionPreviewRow } from '../model/problemSelection'
import { ProblemReferenceLink } from './ProblemReferenceLink'
import styles from './ProblemReferenceSelector.module.css'

export function ProblemReferenceResult({
  row,
  resolving = false,
  requestError,
}: {
  row?: SelectionPreviewRow | null
  resolving?: boolean
  requestError?: string
}) {
  if (resolving) return <span className={styles.resultIdle}>正在检索…</span>
  if (requestError) return <span className={styles.resultContent}><span className={styles.resultError}>✕</span><span>{requestError}</span></span>
  if (!row) return <span className={styles.resultIdle}>输入题号后自动检索</span>

  const problem = row.result.problem
  if (problem) {
    const warning = row.state !== 'ready'
    return <span className={styles.resultContent}>
      <span className={warning ? styles.resultWarning : styles.resultSuccess}>{warning ? '⚠' : '✓'}</span>
      <ProblemReferenceLink problem={problem} showIdentity={false} />
      {row.message && <span className={styles.resultMeta}>{row.message}</span>}
    </span>
  }

  const warning = row.result.status === 'identity_conflict' || row.result.status === 'invalid_input'
  return <span className={styles.resultContent}>
    <span className={warning ? styles.resultWarning : styles.resultError}>{warning ? '⚠' : '✕'}</span>
    <span>{row.message}</span>
  </span>
}
