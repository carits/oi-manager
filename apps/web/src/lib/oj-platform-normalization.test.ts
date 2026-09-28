import { describe, expect, it } from 'vitest'
import {
  OJ_PLATFORM_REGISTRY,
  buildOjPlatformIdentifierIndex,
  getOjPlatform,
  getOjPlatformLabel,
  getOjProblemUrl,
  normalizeOjPlatformKey,
} from '@oi-manager/shared'

describe('OJ names at the data boundary', () => {
  it.each(OJ_PLATFORM_REGISTRY)('maps every registered name for $key to its storage key', definition => {
    for (const name of [definition.key, definition.displayName, ...definition.aliases]) {
      expect(normalizeOjPlatformKey(` ${name.toUpperCase()} `)).toBe(definition.key)
    }
    expect(normalizeOjPlatformKey(normalizeOjPlatformKey(definition.key)!)).toBe(definition.key)
    expect(definition.key).toMatch(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/)
  })

  it.each([
    ['洛谷', 'luogu'], ['牛客', 'nowcoder'], ['计蒜客', 'jisuanke'],
    ['代码源OJ', 'codefun'], ['OpenJudge 百炼', 'openj_bailian'],
    ['Carits平台', 'carits'], ['CodeForces', 'codeforces'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeOjPlatformKey(input)).toBe(expected)
  })

  it('rejects unregistered guesses without a default platform', () => {
    for (const input of ['CF', '洛', '牛', '', '  ', 'unknown-platform']) {
      expect(normalizeOjPlatformKey(input)).toBeNull()
    }
    expect(getOjPlatform(null)).toBeUndefined()
    expect(getOjPlatform(undefined)).toBeUndefined()
    expect(getOjPlatform(123 as unknown as string)).toBeUndefined()
  })

  it('does not change problem-number case or leading zeroes', () => {
    expect(getOjProblemUrl('洛谷', ' P1001 ')).toBe('https://www.luogu.com.cn/problem/P1001')
    expect(getOjProblemUrl('洛谷', ' p1001 ')).toBe('https://www.luogu.com.cn/problem/p1001')
    expect(getOjProblemUrl('HDU', '00123')).toContain('pid=00123')
    expect(getOjPlatformLabel('luogu')).toBe('洛谷')
  })

  it('does not confuse an installed fetch adapter with a registered identity', () => {
    expect(getOjPlatform('UVA')?.fetch.supported).toBe(false)
    expect(normalizeOjPlatformKey('UVA')).toBe('uva')
    expect(normalizeOjPlatformKey('UOJ')).toBe('uoj')
    expect(normalizeOjPlatformKey('UniversalOJ')).toBe('universaloj')
  })

  it('fails fast on ambiguous names or invalid registry definitions', () => {
    const first = OJ_PLATFORM_REGISTRY[0]
    const second = OJ_PLATFORM_REGISTRY[1]
    expect(() => buildOjPlatformIdentifierIndex([first, first])).toThrow(/duplicate/)
    expect(() => buildOjPlatformIdentifierIndex([{ ...first, key: 'Carits' }])).toThrow(/Invalid/)
    expect(() => buildOjPlatformIdentifierIndex([{ ...first, displayName: ' ' }])).toThrow(/Empty/)
    expect(() => buildOjPlatformIdentifierIndex([first, { ...second, aliases: ['CARITS'] }])).toThrow(/Ambiguous/)
    expect(() => buildOjPlatformIdentifierIndex([first, { ...second, displayName: first.displayName }])).toThrow(/Ambiguous/)
  })
})
