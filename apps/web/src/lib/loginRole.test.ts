import { describe, expect, it } from 'vitest'
import { normalizeLoginRole } from './loginRole'

describe('normalizeLoginRole', () => {
  it('normalizes administrator aliases', () => {
    expect(normalizeLoginRole('admin')).toBe('admin')
    expect(normalizeLoginRole('platform-admin')).toBe('admin')
    expect(normalizeLoginRole('platform_admin')).toBe('admin')
    expect(normalizeLoginRole('super_admin')).toBe('admin')
  })

  it('preserves student and teacher entry points', () => {
    expect(normalizeLoginRole('student')).toBe('student')
    expect(normalizeLoginRole('teacher')).toBe('teacher')
    expect(normalizeLoginRole('unknown')).toBe('teacher')
  })
})
