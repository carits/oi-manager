import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  capabilitiesForOrganizationRole,
  hasOrganizationCapability,
  organizationCapabilityScope,
  organizationRoleFromRoleKeys,
  requestHasOrganizationCapability,
  resolveOrganizationAuthorization,
} from '../src/modules/authorization/capabilities'
import { ORGANIZATION_BASE_ROLE_KEYS, syncOrganizationMembershipBaseRole } from '../src/modules/authorization/membership-role-assignment'
import { prisma } from '../src/prisma'
import { createTestSchool, createTestUser } from './helpers/testUser'
import { canModifyProblem, canViewProblem } from '../src/modules/problem/problem.access'
import { authorize, getAccountRole } from '../src/middleware/auth'

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
      'team.create',
      'problem.create',
      'problem.manage',
    ]))
    expect(capabilitiesForOrganizationRole('teacher')).not.toContain('organization.settings')
    expect(capabilitiesForOrganizationRole('school_principal')).toEqual(expect.arrayContaining([
      'membership.view.teachers',
      'assignment.create',
      'contest.manage',
      'membership.manage.teachers',
      'organization.settings',
      'team.create',
      'problem.create',
      'problem.manage',
    ]))
  })

  it('builds request identity and authorization only from normalized facts', () => {
    expect(organizationRoleFromRoleKeys(['teacher', 'training_coach'])).toBe('teacher')
    expect(organizationRoleFromRoleKeys(['teacher', 'school_principal'])).toBeNull()
    expect(organizationRoleFromRoleKeys([])).toBeNull()
    expect(requestHasOrganizationCapability({ organizationCapabilities: ['problem.manage'] }, 'problem.manage')).toBe(true)
    expect(requestHasOrganizationCapability({ organizationCapabilities: [] }, 'problem.manage')).toBe(false)

    const authSource = fs.readFileSync(path.resolve(__dirname, '../src/middleware/auth.ts'), 'utf8')
    expect(authSource).toContain('resolveOrganizationAuthorization')
    expect(authSource).toContain('organizationRoleFromRoleKeys')
    expect(authSource).not.toContain('decoded.role = membership.memberRole')
    expect(authSource).not.toMatch(/select:\s*\{[\s\S]{0,120}memberRole:\s*true/)
  })

  it('keeps global account authorization separate from the current organization role', () => {
    const organizationPrincipal = {
      userId: 'member-1', username: 'principal', role: 'school_principal', accountRole: 'user',
      organizationId: 'org-1', organizationRole: 'school_principal',
    } as any
    expect(getAccountRole(organizationPrincipal)).toBe('user')

    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const next = vi.fn()
    authorize('super_admin')({ user: organizationPrincipal } as any, { status, json } as any, next)
    expect(status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()

    const platformAdmin = { ...organizationPrincipal, role: 'platform_admin', accountRole: 'platform_admin' }
    authorize('platform_admin')({ user: platformAdmin } as any, { status, json } as any, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('keeps persisted session claims account-only', () => {
    const sharedSource = fs.readFileSync(path.resolve(__dirname, '../../../packages/shared/src/index.ts'), 'utf8')
    const authRouteSource = fs.readFileSync(path.resolve(__dirname, '../src/routes/auth.ts'), 'utf8')
    const sessionShape = sharedSource.match(/export interface SessionJwtPayload \{([\s\S]*?)\n\}/)?.[1] || ''

    expect(sessionShape).toContain('accountRole?: AccountRole')
    expect(sessionShape).not.toMatch(/organizationId|organizationRole|organizationCapabilities|teacherId|studentId|schoolId|studentMode/)
    expect(authRouteSource).toContain('function renewablePayload(payload: SessionJwtPayload): SessionJwtPayload')
    expect(authRouteSource).toContain("role: accountRole")
    expect(authRouteSource).not.toMatch(/function renewablePayload[\s\S]{0,300}\.\.\.claims/)
  })

  it('does not let the compatibility role authorize school problem access', () => {
    const problem = { id: 'problem-1', libraryScope: 'school', organizationId: 'org-1', ownerId: 'owner-1', status: 'draft', visibility: 'private' }
    const forged = { userId: 'student-1', username: 'student', role: 'school_principal', accountRole: 'user', organizationId: 'org-1', organizationMembershipId: 'member-1', organizationRole: 'student', organizationCapabilities: ['organization.view'] } as any
    expect(canViewProblem(forged, problem)).toBe(false)
    expect(canModifyProblem(forged, problem)).toBe(false)

    const teacher = { ...forged, userId: 'owner-1', role: 'teacher', organizationRole: 'teacher', organizationCapabilities: ['organization.view', 'problem.create', 'problem.manage'] }
    expect(canModifyProblem(teacher, problem)).toBe(true)
    expect(canModifyProblem({ ...teacher, userId: 'other-teacher' }, problem)).toBe(false)

    const principal = { ...teacher, userId: 'principal-1', role: 'school_principal', organizationRole: 'school_principal' }
    expect(canModifyProblem(principal, problem)).toBe(true)
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
      '../src/modules/team-import/team-import.routes.ts',
      '../src/modules/team/team.crud.routes.ts',
      '../src/modules/team/application/team-problem-list.service.ts',
      '../src/modules/problem/problem.access.ts',
      '../src/modules/problem/application/problem-crud.service.ts',
      '../src/modules/solution/solution.service.ts',
    ]
    const forbidden = capabilitySensitiveFiles.filter(file => {
      const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
      return /manager\.memberRole|creatorMembership\.memberRole|principalMembership|memberRole:\s*\{\s*in:\s*\['teacher',\s*'school_principal'\]\s*\}|memberRole:\s*'school_principal'/.test(source)
    })
    expect(forbidden).toEqual([])

    const roleAuthorized = capabilitySensitiveFiles.filter(file => {
      const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
      return /user\.role\s*(?:===|!==)\s*['"](?:student|teacher|school_principal)['"]|\[[^\]]*['"]teacher['"][^\]]*\]\.includes\(user\.role\)/.test(source)
    })
    expect(roleAuthorized).toEqual([])

    const permissionSource = fs.readFileSync(path.resolve(__dirname, '../src/middleware/permissions.ts'), 'utf8')
    expect(permissionSource).toContain('resolveOrganizationAuthorization')
    expect(permissionSource).toContain("organizationCapabilityScope(authorization, 'membership.manage.students')")
    const legacyRequestRoleCheck = /req\.user\?\.role\s*(?:===|!==)\s*['"](?:student|teacher|school_principal)['"]/
    expect(permissionSource).not.toMatch(legacyRequestRoleCheck)

    for (const file of [
      '../src/modules/submission/application/submission-command.service.ts',
      '../src/modules/submission/application/submission-query.service.ts',
    ]) {
      const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
      expect(source).not.toContain('context.role')
      expect(source).toContain('context.organizationRole')
    }
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

    await syncOrganizationMembershipBaseRole(prisma, membership.id, 'teacher', { source: 'authorization_test' })
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
