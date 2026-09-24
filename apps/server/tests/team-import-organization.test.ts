import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'

const app = createTestApp()

describe('team import organization isolation', () => {
  it('keeps teams, batches, preview, result, history and confirm inside the active organization', async () => {
    const schoolA = await createTestSchoolWithPrincipal('导入学校A')
    const schoolB = await createTestSchoolWithPrincipal('导入学校B')
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: schoolA.principal.userId } })

    const membershipBId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: membershipBId,
        organizationId: schoolB.school.organizationId!,
        userId: actor.id,
        memberRole: 'school_principal',
        relationType: 'employee',
        status: 'active',
        joinedAt: new Date(),
        RoleAssignments: { create: { id: crypto.randomUUID(), roleKey: 'school_principal', source: 'test_fixture' } },
      },
    })
    await prisma.organizationTeacherProfile.create({
      data: { id: crypto.randomUUID(), membershipId: membershipBId, name: '跨校导入负责人', status: 'active' },
    })

    const teamA = await createTestTeam({
      organizationId: schoolA.school.organizationId!,
      ownerId: actor.id,
      ownerType: 'teacher',
      name: '导入团队A',
    })
    const teamB = await createTestTeam({
      organizationId: schoolB.school.organizationId!,
      ownerId: actor.id,
      ownerType: 'teacher',
      name: '导入团队B',
    })

    const batchB = await prisma.teamMemberImportBatch.create({
      data: {
        id: crypto.randomUUID(),
        teamId: teamB.id,
        organizationId: schoolB.school.organizationId!,
        operatorId: actor.id,
        platform: 'vjudge',
        totalCount: 1,
        status: 'pending',
        rawInput: 'student_b',
      },
    })
    await prisma.teamMemberImportItem.create({
      data: {
        id: crypto.randomUUID(),
        batchId: batchB.id,
        lineNumber: 1,
        rawUsername: 'student_b',
        parsedUsername: 'student_b',
        candidateDisplayName: '学生B',
        matchType: 'new_member',
        matchStatus: 'pending',
      },
    })

    const token = generateTestToken({ userId: actor.id, username: actor.username, accountRole: actor.accountRole })
    const requestA = createAuthenticatedRequest(app, token, { organizationId: schoolA.school.organizationId! })
    const requestB = createAuthenticatedRequest(app, token, { organizationId: schoolB.school.organizationId! })

    const teamsA = await requestA.get('/api/team-import/teams')
    expect(teamsA.status).toBe(200)
    expect(teamsA.body.data.map((team: any) => team.id)).toContain(teamA.id)
    expect(teamsA.body.data.map((team: any) => team.id)).not.toContain(teamB.id)

    const previewFromA = await requestA.get(`/api/team-import/${batchB.id}/preview`)
    expect(previewFromA.status).toBe(404)

    const resultFromA = await requestA.get(`/api/team-import/${batchB.id}/result`)
    expect(resultFromA.status).toBe(404)

    const historyFromA = await requestA.get(`/api/team-import/history/${teamB.id}`)
    expect([403, 404]).toContain(historyFromA.status)

    const confirmFromA = await requestA.post(`/api/team-import/${batchB.id}/confirm`).send({
      items: [{ lineNumber: 1, action: 'skip' }],
    })
    expect(confirmFromA.status).toBe(404)
    expect((await prisma.teamMemberImportBatch.findUniqueOrThrow({ where: { id: batchB.id } })).status).toBe('pending')

    const previewFromB = await requestB.get(`/api/team-import/${batchB.id}/preview`)
    expect(previewFromB.status).toBe(200)

    const historyFromB = await requestB.get(`/api/team-import/history/${teamB.id}`)
    expect(historyFromB.status).toBe(200)
    expect(historyFromB.body.data.map((batch: any) => batch.id)).toContain(batchB.id)
  })

  it('fails closed for legacy batches without an organization mapping', async () => {
    const school = await createTestSchoolWithPrincipal('导入旧批次学校')
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: school.principal.userId } })
    const legacy = await prisma.teamMemberImportBatch.create({
      data: {
        id: crypto.randomUUID(),
        teamId: null,
        organizationId: null,
        operatorId: actor.id,
        platform: 'luogu',
        totalCount: 0,
        status: 'pending',
      },
    })
    const token = generateTestToken({ userId: actor.id, username: actor.username, accountRole: actor.accountRole })
    const response = await createAuthenticatedRequest(app, token, { organizationId: school.school.organizationId! })
      .get(`/api/team-import/${legacy.id}/preview`)
    expect(response.status).toBe(404)
  })
})
