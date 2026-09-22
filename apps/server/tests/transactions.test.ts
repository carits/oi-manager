import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestApp } from './helpers/testRequest'
import { generateTestToken } from './helpers/testToken'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'

const app = createTestApp()
const unique = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`

function tokenFor(user: Awaited<ReturnType<typeof createTestUser>>) {
  return generateTestToken({ userId: user.user.id, username: user.user.username, accountRole: user.user.accountRole })
}

describe('current transactional resource flows', () => {
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    superAdmin = await createTestUser({ accountRole: 'super_admin' })
  })


  it('creates organization, school, principal membership and profile atomically', async () => {
    const username = unique('principal')
    const response = await request(app)
      .post('/api/platform/organizations')
      .set('Cookie', `oi_session=${tokenFor(superAdmin)}`)
      .send({ name: 'Transactional School', username, password: 'password123', teacherName: 'Principal' })
    expect(response.status).toBe(201)

    const organizationId = response.body.data.organizationId as string
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        School: true,
        Membership: {
          include: { User: true, TeacherProfile: true },
        },
      },
    })
    expect(organization).toMatchObject({ name: 'Transactional School', type: 'school', status: 'active' })
    expect(organization?.School?.currentPrincipalMembershipId).toBe(organization?.Membership[0].id)
    expect(organization?.Membership[0]).toMatchObject({ memberRole: 'school_principal', status: 'active' })
    expect(organization?.Membership[0].User.username).toBe(username)
    expect(organization?.Membership[0].TeacherProfile?.name).toBe('Principal')
  })

  it('rejects duplicate principal usernames without creating a partial organization', async () => {
    const existing = await createTestUser({ organization: { role: 'teacher' } })
    const name = unique('No Partial School')
    const response = await request(app)
      .post('/api/platform/organizations')
      .set('Cookie', `oi_session=${tokenFor(superAdmin)}`)
      .send({ name, username: existing.user.username, password: 'password123', teacherName: 'Principal' })
    expect(response.status).toBe(409)
    expect(await prisma.organization.count({ where: { name } })).toBe(0)
  })

  it('requires all school creation fields and a super-admin caller', async () => {
    const incomplete = await request(app)
      .post('/api/platform/organizations')
      .set('Cookie', `oi_session=${tokenFor(superAdmin)}`)
      .send({ name: 'Missing principal' })
    expect(incomplete.status).toBe(422)

    const platformAdmin = await createTestUser({ accountRole: 'platform_admin' })
    const denied = await request(app)
      .post('/api/platform/organizations')
      .set('Cookie', `oi_session=${tokenFor(platformAdmin)}`)
      .send({ name: 'Denied', username: unique('principal'), teacherName: 'Denied' })
    expect(denied.status).toBe(403)
  })

  it('creates a student user, membership and profile in the active organization', async () => {
    const { school } = await createTestSchoolWithPrincipal()
    const teacher = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
    const username = unique('student')
    const response = await request(app)
      .post(`/api/organizations/${school.organizationId}/members/students`)
      .set('Cookie', `oi_session=${tokenFor(teacher)}`)
      .set('x-oi-organization-id', school.organizationId!)
      .send({ username, password: 'password123', name: 'Transactional Student' })
    expect(response.status).toBe(200)

    const profile = await prisma.organizationStudentProfile.findUnique({
      where: { id: response.body.data.id },
      include: { Membership: { include: { User: true } } },
    })
    expect(profile?.name).toBe('Transactional Student')
    expect(profile?.Membership).toMatchObject({ organizationId: school.organizationId, memberRole: 'student', status: 'active' })
    expect(profile?.Membership.User.username).toBe(username)
  })

  it('rejects cross-organization student creation before writing a user', async () => {
    const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
    const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
    const teacher = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.organizationId! } })
    const username = unique('cross_student')
    const response = await request(app)
      .post(`/api/organizations/${schoolB.organizationId}/members/students`)
      .set('Cookie', `oi_session=${tokenFor(teacher)}`)
      .set('x-oi-organization-id', schoolA.organizationId!)
      .send({ username, password: 'password123', name: 'Cross Student' })
    expect(response.status).toBe(403)
    expect(await prisma.user.findUnique({ where: { username } })).toBeNull()
  })

  it('transfers the principal membership and demotes the previous principal atomically', async () => {
    const { school } = await createTestSchoolWithPrincipal()
    const next = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
    const nextMembership = await prisma.organizationMembership.findFirstOrThrow({
      where: { organizationId: school.organizationId!, userId: next.user.id, status: 'active' },
    })
    const oldPrincipalId = (await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).currentPrincipalMembershipId!

    const response = await request(app)
      .put(`/api/platform/organizations/${school.organizationId}/principal`)
      .set('Cookie', `oi_session=${tokenFor(superAdmin)}`)
      .send({ membershipId: nextMembership.id })
    expect(response.status).toBe(200)

    const [updatedSchool, oldPrincipal, newPrincipal] = await Promise.all([
      prisma.school.findUniqueOrThrow({ where: { id: school.id } }),
      prisma.organizationMembership.findUniqueOrThrow({ where: { id: oldPrincipalId } }),
      prisma.organizationMembership.findUniqueOrThrow({ where: { id: nextMembership.id } }),
    ])
    expect(updatedSchool.currentPrincipalMembershipId).toBe(nextMembership.id)
    expect(oldPrincipal.memberRole).toBe('teacher')
    expect(newPrincipal.memberRole).toBe('school_principal')
  })

  it('updates account status atomically', async () => {
    const target = await createTestUser({ organization: { role: 'teacher' } })
    const response = await request(app)
      .put(`/api/users/${target.user.id}/status`)
      .set('Cookie', `oi_session=${tokenFor(superAdmin)}`)
      .send({ status: 'disabled' })
    expect(response.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } })).status).toBe('disabled')
  })

  it('creates a campus team with an active owner in the request organization', async () => {
    const { school } = await createTestSchoolWithPrincipal()
    const teacher = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
    const response = await request(app)
      .post('/api/teams')
      .set('Cookie', `oi_session=${tokenFor(teacher)}`)
      .set('x-oi-organization-id', school.organizationId!)
      .send({ id: unique('team'), name: unique('Team'), isPublic: true })
    expect(response.status).toBe(200)

    const team = await prisma.team.findUniqueOrThrow({
      where: { id: response.body.data.id },
      include: { TeamMember: true },
    })
    expect(team).toMatchObject({ organizationId: school.organizationId, scope: 'campus' })
    expect(team.TeamMember).toContainEqual(expect.objectContaining({ userId: teacher.user.id, role: 'owner', status: 'active' }))
  })
})
