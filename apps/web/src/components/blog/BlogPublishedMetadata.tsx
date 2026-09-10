'use client'

import { StatusBadge } from '@/components/ui/Badge'
import { BLOG_REFERENCE_LABELS, BLOG_VISIBILITY_LABELS, referenceSnapshotTitle, type BlogClassificationSnapshot, type BlogReferenceType, type BlogVisibility } from './blog-contract'
import styles from './BlogPublishedMetadata.module.css'

export type PublishedBlogReference = {
  id: string
  type: BlogReferenceType
  referenceId: string
  referenceVersionId?: string | null
  accessMode: BlogVisibility
  status: string
  snapshot?: unknown
}

export function BlogClassificationView({ classification }: { classification?: BlogClassificationSnapshot | null }) {
  if (!classification?.series && !classification?.tags?.length) return null
  return <div className={styles.classification}>
    {classification.series && <span>系列：{classification.series.title}</span>}
    {classification.tags?.map(tag => <StatusBadge key={tag.id} variant="neutral">{tag.name}</StatusBadge>)}
  </div>
}

export function BlogReferenceCards({ references }: { references: PublishedBlogReference[] }) {
  if (!references.length) return <p className={styles.muted}>这个版本没有结构化引用。</p>
  return <div className={styles.cards}>{references.map(reference => <article key={reference.id}>
    <div><StatusBadge variant={reference.status === 'CURRENT' ? 'info' : 'warning'}>{reference.status === 'CURRENT' ? '固定引用' : reference.status === 'SUPERSEDED' ? '来源已有新版本' : '引用状态需关注'}</StatusBadge><span>{BLOG_REFERENCE_LABELS[reference.type]}</span></div>
    <strong>{referenceSnapshotTitle(reference)}</strong>
    <small>{reference.referenceVersionId ? `版本：${reference.referenceVersionId}` : `对象：${reference.referenceId}`} · 最大可见范围：{BLOG_VISIBILITY_LABELS[reference.accessMode]}</small>
  </article>)}</div>
}
