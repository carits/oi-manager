'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import {
  BLOG_REFERENCE_LABELS,
  emptyBlogReference,
  type BlogDraftReference,
  type BlogReferenceType,
} from './blog-contract'
import styles from './BlogWorkspace.module.css'

function targetFields(reference: BlogDraftReference, update: (patch: Partial<BlogDraftReference>) => void) {
  if (reference.type === 'PROBLEM') {
    return <FormField label="题目内部 ID" required><Input value={reference.problemId || ''} onChange={event => update({ problemId: event.target.value })} placeholder="Problem.id" /></FormField>
  }
  if (reference.type === 'PROBLEM_REVISION') {
    return <>
      <FormField label="题目内部 ID" required><Input value={reference.problemId || ''} onChange={event => update({ problemId: event.target.value })} placeholder="Problem.id" /></FormField>
      <FormField label="TestSet Revision ID" required><Input value={reference.problemRevisionId || ''} onChange={event => update({ problemRevisionId: event.target.value })} placeholder="ProblemTestSetRevision.id" /></FormField>
    </>
  }
  if (reference.type === 'SOLUTION_VERSION') {
    return <FormField label="题解 Version ID" required><Input value={reference.solutionVersionId || ''} onChange={event => update({ solutionVersionId: event.target.value })} placeholder="ProblemSolutionVersion.id" /></FormField>
  }
  if (reference.type === 'CONTEST_STANDING') {
    return <FormField label="Standing Snapshot ID" required><Input value={reference.standingSnapshotId || ''} onChange={event => update({ standingSnapshotId: event.target.value })} placeholder="ContestStandingSnapshot.id" /></FormField>
  }
  return <FormField label="RatingChange ID" required><Input value={reference.ratingChangeId || ''} onChange={event => update({ ratingChangeId: event.target.value })} placeholder="RatingChange.id" /></FormField>
}

export function BlogReferenceEditor({ value, onChange }: { value: BlogDraftReference[]; onChange: (value: BlogDraftReference[]) => void }) {
  const update = (index: number, patch: Partial<BlogDraftReference>) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const changeType = (index: number, type: BlogReferenceType) => onChange(value.map((item, itemIndex) => itemIndex === index
    ? { ...emptyBlogReference(type), relationType: item.relationType, displayMode: item.displayMode, positionKey: item.positionKey }
    : item))

  return <div className={styles.referenceEditor}>
    <div className={styles.referenceHeading}>
      <div><strong>结构化引用</strong><p>引用在发布时会解析并固定。正文里的普通链接不会建立事实关系。</p></div>
      <Button size="sm" variant="outline" icon={<Plus size={15} />} onClick={() => onChange([...value, emptyBlogReference()])}>添加引用</Button>
    </div>
    {value.length === 0 && <p className={styles.muted}>暂未添加引用。关联题目、固定测试集、题解版本、比赛榜单或 Rating 后，可从对应页面反向找到本文。</p>}
    {value.map((reference, index) => <article className={styles.referenceDraft} key={`${index}-${reference.type}`}>
      <div className={styles.referenceDraftHeader}><strong>引用 {index + 1}</strong><Button iconOnly aria-label={`删除引用 ${index + 1}`} size="sm" variant="ghost" icon={<Trash2 size={16} />} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} /></div>
      <div className={styles.formGrid}>
        <FormField label="引用类型" required><Select value={reference.type} onChange={event => changeType(index, event.target.value as BlogReferenceType)}>{Object.entries(BLOG_REFERENCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</Select></FormField>
        {targetFields(reference, patch => update(index, patch))}
        <FormField label="关系"><Select value={reference.relationType} onChange={event => update(index, { relationType: event.target.value as BlogDraftReference['relationType'] })}><option value="PRIMARY_SUBJECT">主要对象</option><option value="MENTION">提及</option><option value="SOURCE">来源</option><option value="RESULT">结果</option></Select></FormField>
        <FormField label="展示方式"><Select value={reference.displayMode} onChange={event => update(index, { displayMode: event.target.value as BlogDraftReference['displayMode'] })}><option value="CARD">引用卡片</option><option value="INLINE">行内信息</option><option value="COMPACT">紧凑</option><option value="EMBED">嵌入</option><option value="HIDDEN_METADATA">只建立索引</option></Select></FormField>
        <FormField label="位置键" hint="可选；用于稳定定位引用卡片"><Input value={reference.positionKey || ''} onChange={event => update(index, { positionKey: event.target.value })} placeholder="例如 main-problem" /></FormField>
      </div>
    </article>)}
  </div>
}
