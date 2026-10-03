import { describe, expect, it } from 'vitest'
import {
  buildContributionTimeline,
  candidateLifecyclePresentation,
  contributionStageLabel,
  hackCanonicalPresentation,
} from '../model/problem-contribution-display'

describe('problem contribution lifecycle display', () => {
  it('distinguishes a valid counterexample from adopted evaluation data', () => {
    expect(hackCanonicalPresentation({ technicalStatus: 'accepted', canonicalStatus: 'pending', candidateStatus: 'ELIGIBLE' }).label)
      .toContain('等待质量评估')
    expect(hackCanonicalPresentation({ technicalStatus: 'accepted', canonicalStatus: 'promoted', promotedGraphHash: 'abcdef123456' }).label)
      .toBe('已纳入评测数据')
  })

  it('describes candidate terminal states without claiming adoption', () => {
    expect(candidateLifecyclePresentation('ELIGIBLE_NOT_SELECTED', 'selector_not_selected').label).toContain('未达到')
    expect(candidateLifecyclePresentation('WAITING_REPLACEMENT', 'waiting_replacement').label).toContain('等待更新评测数据')
  })

  it('fails closed for unknown backend stages', () => {
    const internal = 'FUTURE_INTERNAL_VALUE'
    const timeline = buildContributionTimeline({ sourceMode: 'input', status: 'running', stage: internal })
    expect(timeline).toEqual([{ stage: 'unknown', label: '处理状态待确认', state: 'current' }])
    expect(JSON.stringify(timeline)).not.toContain(internal)
    expect(contributionStageLabel(internal)).not.toContain(internal)
    expect(candidateLifecyclePresentation(internal, internal).label).not.toContain(internal)
    expect(hackCanonicalPresentation({ technicalStatus: internal, canonicalStatus: internal }).label).not.toContain(internal)
  })
})
