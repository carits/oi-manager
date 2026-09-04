import crypto from 'crypto'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { organizationJoinRouter } from '../src/modules/organization-join/organization-join.routes'
import { notificationRouter } from '../src/modules/notification/notification.routes'
import { authenticate } from '../src/middleware/auth'
import { applyOrganizationJoinMigration, inspectOrganizationJoinMigration } from '../src/modules/maintenance/application/organization-join-migration.service'
import { prisma } from '../src/prisma'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'

const app = express()
app.use(express.json())
app.use('/api', organizationJoinRouter)
app.use('/api/notifications', authenticate, notificationRouter)

let organizationId = '', principalToken = '', teacherToken = '', applicantToken = '', applicantId = '', teacherMembershipId = ''

beforeEach(async () => {
  const fixture = await createTestSchoolWithPrincipal('组织加入测试学校')
  organizationId = fixture.school.organizationId!
  await prisma.organization.update({ where: { id: organizationId }, data: { joinPolicy: 'approval' } })
  const principal = await prisma.user.findUniqueOrThrow({ where: { id: fixture.principal.userId } })
  principalToken = generateTestToken({ userId: principal.id, username: principal.username, role: 'school_principal' })
  const teacher = await createTestUser({ role: 'teacher', schoolId: fixture.school.id, username: `join-teacher-${crypto.randomUUID()}` })
  teacherMembershipId = (await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: teacher.user.id } } })).id
  teacherToken = generateTestToken({ userId: teacher.user.id, username: teacher.user.username, role: 'teacher' })
  const applicant = await prisma.user.create({ data: { id: crypto.randomUUID(), username: `join-applicant-${crypto.randomUUID()}`, passwordHash: 'test', role: 'user' } })
  await prisma.personalProfile.create({ data: { userId: applicant.id } })
  applicantId = applicant.id
  applicantToken = generateTestToken({ userId: applicant.id, username: applicant.username, role: 'user', workspaceMode: 'personal' })
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('organization join workflow', () => {
  it('accepts a student application and makes a teacher the assigned teacher', async () => {
    const created = await request(app).post('/api/organization-join-applications').set(auth(applicantToken)).send({ organizationId, requestedRole: 'student', requestedRelationType: 'enrolled', realName: '申请学生', profileData: { enrollmentYear: 2026 } })
    expect(created.status).toBe(201)

    const approved = await request(app).post(`/api/organizations/${organizationId}/join-applications/${created.body.data.id}/approve`).set(auth(teacherToken)).set('X-OI-Organization-ID', organizationId).send({ profile: { name: '申请学生', enrollmentYear: 2026 } })
    expect(approved.status).toBe(200)
    const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: applicantId } }, include: { StudentProfile: true } })
    expect(membership.status).toBe('active')
    expect(membership.StudentProfile?.headTeacherMembershipId).toBe(teacherMembershipId)
  })

  it('does not allow a teacher to approve a teacher application', async () => {
    const created = await request(app).post('/api/organization-join-applications').set(auth(applicantToken)).send({ organizationId, requestedRole: 'teacher', requestedRelationType: 'employee', realName: '申请教师' })
    const response = await request(app).post(`/api/organizations/${organizationId}/join-applications/${created.body.data.id}/approve`).set(auth(teacherToken)).set('X-OI-Organization-ID', organizationId).send({})
    expect(response.status).toBe(403)
  })

  it('delivers invitations as account notifications and activates membership on accept', async () => {
    const applicant = await prisma.user.findUniqueOrThrow({ where: { id: applicantId } })
    const invitation = await request(app).post(`/api/organizations/${organizationId}/invitations`).set(auth(principalToken)).set('X-OI-Organization-ID', organizationId).send({ username: applicant.username, memberRole: 'student', relationType: 'enrolled' })
    expect(invitation.status).toBe(201)

    const notifications = await request(app).get('/api/notifications').set(auth(applicantToken))
    expect(notifications.body.data.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'organization_invitation', actionable: true })]))

    const accepted = await request(app).post(`/api/organization-invitations/${invitation.body.data.id}/accept`).set(auth(applicantToken))
    expect(accepted.status).toBe(200)
    expect((await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: applicantId } } })).status).toBe('active')
  })

  it('keeps disabled membership blocked and prevents duplicate pending applications', async () => {
    const first = await request(app).post('/api/organization-join-applications').set(auth(applicantToken)).send({ organizationId, requestedRole: 'student', realName: '申请学生' })
    expect(first.status).toBe(201)
    const duplicate = await request(app).post('/api/organization-join-applications').set(auth(applicantToken)).send({ organizationId, requestedRole: 'student', realName: '申请学生' })
    expect(duplicate.status).toBe(409)

    await request(app).post(`/api/organizations/${organizationId}/join-applications/${first.body.data.id}/approve`).set(auth(principalToken)).set('X-OI-Organization-ID', organizationId).send({})
    await prisma.organizationMembership.update({ where: { organizationId_userId: { organizationId, userId: applicantId } }, data: { status: 'disabled' } })
    const reapplied = await request(app).post('/api/organization-join-applications').set(auth(applicantToken)).send({ organizationId, requestedRole: 'student', realName: '申请学生' })
    expect(reapplied.status).toBe(409)
    expect(reapplied.body.code).toBe('ORGANIZATION_MEMBERSHIP_DISABLED')
  })

  it('migrates legacy pending memberships to invitations idempotently', async () => {
    const principalMembership = await prisma.organizationMembership.findFirstOrThrow({
      where: { organizationId, memberRole: 'school_principal', status: 'active' },
    })
    const legacyId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: legacyId,
        organizationId,
        userId: applicantId,
        memberRole: 'student',
        relationType: 'school_student',
        status: 'pending',
        invitedBy: principalMembership.userId,
      },
    })

    const check = await inspectOrganizationJoinMigration()
    expect(check.legacyInvitations).toBe(1)
    expect(check.migratableInvitations).toBe(1)

    const first = await applyOrganizationJoinMigration()
    const second = await applyOrganizationJoinMigration()
    expect(first.invitationsMigrated).toBe(1)
    expect(first.relationsNormalized).toBeGreaterThanOrEqual(1)
    expect(second.invitationsMigrated).toBe(0)
    expect(second.relationsNormalized).toBe(0)

    const invitation = await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: legacyId } })
    expect(invitation.status).toBe('pending')
    expect(invitation.relationType).toBe('enrolled')
    expect(invitation.invitedByMembershipId).toBe(principalMembership.id)
  })
})
