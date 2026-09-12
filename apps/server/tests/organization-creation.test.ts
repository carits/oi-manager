import crypto from 'crypto'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { organizationCreationRouter } from '../src/modules/organization-creation/organization-creation.routes'
import { prisma } from '../src/prisma'
import { generateTestToken } from './helpers/testToken'
import { applySchoolNameKeyMigration, inspectSchoolNameKeyMigration } from '../src/modules/maintenance/application/school-name-key-migration.service'

const app = express()
app.use(express.json())
app.use('/api', organizationCreationRouter)

let applicantId = '', applicantToken = '', superAdminToken = '', platformAdminToken = ''
const auth = (token:string) => ({ Authorization:`Bearer ${token}` })
const payload = (name=`测试学校 ${crypto.randomUUID()}`) => ({
  organizationType:'school', name, shortName:'测试学校', schoolType:'高中', schoolNature:'公办', educationSystem:'6-3-3',
  region:'湖南省/长沙市/岳麓区', applicantRealName:'申请人', applicantTitle:'信息教师', description:'用于本校信息学竞赛课程、日常训练与校内测试管理。', evidenceNote:'可以由学校行政人员核验。',
})

beforeEach(async () => {
  const applicant = await prisma.user.create({ data:{ id:crypto.randomUUID(), username:`creation-user-${crypto.randomUUID()}`, passwordHash:'test', role:'user', status:'active' } })
  await prisma.personalProfile.create({ data:{ userId:applicant.id } })
  applicantId=applicant.id; applicantToken=generateTestToken({userId:applicant.id,username:applicant.username,role:'user',workspaceMode:'personal'})
  const admin = await prisma.user.create({ data:{ id:crypto.randomUUID(), username:`creation-admin-${crypto.randomUUID()}`, passwordHash:'test', role:'super_admin', status:'active' } })
  superAdminToken=generateTestToken({userId:admin.id,username:admin.username,role:'super_admin'})
  const platformAdmin = await prisma.user.create({ data:{ id:crypto.randomUUID(), username:`creation-platform-${crypto.randomUUID()}`, passwordHash:'test', role:'platform_admin', status:'active' } })
  platformAdminToken=generateTestToken({userId:platformAdmin.id,username:platformAdmin.username,role:'platform_admin'})
})

