import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { capabilitiesForLegacyOrganizationRole } from '../src/modules/authorization/capabilities'

describe('authorization boundary', () => {
  it('maps legacy membership roles to stable domain capabilities', () => {
    expect(capabilitiesForLegacyOrganizationRole('student')).toEqual([])
    expect(capabilitiesForLegacyOrganizationRole('teacher')).toEqual(expect.arrayContaining([
      'assignment.create',
      'assignment.manage',
      'contest.manage',
      'membership.manage.students',
    ]))
    expect(capabilitiesForLegacyOrganizationRole('teacher')).not.toContain('organization.settings')
    expect(capabilitiesForLegacyOrganizationRole('school_principal')).toEqual(expect.arrayContaining([
      'assignment.create',
      'contest.manage',
      'membership.manage.teachers',
      'organization.settings',
    ]))
  })

  it('does not let Assignment import Training authorization helpers', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/assignment/assignment.service.ts'), 'utf8')
    expect(source).not.toMatch(/modules\/training|\.\.\/training\/training\.helpers/)
    expect(source).toContain("from './assignment.policy'")
  })
})
