import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { applySchoolDirectoryStatusMigration, inspectSchoolDirectoryStatusMigration } from '../src/modules/maintenance/application/school-directory-status-migration.service'
import { updateSchoolDirectoryStatus } from '../src/modules/organization/application/school-directory-governance.service'

async function createSchool(id: string, name: string) {
  const organizationId = `org-${id}`
  await prisma.organization.create({ data: { id: organizationId, name, type: 'school', status: 'active' } })
  return prisma.school.create({ data: { id, name, organizationId, status: 'active' } })
}

describe('school directory governance', () => {
  it('quarantines historical test schools without deleting their references', async () => {
    const legacy = await createSchool(`school-test-${crypto.randomUUID()}`, 'School 1')
    const canonical = await createSchool('school-default', '第一中学')
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), username: `legacy-member-${crypto.randomUUID()}`, passwordHash: 'test', role: 'user' } })
    await prisma.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId: legacy.organizationId!, userId: user.id, memberRole: 'student', relationType: 'enrolled', status: 'active' } })

    const check = await inspectSchoolDirectoryStatusMigration()
    expect(check.proposed.legacy.count).toBe(1)
    expect(check.proposed.verified.count).toBe(1)
    expect(check.legacyReferences.memberships).toBe(1)

    const applied = await applySchoolDirectoryStatusMigration(check.reportHash, user.id)
    expect(applied.legacyCount).toBe(1)
    expect((await prisma.school.findUniqueOrThrow({ where: { id: legacy.id } })).directoryStatus).toBe('legacy')
    expect((await prisma.school.findUniqueOrThrow({ where: { id: canonical.id } })).directoryStatus).toBe('verified')
    expect(await prisma.organizationMembership.count({ where: { organizationId: legacy.organizationId! } })).toBe(1)

    const repeated = await inspectSchoolDirectoryStatusMigration()
    const second = await applySchoolDirectoryStatusMigration(repeated.reportHash, user.id)
    expect(Object.values(second.changed).reduce((sum, value) => sum + value, 0)).toBe(0)
  })

  it('requires legacy schools to return through pending and preserves global formal-name uniqueness', async () => {
    const legacy = await createSchool(`school-temp-${crypto.randomUUID()}`, '同名学校')
    await prisma.school.update({ where: { id: legacy.id }, data: { directoryStatus: 'legacy', nameKey: null } })
    const official = await createSchool(crypto.randomUUID(), '同名学校')
    await prisma.school.update({ where: { id: official.id }, data: { directoryStatus: 'verified', nameKey: '同名学校' } })

    const isolated = await prisma.school.findUniqueOrThrow({ where: { id: legacy.id } })
    await expect(updateSchoolDirectoryStatus({ organizationId: legacy.organizationId!, actorUserId: official.id, status: 'verified', reason: '直接恢复', expectedUpdatedAt: isolated.updatedAt.toISOString(), confirmLegacy: false })).rejects.toMatchObject({ code: 'SCHOOL_DIRECTORY_TRANSITION_INVALID' })
    const current = await prisma.school.findUniqueOrThrow({ where: { id: legacy.id } })
    await expect(updateSchoolDirectoryStatus({ organizationId: legacy.organizationId!, actorUserId: official.id, status: 'pending', reason: '恢复审核', expectedUpdatedAt: current.updatedAt.toISOString(), confirmLegacy: false })).rejects.toMatchObject({ code: 'SCHOOL_NAME_CONFLICT' })
    expect((await prisma.school.findUniqueOrThrow({ where: { id: legacy.id } })).directoryStatus).toBe('legacy')
  })
})
