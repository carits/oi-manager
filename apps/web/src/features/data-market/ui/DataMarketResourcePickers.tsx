'use client'

import { useEffect, useState } from 'react'
import { Select } from '@/components/ui/FormControls'
import { activityStatusLabel } from '@/lib/humanPresentation'
import { listWorkspaces } from '@/features/workspace'
import type { WorkspaceSummary } from '@oi-manager/contracts'
import { getDataMarketQuality, listDataMarketContests, listDataMarketProblems, listDataMarketRevisions, type DataMarketContest as Contest, type DataMarketProblem as Problem, type DataMarketQuality as Quality, type DataMarketRevision as Revision } from '../api/dataMarketApi'


export function ProblemRevisionPicker({ problemId, revisionId, onProblemChange, onRevisionChange, onQualityChange, requireQuality = false, lockProblem = false }: {
  problemId: string
  revisionId: string
  onProblemChange: (id: string) => void
  onRevisionChange: (id: string) => void
  onQualityChange?: (id: string) => void
  requireQuality?: boolean
  lockProblem?: boolean
}) {
  const [problems, setProblems] = useState<Problem[]>([])
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [quality, setQuality] = useState<Quality | null>(null)

  useEffect(() => {
    void listDataMarketProblems().then(setProblems).catch(() => setProblems([]))
  }, [])
  useEffect(() => {
    setRevisions([]); setQuality(null)
    if (!problemId) return
    void listDataMarketRevisions(problemId).then(setRevisions).catch(() => setRevisions([]))
  }, [problemId])
  useEffect(() => {
    setQuality(null); onQualityChange?.('')
    if (!problemId || !revisionId || !requireQuality) return
    void getDataMarketQuality(problemId, revisionId).then(snapshot => {
      setQuality(snapshot)
      if (snapshot?.qualityStatus === 'READY' && snapshot.criticalIssueCount === 0) onQualityChange?.(snapshot.id)
    }).catch(() => setQuality(null))
  // Callback identity must not retrigger resource loading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, requireQuality, revisionId])

  return <>
    <label>题目
      <Select value={problemId} disabled={lockProblem} onChange={event => { onProblemChange(event.target.value); onRevisionChange(''); onQualityChange?.('') }}>
        <option value="">请选择题目</option>
        {problems.map(problem => <option key={problem.id} value={problem.id}>{problem.platform} · {problem.problemId} · {problem.title}</option>)}
      </Select>
    </label>
    <label>测试数据版本
      <Select value={revisionId} disabled={!problemId} onChange={event => onRevisionChange(event.target.value)}>
        <option value="">请选择版本</option>
        {revisions.map(revision => <option key={revision.id} value={revision.id}>数据版本 R{revision.revisionNumber} · {revision.mode.toUpperCase()}</option>)}
      </Select>
    </label>
    {requireQuality && revisionId && <p aria-live="polite">
      {!quality ? '正在读取质量证书…' : quality.qualityStatus === 'READY' && quality.criticalIssueCount === 0 ? `已选择可用质量证书（${quality.overallScore ?? '—'} 分）` : '该版本尚无可用的质量证书'}
    </p>}
  </>
}

export function LicenseScopePicker({ license, organizationId, contestId, onOrganizationChange, onContestChange }: {
  license: string
  organizationId: string
  contestId: string
  onOrganizationChange: (id: string) => void
  onContestChange: (id: string) => void
}) {
  const [organizations, setOrganizations] = useState<WorkspaceSummary[]>([])
  const [contests, setContests] = useState<Contest[]>([])
  useEffect(() => {
    if (license === 'PERSONAL') return
    void listWorkspaces().then(result => setOrganizations(result.workspaces.filter(item => item.type === 'organization'))).catch(() => setOrganizations([]))
  }, [license])
  useEffect(() => {
    setContests([]); onContestChange('')
    if (license !== 'CONTEST' || !organizationId) return
    void listDataMarketContests(organizationId).then(setContests).catch(() => setContests([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license, organizationId])

  if (license === 'PERSONAL') return null
  return <>
    <label>学校
      <Select value={organizationId} onChange={event => onOrganizationChange(event.target.value)}>
        <option value="">请选择学校</option>
        {organizations.map(item => <option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}
      </Select>
    </label>
    {license === 'CONTEST' && <label>比赛
      <Select value={contestId} disabled={!organizationId} onChange={event => onContestChange(event.target.value)}>
        <option value="">请选择比赛</option>
        {contests.map(item => <option key={item.id} value={item.id}>{item.title || item.name || `比赛 ${item.id}`}{item.status ? ` · ${activityStatusLabel(item.status)}` : ''}</option>)}
      </Select>
    </label>}
  </>
}
