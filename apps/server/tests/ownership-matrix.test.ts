import { beforeEach, describe, expect, it } from 'vitest'
import { canModifyProblem, canUseProblem, canViewProblem } from '../src/modules/problem/problem.access'
import {
  canAccessContest,
  canManageContest,
  isTeamAdmin,
  isTeamMember,
} from '../src/modules/contest/contest.helpers'
import { prisma } from '../src/prisma'
import { createTestSchool, createTestTeam, createTestUser } from './helpers/testUser'

describe('resource ownership permission matrix', () => {
  let schoolA: Awaited<ReturnType<typeof createTestSchool>>
  let schoolB: Awaited<ReturnType<typeof createTestSchool>>
  let principal: Awaited<ReturnType<typeof createTestUser>>
  let creator: Awaited<ReturnType<typeof createTestUser>>
  let otherTeacher: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let outsider: Awaited<ReturnType<typeof createTestUser>>
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>
  let platformAdmin: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    schoolA = await createTestSchool({ name: 'Ownership school A' })
    schoolB = await createTestSchool({ name: 'Ownership school B' })
    principal = await createTestUser({ organization: { role: 'school_principal', organizationId: schoolA.organizationId! } })
    creator = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.organizationId! } })
    otherTeacher = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.organizationId! } })
    student = await createTestUser({ organization: { role: 'student', organizationId: schoolA.organizationId! } })
    outsider = await createTestUser({ organization: { role: 'teacher', organizationId: schoolB.organizationId! } })
    superAdmin = await createTestUser({ accountRole: 'super_admin' })
    platformAdmin = await createTestUser({ accountRole: 'platform_admin' })
  })

  it('separates activity participation from activity management', async () => {
    const contest = await prisma.contest.create({
      data: {
        id: crypto.randomUUID(),
        title: 'Ownership contest',
        type: 'judged',
        format: 'icpc',
        scope: 'campus',
        organizationId: schoolA.organizationId!,
        createdBy: creator.user.id,
        status: 'upcoming',
        contestDate: new Date(Date.now() + 60_000),
        startAt: new Date(Date.now() + 60_000),
        endAt: new Date(Date.now() + 3_600_000),
      },
    })

    await expect(canManageContest(principal.user.id, contest)).resolves.toBe(true)
    await expect(canManageContest(creator.user.id, contest)).resolves.toBe(true)
    await expect(canManageContest(otherTeacher.user.id, contest)).resolves.toBe(false)
    await expect(canManageContest(student.user.id, contest)).resolves.toBe(false)
    await expect(canManageContest(outsider.user.id, contest)).resolves.toBe(false)
    await expect(canManageContest(superAdmin.user.id, contest)).resolves.toBe(true)
    await expect(canManageContest(platformAdmin.user.id, contest)).resolves.toBe(false)

    await expect(canAccessContest(principal.user.id, contest)).resolves.toBe(true)
    await expect(canAccessContest(otherTeacher.user.id, contest)).resolves.toBe(true)
    await expect(canAccessContest(student.user.id, contest)).resolves.toBe(true)
    await expect(canAccessContest(outsider.user.id, contest)).resolves.toBe(false)
    await expect(canAccessContest(superAdmin.user.id, contest)).resolves.toBe(true)
    await expect(canAccessContest(platformAdmin.user.id, contest)).resolves.toBe(true)
  })

  it('keeps campus team management narrower than global read access', async () => {
    const team = await createTestTeam({ organizationId: schoolA.organizationId!, ownerId: creator.user.id })
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: student.user.id,
        userType: 'student',
        role: 'member',
        status: 'active',
        joinedAt: new Date(),
      },
    })

    await expect(isTeamAdmin(creator.user.id, team.id)).resolves.toBe(true)
    await expect(isTeamAdmin(student.user.id, team.id)).resolves.toBe(false)
    await expect(isTeamAdmin(outsider.user.id, team.id)).resolves.toBe(false)
    await expect(isTeamAdmin(superAdmin.user.id, team.id)).resolves.toBe(true)
    await expect(isTeamAdmin(platformAdmin.user.id, team.id)).resolves.toBe(false)

    await expect(isTeamMember(creator.user.id, team.id)).resolves.toBe(true)
    await expect(isTeamMember(student.user.id, team.id)).resolves.toBe(true)
    await expect(isTeamMember(outsider.user.id, team.id)).resolves.toBe(false)
    await expect(isTeamMember(superAdmin.user.id, team.id)).resolves.toBe(true)
    await expect(isTeamMember(platformAdmin.user.id, team.id)).resolves.toBe(true)
  })

  it('isolates platform and school problem ownership', () => {
    const platformDraft = {
      id: 'platform-draft',
      libraryScope: 'platform',
      organizationId: null,
      ownerId: creator.user.id,
      status: 'draft',
      visibility: 'private',
    }
    const schoolDraft = {
      id: 'school-draft',
      libraryScope: 'school',
      organizationId: schoolA.organizationId!,
      ownerId: creator.user.id,
      status: 'draft',
      visibility: 'private',
    }
    const schoolPublished = { ...schoolDraft, id: 'school-published', status: 'published' }
    const user = (created: Awaited<ReturnType<typeof createTestUser>>, organizationId?: string) => {
      const organization = organizationId ? created.organization : null
      return {
        userId: created.user.id,
        username: created.user.username,
        accountRole: created.user.accountRole,
        workspaceMode: 'work' as const,
        ...(organization
          ? {
              organizationId: organization.organizationId,
              organizationMembershipId: organization.membershipId,
              organizationRole: organization.role,
              organizationCapabilities: organization.role === 'student'
                ? ['organization.view']
                : ['organization.view', 'problem.create', 'problem.manage'],
            }
          : {}),
      }
    }

    expect(canModifyProblem(user(superAdmin), platformDraft)).toBe(true)
    expect(canModifyProblem(user(platformAdmin), platformDraft)).toBe(true)
    expect(canModifyProblem(user(principal, schoolA.organizationId!), schoolDraft)).toBe(true)
    expect(canModifyProblem(user(creator, schoolA.organizationId!), schoolDraft)).toBe(true)
    expect(canModifyProblem(user(otherTeacher, schoolA.organizationId!), schoolDraft)).toBe(false)
    expect(canModifyProblem(user(outsider, schoolB.organizationId!), schoolDraft)).toBe(false)
    expect(canModifyProblem(user(superAdmin), schoolDraft)).toBe(false)
    expect(canModifyProblem(user(platformAdmin), schoolDraft)).toBe(false)

    expect(canViewProblem(user(otherTeacher, schoolA.organizationId!), schoolDraft)).toBe(false)
    expect(canViewProblem(user(otherTeacher, schoolA.organizationId!), schoolPublished)).toBe(true)
    expect(canUseProblem(user(otherTeacher, schoolA.organizationId!), schoolPublished)).toBe(true)
    expect(canViewProblem(user(outsider, schoolB.organizationId!), schoolPublished)).toBe(false)
    expect(canViewProblem(user(student, schoolA.organizationId!), schoolPublished)).toBe(false)
  })
})
