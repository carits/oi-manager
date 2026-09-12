import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { capabilitiesForOrganizationRole } from '../src/modules/authorization/capabilities'
import { ORGANIZATION_BASE_ROLE_KEYS, syncOrganizationMembershipBaseRole } from '../src/modules/authorization/membership-role-assignment'

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(target) : entry.isFile() && target.endsWith('.ts') ? [target] : []
  })
}

describe('authorization boundary', () => {
  it('maps normalized organization roles to stable domain capabilities', () => {
    expect(capabilitiesForOrganizationRole('student')).toEqual([])
    expect(capabilitiesForOrganizationRole('teacher')).toEqual(expect.arrayContaining([
      'assignment.create',
      'assignment.manage',
      'contest.manage',
      'membership.manage.students',
    ]))
    expect(capabilitiesForOrganizationRole('teacher')).not.toContain('organization.settings')
    expect(capabilitiesForOrganizationRole('school_principal')).toEqual(expect.arrayContaining([
      'assignment.create',
      'contest.manage',
      'membership.manage.teachers',
      'organization.settings',
    ]))
  })

  it('does not contain a legacy or hybrid authorization fallback', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/authorization/capabilities.ts'), 'utf8')
    expect(source).not.toContain('MEMBERSHIP_CAPABILITY_SOURCE')
    expect(source).not.toContain('legacyGranted')
    expect(source).not.toContain("roleSource === 'hybrid'")
  })

  it('updates the normalized base role without deleting additive roles', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    await syncOrganizationMembershipBaseRole({
      organizationMembershipRole: { deleteMany, createMany },
    } as any, 'membership-1', 'teacher', { source: 'test', grantedBy: 'actor-1' })
    expect(deleteMany).toHaveBeenCalledWith({ where: {
      membershipId: 'membership-1',
      roleKey: { in: ORGANIZATION_BASE_ROLE_KEYS.filter(role => role !== 'teacher') },
    } })
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ membershipId: 'membership-1', roleKey: 'teacher', source: 'test', grantedBy: 'actor-1' })],
      skipDuplicates: true,
    })
  })

  it('requires every organization membership role write path to synchronize RoleAssignments', () => {
    const root = path.resolve(__dirname, '../src')
    const offenders = sourceFiles(root).filter(file => {
      if (file.endsWith('membership-role-migration.service.ts')) return false
      const source = fs.readFileSync(file, 'utf8')
      const writesMembershipRole = /organizationMembership\.(?:create|update|updateMany)\([\s\S]*?memberRole\s*:/.test(source)
      return writesMembershipRole && !source.includes('syncOrganizationMembershipBaseRole')
    })
    expect(offenders.map(file => path.relative(root, file))).toEqual([])
  })

  it('does not let Assignment import Training authorization helpers', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/assignment/assignment.service.ts'), 'utf8')
    expect(source).not.toMatch(/modules\/training|\.\.\/training\/training\.helpers/)
    expect(source).toContain("from './assignment.policy'")
  })
})
