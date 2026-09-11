import { describe, expect, it } from 'vitest'
import { humanErrorMessage } from './humanErrors'

describe('human error presentation', () => {
  it('translates known technical errors into an action and consequence', () => {
    expect(humanErrorMessage('TEST_SET_REVISION_FROZEN')).toContain('不能再更换')
    expect(humanErrorMessage('VALIDATOR_NOT_ACTIVE')).toContain('输入校验器')
  })

  it('does not expose stack traces or ORM errors', () => {
    expect(humanErrorMessage(undefined, 'Prisma Unique constraint failed', 500)).toBe('服务暂时不可用，请稍后重试。')
  })
})
