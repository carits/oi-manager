import { describe, expect, it } from 'vitest'
import { getLanguageLabel, judgeFailureSummary, judgeResultLabel, JUDGE_RESULT_OPTIONS, LANGUAGE_OPTIONS } from './judge-constants'

describe('judge filter options', () => {
  it('uses explicit localized labels for the unfiltered state', () => {
    expect(JUDGE_RESULT_OPTIONS[0]).toEqual({ value: '', label: '全部结果' })
    expect(LANGUAGE_OPTIONS[0]).toEqual({ value: '', label: '全部语言' })
  })

  it('keeps queued, judging and output-limit results available to every submission list', () => {
    expect(JUDGE_RESULT_OPTIONS.map(option => option.value)).toEqual(expect.arrayContaining([
      'queuing',
      'judging',
      'ole',
    ]))
  })

  it('does not expose unknown result or language protocol values', () => {
    const internal = 'FUTURE_INTERNAL_VALUE'
    expect(judgeResultLabel(internal)).not.toContain(internal)
    expect(getLanguageLabel(internal)).not.toContain(internal)
    expect(judgeFailureSummary(internal)).not.toContain(internal)
  })
})
