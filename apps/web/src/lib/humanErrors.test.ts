import { describe, expect, it } from 'vitest'
import { humanErrorMessage, publicErrorMessage } from './humanErrors'

describe('human error presentation', () => {
  it('translates known technical errors into an action and consequence', () => {
    expect(humanErrorMessage('TEST_SET_REVISION_FROZEN')).toContain('不能再更换')
    expect(humanErrorMessage('VALIDATOR_NOT_ACTIVE')).toContain('输入检查程序')
  })

  it('does not expose stack traces or ORM errors', () => {
    expect(humanErrorMessage(undefined, 'Prisma Unique constraint failed', 500)).toBe('服务暂时不可用，请稍后重试。')
  })

  it('only exposes explicitly sanitized user messages', () => {
    expect(publicErrorMessage({ userMessage: '请重新登录。' }, '操作失败')).toBe('请重新登录。')
    expect(publicErrorMessage({ code: 'FORBIDDEN', message: 'raw policy failure' }, '操作失败')).toBe('你没有权限完成这项操作。')
    expect(publicErrorMessage(new Error('Prisma query failed'), '内容加载失败')).toBe('内容加载失败')
  })

  it('fails closed for unknown server and concurrency messages', () => {
    expect(humanErrorMessage(undefined, 'expectedRevision mismatch', 409)).toBe('操作未完成，请检查后重试。')
    expect(humanErrorMessage(undefined, 'snapshot frozen', 400)).toBe('操作未完成，请检查后重试。')
    expect(humanErrorMessage('FUTURE_INTERNAL_VALUE', 'canonical problem unavailable', 400))
      .toBe('操作未完成，请检查后重试。')
  })
})
