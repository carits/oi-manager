'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { StatusBadge } from '@/components/ui/Badge'
import { BLOG_PUBLISHED_REFERENCE_LABELS, BLOG_VISIBILITY_LABELS, referenceSnapshotTitle, type BlogClassificationSnapshot, type PublishedBlogReferenceType } from '../model/blog-contract'
import { referenceHref, type PublishedBlogReference } from './blog-reference-navigation'
import styles from './BlogPublishedMetadata.module.css'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { resolveNavigationContext } from '@/lib/navigationContext'

export type { PublishedBlogReference } from './blog-reference-navigation'

function referenceActionLabel(type: PublishedBlogReferenceType) {
  if (type === 'PROBLEM' || type === 'PROBLEM_REVISION') return '查看题目'
  if (type === 'SOLUTION_VERSION') return '查看题解'
  if (type === 'CONTEST_STANDING') return '查看比赛榜单'
  if (type === 'RATING_CHANGE') return '查看 Rating 变化'
  return '查看提交快照'
}

export function BlogClassificationView({ classification }: { classification?: BlogClassificationSnapshot | null }) {
  if (!classification?.series && !classification?.tags?.length) return null
  return <div className={styles.classification}>
    {classification.series && <span>系列：{classification.series.title}</span>}
    {classification.tags?.map(tag => <StatusBadge key={tag.id} variant="neutral">{tag.name}</StatusBadge>)}
  </div>
}

export function BlogReferenceCards({ references, publicRead = false }: { references: PublishedBlogReference[]; publicRead?: boolean }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const navigationContext = publicRead && !user ? null : resolveNavigationContext(pathname, user)
  if (!references.length) return <p className={styles.muted}>这个版本没有结构化引用。</p>
  return <div className={styles.cards}>{references.map(reference => {
    const href = referenceHref(reference, navigationContext)
    const snapshot = (reference.snapshot || {}) as Record<string, unknown>
    const display = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '—'
    return <article key={reference.id}>
      <div><StatusBadge variant={reference.status === 'CURRENT' ? 'info' : 'warning'}>{reference.status === 'CURRENT' ? '固定引用' : reference.status === 'SUPERSEDED' ? '来源已有新版本' : '引用状态需关注'}</StatusBadge><span>{BLOG_PUBLISHED_REFERENCE_LABELS[reference.type]}</span></div>
      <strong>{referenceSnapshotTitle(reference)}</strong>
      <small>{reference.referenceVersionId ? `版本：${reference.referenceVersionId}` : `对象：${reference.referenceId}`} · 最大可见范围：{BLOG_VISIBILITY_LABELS[reference.accessMode]}</small>
      {href
        ? <Link className={styles.referenceLink} href={href}>{referenceActionLabel(reference.type)}<ArrowRight size={15} /></Link>
        : reference.type === 'SUBMISSION_SNAPSHOT'
          ? <details className={styles.snapshotDetails}><summary>{referenceActionLabel(reference.type)}</summary><dl><div><dt>来源</dt><dd>{display(snapshot.sourcePlatform)} · {display(snapshot.sourceProblemId)}</dd></div><div><dt>结果</dt><dd>{display(snapshot.result)}{typeof snapshot.score === 'number' ? ` · ${snapshot.score} 分` : ''}</dd></div><div><dt>语言</dt><dd>{display(snapshot.language)}</dd></div></dl></details>
          : null}
    </article>
  })}</div>
}
