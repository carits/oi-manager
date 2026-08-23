import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { createTestProblemList, createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

// Historical /api/schools/:id/problem-lists behavior is intentionally retired.
// Organization-scoped behavior is covered by problem-lists and browser suites.
describe.skip('旧学校题单 API（已退役）', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let teacherUser: Awaited<ReturnType<typeof createTestUser>>
  let otherTeacherUser: Awaited<ReturnType<typeof createTestUser>>
  let principalToken: string
  let teacherToken: string
  let otherTeacherToken: string

  beforeEach(async () => {
    // createTestSchoolWithPrincipal 创建了学校 + 负责人教师
    schoolData = await createTestSchoolWithPrincipal()
    teacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    otherTeacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })

    // 使用学校的实际负责人（schoolData.principal）的 token
    principalToken = generateTestToken({
      userId: schoolData.principal.userId,
      role: 'school_principal',
      username: `principal_${Date.now()}`,
      teacherId: schoolData.principal.teacherId,
      schoolId: schoolData.school.id,
    })
    teacherToken = generateTestToken({
      userId: teacherUser.user.id,
      role: 'teacher',
      username: teacherUser.user.username,
      teacherId: teacherUser.teacherId,
      schoolId: schoolData.school.id,
    })
    otherTeacherToken = generateTestToken({
      userId: otherTeacherUser.user.id,
      role: 'teacher',
      username: otherTeacherUser.user.username,
      teacherId: otherTeacherUser.teacherId,
      schoolId: schoolData.school.id,
    })
  })

  // ==================== GET 列表 ====================

  it('本校教师可以查看学校题单列表', async () => {
    const res = await createAuthenticatedRequest(app, teacherToken)
      .get(`/api/schools/${schoolData.school.id}/problem-lists`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toEqual([])
  })

  it('外校教师不能查看学校题单列表', async () => {
    // 创建另一个学校，把教师放到那个学校
    const otherSchool = await createTestSchoolWithPrincipal()
    const otherSchoolTeacher = await createTestUser({ role: 'teacher', schoolId: otherSchool.school.id })
    const token = generateTestToken({
      userId: otherSchoolTeacher.user.id,
      role: 'teacher',
      username: otherSchoolTeacher.user.username,
      teacherId: otherSchoolTeacher.teacherId,
      schoolId: otherSchool.school.id,
    })

    const res = await createAuthenticatedRequest(app, token)
      .get(`/api/schools/${schoolData.school.id}/problem-lists`)

    expect(res.status).toBe(403)
  })

  // ==================== POST 添加 ====================

  it('教师可以添加自己是 owner 的题单到学校', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.problemListId).toBe(list.id)
    expect(res.body.data.addedByRole).toBe('teacher')
  })

  it('学校负责人可以添加自己是 owner 的题单到学校', async () => {
    const { list } = await createTestProblemList({
      ownerId: schoolData.principal.userId,
      schoolId: schoolData.school.id,
    })

    const res = await createAuthenticatedRequest(app, principalToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(200)
    expect(res.body.data.addedByRole).toBe('principal')
  })

  it('不能添加非自己 owner 的题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: schoolData.principal.userId,
      schoolId: schoolData.school.id,
    })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('owner')
  })

  it('不能重复添加同一题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(409)
  })

  // ==================== DELETE 删除 ====================

  it('教师可以删除自己添加的学校题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    const addRes = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .delete(`/api/schools/${schoolData.school.id}/problem-lists/${addRes.body.data.id}`)

    expect(res.status).toBe(200)
  })

  it('教师不能删除其他教师添加的学校题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    const addRes = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, otherTeacherToken)
      .delete(`/api/schools/${schoolData.school.id}/problem-lists/${addRes.body.data.id}`)

    expect(res.status).toBe(403)
  })

  it('学校负责人可以删除任何人添加的学校题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    const addRes = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, principalToken)
      .delete(`/api/schools/${schoolData.school.id}/problem-lists/${addRes.body.data.id}`)

    expect(res.status).toBe(200)
  })

  // ==================== 列表内容 ====================

  it('GET 返回正确的题单信息', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
      title: '我的题单',
    })

    await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .get(`/api/schools/${schoolData.school.id}/problem-lists`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].problemList.title).toBe('我的题单')
    expect(res.body.data[0].problemList.ownerId).toBe(teacherUser.user.id)
    expect(res.body.data[0].addedByRole).toBe('teacher')
  })

  // ==================== 收录后的查看权限 ====================

  it('学校收录的题单，本校其他教师可查看详情', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
      title: '收录题单',
    })

    // 教师 A 收录到学校
    await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    // 教师 B 查看题单详情
    const res = await createAuthenticatedRequest(app, otherTeacherToken)
      .get(`/api/problem-lists/${list.id}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data._permission).toBe('view')
  })

  it('学校收录的题单，owner 仍是 admin 权限', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .get(`/api/problem-lists/${list.id}`)

    expect(res.status).toBe(200)
    expect(res.body.data._permission).toBe('admin')
  })

  // ==================== 删除保护 ====================

  it('题单被学校收录后，owner 无法删除该题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    // 收录到学校
    await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    // owner 尝试删除题单
    const res = await createAuthenticatedRequest(app, teacherToken)
      .delete(`/api/problem-lists/${list.id}`)

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('收录')
  })

  it('题单从学校移除后，owner 可以删除', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    // 收录到学校
    const addRes = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/schools/${schoolData.school.id}/problem-lists`)
      .send({ problemListId: list.id })

    // 从学校移除
    await createAuthenticatedRequest(app, teacherToken)
      .delete(`/api/schools/${schoolData.school.id}/problem-lists/${addRes.body.data.id}`)

    // 现在 owner 可以删除
    const res = await createAuthenticatedRequest(app, teacherToken)
      .delete(`/api/problem-lists/${list.id}`)

    expect(res.status).toBe(200)
  })
})

