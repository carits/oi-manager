import { describe, expect, it } from 'vitest'
import { displayScore, effectiveQualityStatus, qualityJobPresentation, qualityStatusPresentation } from '../model/problem-quality-display'

describe('problem quality presentation', () => {
  it('never turns a Critical or not-ready certificate into a numeric score', () => {
    expect(displayScore(null)).toBe('—')
    expect(qualityStatusPresentation('CRITICAL')).toMatchObject({ label: '严重问题', variant: 'error' })
    expect(qualityStatusPresentation('NOT_READY')).toMatchObject({ label: '未就绪', variant: 'warning' })
  })

  it('marks an earlier quality result as expired after its inputs change', () => {
    expect(effectiveQualityStatus('READY', true)).toBe('STALE')
    expect(qualityStatusPresentation('READY', true).label).toBe('已过期')
  })

  it('maps asynchronous job states to explicit progress labels', () => {
    expect(qualityJobPresentation('QUEUED').label).toBe('排队中')
    expect(qualityJobPresentation('RUNNING').label).toBe('评估中')
    expect(qualityJobPresentation('FAILED').variant).toBe('error')
  })
})