describe('organization creation applications', () => {
  it('creates an application and atomically promotes the applicant to principal without changing global role', async () => {
    const created=await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload('Ａ　示例学校'))
    expect(created.status).toBe(201)
    const mine=await request(app).get('/api/me/organization-creation-applications').set(auth(applicantToken))
    expect(mine.body.data.items).toEqual([expect.objectContaining({id:created.body.data.id,status:'pending'})])
    const approved=await request(app).post(`/api/platform/organization-creation-applications/${created.body.data.id}/approve`).set(auth(superAdminToken)).send({decisionMessage:'资料齐全'})
    expect(approved.status).toBe(200)
    const application=await prisma.organizationCreationApplication.findUniqueOrThrow({where:{id:created.body.data.id}})
    expect(application.status).toBe('approved')
    const school=await prisma.school.findUniqueOrThrow({where:{organizationId:application.createdOrganizationId!}})
    expect(school.nameKey).toBe('a 示例学校')
    const membership=await prisma.organizationMembership.findUniqueOrThrow({where:{organizationId_userId:{organizationId:application.createdOrganizationId!,userId:applicantId}},include:{RoleAssignments:true}})
    expect(membership).toMatchObject({memberRole:'school_principal',relationType:'employee',status:'active'})
    expect(membership.RoleAssignments.map(item=>item.roleKey)).toEqual(['school_principal'])
    expect((await prisma.user.findUniqueOrThrow({where:{id:applicantId}})).role).toBe('user')
    expect(await prisma.organizationTeacherProfile.count({where:{membershipId:membership.id}})).toBe(1)
    expect(await prisma.platformAuditLog.count({where:{targetId:application.id}})).toBeGreaterThanOrEqual(2)
  })

  it('enforces pending uniqueness, cancellation and same-name rejection cooldown', async () => {
    const first=await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload('冲突学校'))
    expect(first.status).toBe(201)
    expect((await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload('另一学校'))).status).toBe(409)
    expect((await request(app).post(`/api/organization-creation-applications/${first.body.data.id}/cancel`).set(auth(applicantToken)).send({})).status).toBe(200)
    const second=await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload('冲突学校'))
    expect(second.status).toBe(201)
    expect((await request(app).post(`/api/platform/organization-creation-applications/${second.body.data.id}/reject`).set(auth(superAdminToken)).send({decisionMessage:'学校名称待核实'})).status).toBe(200)
    const cooled=await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload('冲突学校'))
    expect(cooled.status).toBe(429)
    expect(cooled.body.code).toBe('ORGANIZATION_CREATION_NAME_COOLDOWN')
  })

  it('allows only super administrators to review applications', async () => {
    const created=await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload())
    expect((await request(app).get('/api/platform/organization-creation-applications').set(auth(platformAdminToken))).status).toBe(403)
    expect((await request(app).post(`/api/platform/organization-creation-applications/${created.body.data.id}/approve`).set(auth(platformAdminToken)).send({})).status).toBe(403)
    expect((await request(app).get('/api/me/organization-creation-applications').set(auth(superAdminToken))).status).toBe(403)
  })

  it('allows a legacy school principal account to apply for another school without changing its role', async () => {
    await prisma.user.update({where:{id:applicantId},data:{role:'school_principal'}})
    const principalToken=generateTestToken({userId:applicantId,username:'legacy-principal',role:'school_principal'})
    const created=await request(app).post('/api/organization-creation-applications').set(auth(principalToken)).send(payload())
    expect(created.status).toBe(201)
    expect((await prisma.user.findUniqueOrThrow({where:{id:applicantId}})).role).toBe('school_principal')
  })

  it('processes concurrent approvals only once', async () => {
    const created=await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload())
    const responses=await Promise.all([1,2].map(()=>request(app).post(`/api/platform/organization-creation-applications/${created.body.data.id}/approve`).set(auth(superAdminToken)).send({})))
    expect(responses.filter(item=>item.status===200)).toHaveLength(1)
    expect(responses.filter(item=>item.status===409)).toHaveLength(1)
    expect(await prisma.organizationMembership.count({where:{userId:applicantId,memberRole:'school_principal'}})).toBe(1)
  })

  it('checks and backfills normalized school names idempotently', async () => {
    const organization=await prisma.organization.create({data:{id:crypto.randomUUID(),name:'  演示　学校 ',type:'school'}})
    const school=await prisma.school.create({data:{id:crypto.randomUUID(),name:'  演示　学校 ',organizationId:organization.id}})
    expect((await inspectSchoolNameKeyMigration()).missing).toBeGreaterThanOrEqual(1)
    expect((await applySchoolNameKeyMigration()).updated).toBeGreaterThanOrEqual(1)
    expect((await prisma.school.findUniqueOrThrow({where:{id:school.id}})).nameKey).toBe('演示 学校')
    expect((await applySchoolNameKeyMigration()).updated).toBe(0)
  })

  it('blocks a new application that matches a legacy school without nameKey', async () => {
    const organization=await prisma.organization.create({data:{id:crypto.randomUUID(),name:'历史 学校',type:'school'}})
    await prisma.school.create({data:{id:crypto.randomUUID(),name:'ｌｅｇａｃｙ　Ｓｃｈｏｏｌ',organizationId:organization.id,nameKey:null}})
    const response=await request(app).post('/api/organization-creation-applications').set(auth(applicantToken)).send(payload('legacy school'))
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ORGANIZATION_NAME_CONFLICT')
  })
})
