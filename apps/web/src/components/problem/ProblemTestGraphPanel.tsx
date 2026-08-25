'use client'

import { useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'

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
  const [graph, setGraph] = useState<TestGraph | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    apiClient.get<TestGraph>(`/api/problems/${problemId}/test-graph`)
      .then(result => { if (active && result.success && result.data) setGraph(result.data) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [problemId])

  if (loading) return <div style={{ color: 'var(--gray-500)', fontSize: 13 }}>{'\u6b63\u5728\u52a0\u8f7d\u6d4b\u8bd5\u56fe...'}</div>
  if (!graph?.migrated) return (
    <section style={{ padding: 16, border: '1px solid #f59e0b', borderRadius: 12, background: '#fffbeb' }}>
      <strong>{'OI \u6d4b\u8bd5\u56fe\u5c1a\u672a\u8fc1\u79fb'}</strong>
      <div style={{ marginTop: 6, color: '#92400e', fontSize: 13 }}>{graph?.migrationIssues?.join('; ') || '\u8bf7\u7531\u8d85\u7ea7\u7ba1\u7406\u5458\u5148\u6267\u884c\u5b89\u5168\u8fc1\u79fb\u68c0\u67e5\u3002'}</div>
    </section>
  )

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
        <div><strong>{'Subtask / Test Group / Testcase \u6d4b\u8bd5\u56fe'}</strong><div style={{ marginTop: 4, color: 'var(--gray-500)', fontSize: 12 }}>{'Hack Gate \u7531\u7cfb\u7edf\u7ef4\u62a4\uff0c\u4e0d\u5360\u7528\u989d\u5916\u5206\u503c\u3002'}</div></div>
        <span style={{ color: 'var(--gray-500)', fontSize: 12 }}>revision {graph.revision}</span>
      </div>
      {graph.subtasks.map(subtask => (
        <article key={subtask.id} style={{ padding: 14, border: '1px solid var(--gray-200)', borderRadius: 10, background: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>Subtask {subtask.id}</strong><span>{subtask.score} {'\u5206'}{subtask.if.length ? ` / depends on ${subtask.if.join(', ')}` : ''}</span></div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {subtask.groups.map(group => <div key={group.id} style={{ padding: '9px 11px', borderRadius: 8, background: group.kind === 'hack_gate' ? '#f0fdf4' : 'var(--gray-50)', border: `1px solid ${group.kind === 'hack_gate' ? '#bbf7d0' : 'var(--gray-200)'}` }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{group.kind === 'hack_gate' ? '\u7cfb\u7edf Hack Gate' : group.name}</span><span style={{ color: 'var(--gray-500)', fontSize: 12 }}>{group.type} / {group.cases.length} cases{group.kind === 'official' ? ` / ${group.score} points` : ''}</span></div></div>)}
          </div>
        </article>
      ))}
    </section>
  )
}