describe('旧学校题单 API 退役契约', () => {
  it('统一返回 410，避免旧客户端误写数据', async () => {
    const res = await request(app).get('/api/schools/legacy/problem-lists')
    expect(res.status).toBe(410)
    expect(res.body.code).toBe('LEGACY_SCHOOL_API_RETIRED')
  })
})

describe('团队题单 API', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let teacherUser: Awaited<ReturnType<typeof createTestUser>>
  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string
  let adminToken: string
  let teacherToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    adminUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    teacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })

    team = await createTestTeam({
      schoolId: schoolData.school.id,
      ownerId: ownerUser.teacherId,
      isPublic: true,
    })

    // 添加 admin
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: adminUser.teacherId!,
        userType: 'teacher',
        role: 'admin',
        status: 'active',
        joinedAt: new Date()
      }
    })

    // 添加教师成员
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: teacherUser.teacherId!,
        userType: 'teacher',
        role: 'member',
        status: 'active',
        joinedAt: new Date()
      }
    })

    ownerToken = generateTestToken({
      userId: ownerUser.user.id,
      role: 'teacher',
      username: ownerUser.user.username,
      teacherId: ownerUser.teacherId,
      schoolId: schoolData.school.id,
    })
    adminToken = generateTestToken({
      userId: adminUser.user.id,
      role: 'teacher',
      username: adminUser.user.username,
      teacherId: adminUser.teacherId,
      schoolId: schoolData.school.id,
    })
    teacherToken = generateTestToken({
      userId: teacherUser.user.id,
      role: 'teacher',
      username: teacherUser.user.username,
      teacherId: teacherUser.teacherId,
      schoolId: schoolData.school.id,
    })
  })

  // ==================== GET 列表 ====================

  it('团队成员可以查看团队题单列表', async () => {
    const res = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/teams/${team.id}/problem-lists`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toEqual([])
  })

  // ==================== POST 添加 ====================

  it('团队 owner 可以添加自己是 owner 的题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    const res = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(200)
    expect(res.body.data.addedByRole).toBe('owner')
  })

  it('团队 admin 可以添加自己是 owner 的题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: adminUser.user.id,
      schoolId: schoolData.school.id,
    })

    const res = await createAuthenticatedRequest(app, adminToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(200)
    expect(res.body.data.addedByRole).toBe('admin')
  })

  it('团队教师成员可以添加自己是 owner 的题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: teacherUser.user.id,
      schoolId: schoolData.school.id,
    })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(200)
    expect(res.body.data.addedByRole).toBe('teacher')
  })

  it('不能添加非自己 owner 的题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    const res = await createAuthenticatedRequest(app, adminToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(403)
  })

  it('不能重复添加同一题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    expect(res.status).toBe(409)
  })

  // ==================== DELETE 删除 ====================

  it('团队 owner 可以删除任何人添加的团队题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: adminUser.user.id,
      schoolId: schoolData.school.id,
    })

    const addRes = await createAuthenticatedRequest(app, adminToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, ownerToken)
      .delete(`/api/teams/${team.id}/problem-lists/${addRes.body.data.id}`)

    expect(res.status).toBe(200)
  })

  it('团队 admin 可以删除自己添加的团队题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: adminUser.user.id,
      schoolId: schoolData.school.id,
    })

    const addRes = await createAuthenticatedRequest(app, adminToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, adminToken)
      .delete(`/api/teams/${team.id}/problem-lists/${addRes.body.data.id}`)

    expect(res.status).toBe(200)
  })

  it('团队 admin 不能删除其他 admin 添加的团队题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    // owner 添加
    const addRes = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    // admin 尝试删除
    const res = await createAuthenticatedRequest(app, adminToken)
      .delete(`/api/teams/${team.id}/problem-lists/${addRes.body.data.id}`)

    expect(res.status).toBe(403)
  })

  it('普通教师成员不能删除其他人添加的题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    const addRes = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    const res = await createAuthenticatedRequest(app, teacherToken)
      .delete(`/api/teams/${team.id}/problem-lists/${addRes.body.data.id}`)

    expect(res.status).toBe(403)
  })

  // ==================== 收录后的查看权限 ====================

  it('团队收录的题单，其他成员可查看详情', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    // owner 收录到团队
    await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    // admin 查看题单详情
    const res = await createAuthenticatedRequest(app, adminToken)
      .get(`/api/problem-lists/${list.id}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data._permission).toBe('view')
  })

  // ==================== 删除保护 ====================

  it('题单被团队收录后，owner 无法删除该题单', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    // 收录到团队
    await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    // owner 尝试删除题单
    const res = await createAuthenticatedRequest(app, ownerToken)
      .delete(`/api/problem-lists/${list.id}`)

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('收录')
  })

  it('题单从团队移除后，owner 可以删除', async () => {
    const { list } = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    // 收录到团队
    const addRes = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/problem-lists`)
      .send({ problemListId: list.id })

    // 从团队移除
    await createAuthenticatedRequest(app, ownerToken)
      .delete(`/api/teams/${team.id}/problem-lists/${addRes.body.data.id}`)

    // 现在 owner 可以删除
    const res = await createAuthenticatedRequest(app, ownerToken)
      .delete(`/api/problem-lists/${list.id}`)

    expect(res.status).toBe(200)
  })
})
