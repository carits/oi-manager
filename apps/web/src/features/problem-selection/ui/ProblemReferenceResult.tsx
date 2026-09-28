'use client'

import type { SelectionPreviewRow } from '../model/problemSelection'
import { ProblemReferenceLink } from './ProblemReferenceLink'
import styles from './ProblemReferenceSelector.module.css'

export function ProblemReferenceResult({ row, resolving = false, requestError }: {
  row?: SelectionPreviewRow | null
  resolving?: boolean
  requestError?: string | null
}) {
  if (requestError) return <span className={styles.resultContent}><span className={styles.resultError} aria-hidden="true">✕</span><span>{requestError}</span></span>
  if (resolving) return <span className={styles.resultIdle}>正在检索…</span>
  if (!row) return <span className={styles.resultIdle}>输入题号后自动检索</span>
  const problem = row.result.problem
  if (problem) return <span className={styles.resultContent}>
    <span className={row.result.status === 'resolved' ? styles.resultSuccess : styles.resultWarning} aria-hidden="true">{row.result.status === 'resolved' ? '✓' : '⚠'}</span>
    <ProblemReferenceLink problem={problem} showIdentity={false} />
    {row.state !== 'ready' && <span className={styles.resultMeta}>{row.message}</span>}
  </span>
  const warning = row.result.status === 'identity_conflict' || row.result.status === 'invalid_input'
  return <span className={styles.resultContent}><span className={warning ? styles.resultWarning : styles.resultError} aria-hidden="true">{warning ? '⚠' : '✕'}</span><span>{row.message}</span></span>
}
