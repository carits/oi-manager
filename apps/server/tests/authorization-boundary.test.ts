import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  capabilitiesForOrganizationRole,
  hasOrganizationCapability,
  organizationCapabilityScope,
  resolveOrganizationAuthorization,
} from '../src/modules/authorization/capabilities'
import { ORGANIZATION_BASE_ROLE_KEYS, syncOrganizationMembershipBaseRole } from '../src/modules/authorization/membership-role-assignment'
import { prisma } from '../src/prisma'
import { createTestSchool, createTestUser } from './helpers/testUser'

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(target) : entry.isFile() && target.endsWith('.ts') ? [target] : []
  })
}

describe('authorization boundary', () => {
  it('maps normalized organization roles to stable domain capabilities', () => {
    expect(capabilitiesForOrganizationRole('student')).toEqual(['organization.view'])
    expect(capabilitiesForOrganizationRole('teacher')).toEqual(expect.arrayContaining([
      'organization.view',
      'membership.view.students',
      'assignment.create',
      'assignment.manage',
      'contest.manage',
      'membership.manage.students',
    ]))
    expect(capabilitiesForOrganizationRole('teacher')).not.toContain('organization.settings')
    expect(capabilitiesForOrganizationRole('school_principal')).toEqual(expect.arrayContaining([
      'membership.view.teachers',
      'assignment.create',
      'contest.manage',
      'membership.manage.teachers',
      'organization.settings',
    ]))
  })

  it('does not authorize organization member routes or service scopes from memberRole', () => {
    const routeSource = fs.readFileSync(path.resolve(__dirname, '../src/routes/organization-members.ts'), 'utf8')
    const serviceSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/organization/application/organization-member.service.ts'), 'utf8')
    expect(routeSource).not.toMatch(/authorize\((?:'student'|'teacher'|'school_principal')/)
    expect(routeSource).toContain('resolveOrganizationAuthorization')
    expect(serviceSource).not.toContain('actor.role')

    const legacyAuthorizationBranches = sourceFiles(path.resolve(__dirname, '../src/modules/organization'))
      .filter(file => /actor\.role\s*(?:===|!==)\s*['"](?:student|teacher|school_principal)['"]/.test(fs.readFileSync(file, 'utf8')))
    expect(legacyAuthorizationBranches.map(file => path.relative(path.resolve(__dirname, '../src'), file))).toEqual([])

    const normalizedAuthorizationModules = [
      '../src/modules/organization-join/organization-join.service.ts',
      '../src/modules/assignment/assignment.service.ts',
      '../src/modules/training/application/training-crud.service.ts',
      '../src/modules/training/application/training-ranking.service.ts',
      '../src/modules/training-engine/application/training-roster.service.ts',
      '../src/modules/problem-list/application/problem-list-homework.service.ts',
      '../src/modules/data-market/data-market.service.ts',
      '../src/modules/problem/problem.candidate-evaluation.service.ts',
      '../src/modules/rating/application/contest-rating.service.ts',
    ]
    const legacyPolicySources = normalizedAuthorizationModules.filter(file => {
      const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
      return /manager\.memberRole|creatorMembership\.memberRole|principalMembership|memberRole:\s*\{\s*in:\s*\[['"]teacher['"],\s*['"]school_principal['"]\]\s*\}/.test(source)
    })
    expect(legacyPolicySources).toEqual([])

    const capabilitySensitiveFiles = [
      '../src/modules/organization-join/organization-join.service.ts',
      '../src/modules/assignment/assignment.service.ts',
      '../src/modules/problem-list/application/problem-list-homework.service.ts',
      '../src/modules/training/application/training-crud.service.ts',
      '../src/modules/training-engine/application/training-roster.service.ts',
      '../src/modules/data-market/data-market.service.ts',
      '../src/modules/problem/problem.candidate-evaluation.service.ts',
      '../src/modules/rating/application/contest-rating.service.ts',
      '../src/modules/training/application/training-ranking.service.ts',
    ]
    const forbidden = capabilitySensitiveFiles.filter(file => {
      const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
      return /manager\.memberRole|creatorMembership\.memberRole|principalMembership|memberRole:\s*\{\s*in:\s*\['teacher',\s*'school_principal'\]\s*\}|memberRole:\s*'school_principal'/.test(source)
    })
    expect(forbidden).toEqual([])
  })

  it('does not contain a legacy or hybrid authorization fallback', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/authorization/capabilities.ts'), 'utf8')
    expect(source).not.toContain('MEMBERSHIP_CAPABILITY_SOURCE')
    expect(source).not.toContain('legacyGranted')
    expect(source).not.toContain("roleSource === 'hybrid'")
  })

  it('uses normalized roles and explicit grants instead of memberRole at runtime', async () => {
    const school = await createTestSchool()
    const member = await createTestUser({ role: 'student', schoolId: school.id })
    const membership = await prisma.organizationMembership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: school.organizationId!, userId: member.user.id } },
    })

    await prisma.organizationMembership.update({ where: { id: membership.id }, data: { memberRole: 'school_principal' } })
    expect(await hasOrganizationCapability(member.user.id, school.organizationId!, 'organization.settings')).toBe(false)

    await prisma.organizationMembershipRole.create({ data: {
      id: crypto.randomUUID(), membershipId: membership.id, roleKey: 'teacher', source: 'authorization_test',
    } })
    expect(await hasOrganizationCapability(member.user.id, school.organizationId!, 'membership.manage.students')).toBe(true)
    expect(await hasOrganizationCapability(member.user.id, school.organizationId!, 'membership.manage.teachers')).toBe(false)

    await prisma.organizationMembershipCapability.create({ data: {
      id: crypto.randomUUID(), membershipId: membership.id, capabilityKey: 'membership.manage.teachers', source: 'authorization_test',
    } })
    const authorization = await resolveOrganizationAuthorization(member.user.id, school.organizationId!)
    expect(authorization?.capabilities.has('membership.manage.teachers')).toBe(true)
    expect(organizationCapabilityScope(authorization!, 'membership.manage.students')).toBe('own')
    expect(organizationCapabilityScope(authorization!, 'membership.manage.teachers')).toBe('all')
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
