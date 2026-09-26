'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import apiClient from '@/lib/apiClient'
import {
  BLOG_REFERENCE_LABELS,
  emptyBlogReference,
  type BlogDraftReference,
  type BlogReferenceType,
} from '../model/blog-contract'
import styles from './BlogWorkspace.module.css'

type ProblemOption = { id: string; problemId: string; title: string; platform: string }
type RevisionOption = { id: string; revisionNumber: number }

function ProblemReferencePicker({ reference, update }: { reference: BlogDraftReference; update: (patch: Partial<BlogDraftReference>) => void }) {
  const [problems, setProblems] = useState<ProblemOption[]>([])
  const [revisions, setRevisions] = useState<RevisionOption[]>([])
  useEffect(() => {
    void Promise.all([
      apiClient.get<{ data: ProblemOption[] }>('/api/problems?library=platform&pageSize=100'),
      apiClient.get<{ data: ProblemOption[] }>('/api/problems?library=school&pageSize=100'),
    ]).then(results => setProblems(Array.from(new Map(results.flatMap(result => result.success ? result.data?.data || [] : []).map(item => [item.id, item])).values())))
  }, [])
  useEffect(() => {
    setRevisions([])
    if (!reference.problemId || reference.type !== 'PROBLEM_REVISION') return
    void apiClient.get<{ revisions: RevisionOption[] }>(`/api/problems/${reference.problemId}/test-set-revisions`).then(result => {
      if (result.success) setRevisions(result.data?.revisions || [])
    })
  }, [reference.problemId, reference.type])
  return <>
    <FormField label="题目" required><Select value={reference.problemId || ''} onChange={event => update({ problemId: event.target.value, problemRevisionId: undefined })}><option value="">搜索结果中选择题目</option>{problems.map(problem => <option value={problem.id} key={problem.id}>{problem.platform} · {problem.problemId} · {problem.title}</option>)}</Select></FormField>
    {reference.type === 'PROBLEM_REVISION' && <FormField label="固定的数据版本" required><Select value={reference.problemRevisionId || ''} disabled={!reference.problemId} onChange={event => update({ problemRevisionId: event.target.value })}><option value="">请选择数据版本</option>{revisions.map(revision => <option value={revision.id} key={revision.id}>数据版本 R{revision.revisionNumber}</option>)}</Select></FormField>}
  </>
}

function targetFields(reference: BlogDraftReference, update: (patch: Partial<BlogDraftReference>) => void) {
  if (reference.type === 'PROBLEM') {
    return <ProblemReferencePicker reference={reference} update={update} />
  }
  if (reference.type === 'PROBLEM_REVISION') {
    return <ProblemReferencePicker reference={reference} update={update} />
  }
  const linked = Boolean(reference.solutionVersionId || reference.standingSnapshotId || reference.ratingChangeId || reference.submissionSnapshotId)
  return <FormField label="关联对象" required><div><p>{linked ? '已从来源页面关联固定内容。' : '请到对应的题解、比赛榜单或 Rating 记录页面，点击“写文章”建立引用。'}</p>{linked && <Button size="sm" variant="secondary" onClick={() => update({ solutionVersionId: undefined, standingSnapshotId: undefined, ratingChangeId: undefined, submissionSnapshotId: undefined })}>清除关联</Button>}</div></FormField>
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
        <FormField label="引用类型" required><Select value={reference.type} onChange={event => changeType(index, event.target.value as BlogReferenceType)}>{Object.entries(BLOG_REFERENCE_LABELS).map(([key, label]) => <option value={key} key={key} disabled={!['PROBLEM', 'PROBLEM_REVISION'].includes(key) && key !== reference.type}>{label}{!['PROBLEM', 'PROBLEM_REVISION'].includes(key) ? '（从来源页面添加）' : ''}</option>)}</Select></FormField>
        {targetFields(reference, patch => update(index, patch))}
        <details><summary>高级展示设置</summary>
          <FormField label="文章中的关系"><Select value={reference.relationType} onChange={event => update(index, { relationType: event.target.value as BlogDraftReference['relationType'] })}><option value="PRIMARY_SUBJECT">主要对象</option><option value="MENTION">提及</option><option value="SOURCE">来源</option><option value="RESULT">结果</option><option value="SOLUTION">题解</option><option value="FOLLOW_UP">后续</option></Select></FormField>
          <FormField label="展示方式"><Select value={reference.displayMode} onChange={event => update(index, { displayMode: event.target.value as BlogDraftReference['displayMode'] })}><option value="CARD">引用卡片</option><option value="INLINE">行内信息</option><option value="COMPACT">紧凑</option><option value="EMBED">嵌入</option><option value="HIDDEN_METADATA">只建立索引</option></Select></FormField>
          <FormField label="内容位置标记" hint="可选；仅用于复杂文章中稳定排列引用卡片"><Input value={reference.positionKey || ''} onChange={event => update(index, { positionKey: event.target.value })} placeholder="例如 main-problem" /></FormField>
        </details>
      </div>
    </article>)}
  </div>
}
