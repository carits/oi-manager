'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './ProblemTestGraphPanel.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

type TestGraph = {
  revision: number
  migrated: boolean
  migrationIssues?: string[]
  subtasks: Array<{
    id: number
    score: number
    if: number[]
    groups: Array<{ id: string; name: string; kind: 'official' | 'hack_gate'; score: number; type: string; cases: Array<{ testcaseId: string; input: string; output: string; source: string }> }>
  }>
}

export function ProblemTestGraphPanel({ problemId }: { problemId: string }) {
  const toast = useToast()
  const [graph, setGraph] = useState<TestGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    apiClient.get<TestGraph>(`/api/problems/${problemId}/test-graph`)
      .then(result => { if (active && result.success && result.data) setGraph(result.data) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [problemId])

  if (loading) return <div className={unifiedStyles.u1}>{'\u6b63\u5728\u52a0\u8f7d\u6d4b\u8bd5\u56fe...'}</div>
  if (!graph?.migrated) return (
    <section className={unifiedStyles.u14}>
      <strong>{'OI \u6d4b\u8bd5\u56fe\u5c1a\u672a\u8fc1\u79fb'}</strong>
      <div className={unifiedStyles.u15}>{graph?.migrationIssues?.join('; ') || '\u8bf7\u7531\u8d85\u7ea7\u7ba1\u7406\u5458\u5148\u6267\u884c\u5b89\u5168\u8fc1\u79fb\u68c0\u67e5\u3002'}</div>
    </section>
  )

  const beginEdit = () => {
    setDraft(JSON.stringify({ revision: graph.revision, subtasks: graph.subtasks }, null, 2))
    setEditing(true)
  }
  const save = async () => {
    let payload: unknown
    try { payload = JSON.parse(draft) } catch { return toast.error('\u6d4b\u8bd5\u56fe JSON \u683c\u5f0f\u65e0\u6548') }
    setSaving(true)
    try {
      const result = await apiClient.put<TestGraph>(`/api/problems/${problemId}/test-graph`, payload)
      if (!result.success || !result.data) return toast.error(result.message || '\u4fdd\u5b58\u5931\u8d25')
      setGraph(result.data)
      setEditing(false)
      toast.success('\u6d4b\u8bd5\u56fe\u5df2\u4fdd\u5b58\u5e76\u751f\u6210 Judge \u6295\u5f71')
    } finally { setSaving(false) }
  }

  return (
    <section className={unifiedStyles.u2}>
      <div className={unifiedStyles.u3}>
        <div><strong>{'Subtask / Test Group / Testcase \u6d4b\u8bd5\u56fe'}</strong><div className={unifiedStyles.u4}>{'Hack Gate \u7531\u7cfb\u7edf\u7ef4\u62a4\uff0c\u4e0d\u5360\u7528\u989d\u5916\u5206\u503c\u3002'}</div></div>
        <div className={unifiedStyles.u5}><span className={unifiedStyles.u6}>revision {graph.revision}</span><Button variant="ghost" type="button" onClick={editing ? () => setEditing(false) : beginEdit} className={unifiedStyles.u7}>{editing ? '\u53d6\u6d88\u7f16\u8f91' : '\u7f16\u8f91\u6d4b\u8bd5\u56fe'}</Button></div>
      </div>
      {editing && <div className={unifiedStyles.u8}><div className={unifiedStyles.u16}>{'\u53ef\u7f16\u8f91 Subtask\u3001Official Group \u548c Testcase \u5173\u8054\u3002Hack Gate \u4e3a\u53ea\u8bfb\uff0c\u4fee\u6539\u4f1a\u88ab\u670d\u52a1\u7aef\u62d2\u7edd\u3002'}</div><Textarea value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} className={unifiedStyles.u9} /><div className={unifiedStyles.u10}><Button variant="ghost" type="button" disabled={saving} onClick={save} style={{ padding: '8px 14px', border: 0, borderRadius: 8, background: 'var(--primary)', color: 'white', cursor: saving ? 'wait' : 'pointer' }}>{saving ? '\u4fdd\u5b58\u4e2d...' : '\u4fdd\u5b58\u6d4b\u8bd5\u56fe'}</Button></div></div>}
      {graph.subtasks.map(subtask => (
        <article key={subtask.id} className={unifiedStyles.u11}>
          <div className={unifiedStyles.u12}><strong>Subtask {subtask.id}</strong><span>{subtask.score} {'\u5206'}{subtask.if.length ? ` / depends on ${subtask.if.join(', ')}` : ''}</span></div>
          <div className={unifiedStyles.u13}>
            {subtask.groups.map(group => <div key={group.id} style={{ padding: '9px 11px', borderRadius: 8, background: group.kind === 'hack_gate' ? '#f0fdf4' : 'var(--gray-50)', border: `1px solid ${group.kind === 'hack_gate' ? '#bbf7d0' : 'var(--gray-200)'}` }}><div className={unifiedStyles.u12}><span>{group.kind === 'hack_gate' ? '\u7cfb\u7edf Hack Gate' : group.name}</span><span className={unifiedStyles.u6}>{group.type} / {group.cases.length} cases{group.kind === 'official' ? ` / ${group.score} points` : ''}</span></div></div>)}
          </div>
        </article>
      ))}
    </section>
  )
}
