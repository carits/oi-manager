import { describe, expect, it } from 'vitest'
import {
  judgeProgramCopy,
  judgeProgramKindLabel,
  judgeProgramLanguageLabel,
  judgeProgramProtocolLabel,
  judgeProgramVerificationStatusLabel,
} from './judge-program-display'

describe('judge program presentation', () => {
  it('translates implementation vocabulary into product language', () => {
    expect(judgeProgramCopy('Validator reads stdin')).toBe('输入检查程序 reads 输入')
    expect(judgeProgramProtocolLabel('oj.generator/v1')).toBe('数据生成运行规则')
  })

  it('does not expose unknown internal values', () => {
    const internal = 'FUTURE_INTERNAL_VALUE'
    expect(judgeProgramKindLabel(internal)).not.toContain(internal)
    expect(judgeProgramLanguageLabel(internal)).not.toContain(internal)
    expect(judgeProgramProtocolLabel(internal)).not.toContain(internal)
    expect(judgeProgramVerificationStatusLabel(internal)).not.toContain(internal)
  })
})
