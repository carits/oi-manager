import { describe, expect, it } from 'vitest'
import { parseOutputLimit, redirectCheckerCommandForSandbox } from './judge'

describe('judge output handling', () => {
  it('uses a practical default and parses explicit byte limits', () => {
    expect(parseOutputLimit(undefined)).toBe(64 * 1024 * 1024)
    expect(parseOutputLimit('64KB')).toBe(64 * 1024)
    expect(parseOutputLimit('8MB')).toBe(8 * 1024 * 1024)
    expect(parseOutputLimit(4096)).toBe(4096)
    expect(parseOutputLimit('invalid')).toBe(64 * 1024 * 1024)
  })

  it('captures checker stdout and stderr as go-judge copyOut files', () => {
    expect(redirectCheckerCommandForSandbox('./checker /w/in /w/user_out /w/answer'))
      .toBe('./checker /w/in /w/user_out /w/answer >stdout 2>stderr')
  })
})
