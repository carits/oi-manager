'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useEffect, useState } from 'react'
import { Select } from '@/components/ui/FormControls'
import { useToast } from '@/components/ui/Toast'
import { activityStatusLabel } from '@/lib/humanPresentation'
import { ojPlatformDisplayName } from '@/lib/oj-platforms'
import { listWorkspaces } from '@/features/workspace'
import type { WorkspaceSummary } from '@oi-manager/contracts'
import { getDataMarketQuality, listDataMarketContests, listDataMarketProblems, listDataMarketSlots, type DataMarketContest as Contest, type DataMarketProblem as Problem, type DataMarketQuality as Quality, type DataMarketSlot as Slot } from '../api/dataMarketApi'


export function ProblemSlotPicker({ problemId, slot, onProblemChange, onSlotChange, onQualityChange, requireQuality = false, lockProblem = false }: {
  problemId: string
  slot: string
  onProblemChange: (id: string) => void
  onSlotChange: (slot: string) => void
  onQualityChange?: (id: string) => void
  requireQuality?: boolean
  lockProblem?: boolean
}) {
  const [problems, setProblems] = useState<Problem[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [quality, setQuality] = useState<Quality | null>(null)
  const toast = useToast()

  useEffect(() => {
    void listDataMarketProblems().then(setProblems).catch(error => { setProblems([]); toast.error(publicErrorMessage(error, '题目列表加载失败')) })
  }, [])
  useEffect(() => {
    setSlots([]); setQuality(null)
    if (!problemId) return
    void listDataMarketSlots(problemId).then(setSlots).catch(error => { setSlots([]); toast.error(publicErrorMessage(error, '评测数据加载失败')) })
  }, [problemId])
  useEffect(() => {
    setQuality(null); onQualityChange?.('')
    if (!problemId || !slot || !requireQuality) return
    void getDataMarketQuality(problemId, slot as 'STABLE' | 'EVOLVING').then(snapshot => {
      setQuality(snapshot)
      if (snapshot?.qualityStatus === 'READY' && snapshot.criticalIssueCount === 0) onQualityChange?.(snapshot.id)
    }).catch(error => { setQuality(null); toast.error(publicErrorMessage(error, '质量证书加载失败')) })
  // Callback identity must not retrigger resource loading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, requireQuality, slot, toast])

  return <>
    <label>题目
      <Select value={problemId} disabled={lockProblem} onChange={event => { onProblemChange(event.target.value); onSlotChange(''); onQualityChange?.('') }}>
        <option value="">请选择题目</option>
        {problems.map(problem => <option key={problem.id} value={problem.id}>{ojPlatformDisplayName(problem.platform)} · {problem.problemId} · {problem.title}</option>)}
      </Select>
    </label>
    <label>评测数据
      <Select value={slot} disabled={!problemId} onChange={event => onSlotChange(event.target.value)}>
        <option value="">请选择评测数据</option>
        {slots.map(item => <option key={item.slot} value={item.slot}>{item.slot === 'STABLE' ? '正式评测数据' : '当前评测数据'}</option>)}
      </Select>
    </label>
    {requireQuality && slot && <p aria-live="polite">
      {!quality ? '正在读取质量证书…' : quality.qualityStatus === 'READY' && quality.criticalIssueCount === 0 ? `已选择可用质量证书（${quality.overallScore ?? '—'} 分）` : '该评测数据尚无可用的质量证书'}
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
  const toast = useToast()
  useEffect(() => {
    if (license === 'PERSONAL') return
    void listWorkspaces().then(result => setOrganizations(result.workspaces.filter(item => item.type === 'organization'))).catch(error => { setOrganizations([]); toast.error(publicErrorMessage(error, '学校列表加载失败')) })
  }, [license, toast])
  useEffect(() => {
    setContests([]); onContestChange('')
    if (license !== 'CONTEST' || !organizationId) return
    void listDataMarketContests(organizationId).then(setContests).catch(error => { setContests([]); toast.error(publicErrorMessage(error, '比赛列表加载失败')) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license, organizationId, toast])

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
        {contests.map(item => <option key={item.id} value={item.id}>{item.title || item.name || '未命名比赛'}{item.status ? ` · ${activityStatusLabel(item.status)}` : ''}</option>)}
      </Select>
    </label>}
  </>
}
