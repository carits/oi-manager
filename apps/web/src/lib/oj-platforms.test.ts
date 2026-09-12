import { describe, expect, it } from 'vitest'
import {
  FETCHABLE_PLATFORMS,
  OJ_PLATFORMS_NO_ALL,
  getOjProblemUrl,
  getOjPlatformLabel,
  normalizeOjPlatformKey,
} from './oj-platforms'

describe('canonical OJ platform registry', () => {
  it('contains unique canonical keys and derives the fetch list', () => {
    const keys = OJ_PLATFORMS_NO_ALL.map(platform => platform.value)
    expect(new Set(keys).size).toBe(keys.length)
    expect(FETCHABLE_PLATFORMS.map(platform => platform.value)).toContain('ojuz')
    expect(FETCHABLE_PLATFORMS.map(platform => platform.value)).not.toContain('oj.uz')
  })

  it('normalizes historical aliases for labels and problem links', () => {
    expect(normalizeOjPlatformKey('oj.uz')).toBe('ojuz')
    expect(normalizeOjPlatformKey('LOJ')).toBe('libreoj')
    expect(getOjPlatformLabel('oj.uz')).toBe('oj.uz')
    expect(getOjProblemUrl('oj.uz', 'JOI20_ho_t1')).toBe('https://oj.uz/problem/view/JOI20_ho_t1')
    expect(getOjProblemUrl('loj', '100')).toBe('https://loj.ac/p/100')
  })

  it('builds structured Codeforces and AtCoder links without fake fallbacks', () => {
    expect(getOjProblemUrl('codeforces', '1454E')).toBe('https://codeforces.com/problemset/problem/1454/E')
    expect(getOjProblemUrl('atcoder', 'abc300_a')).toBe('https://atcoder.jp/contests/abc300/tasks/abc300_a?lang=en')
    expect(getOjProblemUrl('unknown', '1')).toBeNull()
  })
})
