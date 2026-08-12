/**
 * 校级比赛模块测试
 * 覆盖：CRUD API、权限函数、赛制行为、提交功能、排名功能、题目状态、综合场景
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { createTestSchoolContest, createTestContestProblem, addProblemToContest, createTestSubmission } from './helpers/school-contest-helpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

// ==================== 校级比赛 CRUD API ====================
describe('校级比赛 CRUD API', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let principalUser: Awaited<ReturnType<typeof createTestUser>>
  let teacherUser: Awaited<ReturnType<typeof createTestUser>>
  let otherTeacherUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>
  let platformAdminUser: Awaited<ReturnType<typeof createTestUser>>

  // 外校用户
  let otherSchoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let otherSchoolTeacher: Awaited<ReturnType<typeof createTestUser>>
  let otherSchoolStudent: Awaited<ReturnType<typeof createTestUser>>

  let principalToken: string
  let teacherToken: string
  let otherTeacherToken: string
  let studentToken: string
  let superAdminToken: string
  let platformAdminToken: string
  let otherSchoolTeacherToken: string
  let otherSchoolStudentToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    principalUser = await createTestUser({ role: 'school_principal', schoolId: schoolData.school.id })
    teacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    otherTeacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    superAdminUser = await createTestUser({ role: 'super_admin' })
    platformAdminUser = await createTestUser({ role: 'platform_admin' })

    otherSchoolData = await createTestSchoolWithPrincipal()
    otherSchoolTeacher = await createTestUser({ role: 'teacher', schoolId: otherSchoolData.school.id })
    otherSchoolStudent = await createTestUser({ role: 'student', schoolId: otherSchoolData.school.id })

    principalToken = generateTestToken({
      userId: principalUser.user.id, role: 'school_principal',
      username: principalUser.user.username, teacherId: principalUser.teacherId!,
      schoolId: schoolData.school.id,
    })
    teacherToken = generateTestToken({
      userId: teacherUser.user.id, role: 'teacher',
      username: teacherUser.user.username, teacherId: teacherUser.teacherId!,
      schoolId: schoolData.school.id,
    })
    otherTeacherToken = generateTestToken({
      userId: otherTeacherUser.user.id, role: 'teacher',
      username: otherTeacherUser.user.username, teacherId: otherTeacherUser.teacherId!,
      schoolId: schoolData.school.id,
    })
    studentToken = generateTestToken({
      userId: studentUser.user.id, role: 'student',
      username: studentUser.user.username, studentId: studentUser.studentId!,
      schoolId: schoolData.school.id,
    })
    superAdminToken = generateTestToken({
      userId: superAdminUser.user.id, role: 'super_admin',
      username: superAdminUser.user.username, adminId: superAdminUser.adminId!,
    })
    platformAdminToken = generateTestToken({
      userId: platformAdminUser.user.id, role: 'platform_admin',
      username: platformAdminUser.user.username, adminId: platformAdminUser.adminId!,
    })
    otherSchoolTeacherToken = generateTestToken({
      userId: otherSchoolTeacher.user.id, role: 'teacher',
      username: otherSchoolTeacher.user.username, teacherId: otherSchoolTeacher.teacherId!,
      schoolId: otherSchoolData.school.id,
    })
    otherSchoolStudentToken = generateTestToken({
      userId: otherSchoolStudent.user.id, role: 'student',
      username: otherSchoolStudent.user.username, studentId: otherSchoolStudent.studentId!,
      schoolId: otherSchoolData.school.id,
    })
  })

  // ==================== 列表 API ====================
  describe('列表 API: GET /api/schools/:schoolId/contests', () => {
    it('L1: 本校负责人可查看列表', async () => {
      const res = await createAuthenticatedRequest(app, principalToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('L2: 本校教师可查看列表', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
    })

    it('L3: 本校学生可查看列表', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
    })

    it('L4: super_admin 可查看任意学校', async () => {
      const res = await createAuthenticatedRequest(app, superAdminToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
    })

    it('L5: platform_admin 可查看任意学校', async () => {
      const res = await createAuthenticatedRequest(app, platformAdminToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
    })

    it('L6: 外校教师不能查看', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolTeacherToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(403)
    })

    it('L7: 外校学生不能查看', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolStudentToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(403)
    })

    it('L8: 未认证用户不能查看', async () => {
      const res = await request(app)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(401)
    })

    it('L9: type=contest 过滤', async () => {
      // 创建一个校级比赛
      await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        type: 'contest',
      })
      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
      // 默认只返回 type='contest'
      expect(res.body.data.every((t: any) => t.type === 'contest')).toBe(true)
    })

    it('L10: 空列表场景', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })

    it('L11: participantCount 计算', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const problem = await createTestContestProblem({ ownerId: teacherUser.user.id })
      const tp = await addProblemToContest({
        trainingId: contest.id,
        problemId: problem.id,
        alias: 'A',
      })
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: contest.id,
        problemId: problem.problemId,
        trainingProblemId: tp.id,
      })

      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/schools/${schoolData.school.id}/contests`)
      expect(res.status).toBe(200)
      const found = res.body.data.find((t: any) => t.id === contest.id)
      expect(found).toBeDefined()
      expect(found.participantCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('演示数据 API: POST /api/schools/:schoolId/contests/demo-data', () => {
    it('D1: 仅比赛管理员在明确确认后可以生成，并且提交接口能返回演示提交', async () => {
      await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      await createTestUser({ role: 'student', schoolId: schoolData.school.id })

      const denied = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/schools/${schoolData.school.id}/contests/demo-data`)
        .send({ confirmation: '生成比赛演示数据' })
      expect(denied.status).toBe(403)

      const missingConfirmation = await createAuthenticatedRequest(app, principalToken)
        .post(`/api/schools/${schoolData.school.id}/contests/demo-data`)
        .send({})
      expect(missingConfirmation.status).toBe(400)

      const created = await createAuthenticatedRequest(app, principalToken)
        .post(`/api/schools/${schoolData.school.id}/contests/demo-data`)
        .send({ confirmation: '生成比赛演示数据' })
      expect(created.status).toBe(200)
      expect(created.body.data.contestIds).toHaveLength(9)
      expect(created.body.data.submissionCount).toBeGreaterThan(0)

      const submissions = await createAuthenticatedRequest(app, principalToken)
        .get('/api/trainings/9804/submissions')
      expect(submissions.status).toBe(200)
      expect(submissions.body.data.total).toBeGreaterThan(0)

      const repeated = await createAuthenticatedRequest(app, principalToken)
        .post(`/api/schools/${schoolData.school.id}/contests/demo-data`)
        .send({ confirmation: '生成比赛演示数据' })
      expect(repeated.status).toBe(200)
      expect(repeated.body.data.submissionCount).toBe(created.body.data.submissionCount)
    })
  })

  // ==================== 创建 API ====================
  describe('创建 API: POST /api/schools/:schoolId/contests', () => {
    const futureStart = () => new Date(Date.now() + 86400000).toISOString()
    const futureEnd = () => new Date(Date.now() + 86400000 * 2).toISOString()

    it('C1: 本校负责人可创建', async () => {
      const res = await createAuthenticatedRequest(app, principalToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '负责人创建的比赛', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.title).toBe('负责人创建的比赛')
    })

    it('C2: 本校教师可创建', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '教师创建的比赛', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('C3: super_admin 可创建任意学校', async () => {
      const res = await createAuthenticatedRequest(app, superAdminToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '超管创建的比赛', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(200)
    })

    it('C4: 学生不能创建', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '学生创建的比赛', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(403)
    })

    it('C5: 外校教师不能创建', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolTeacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '外校教师创建的比赛', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(403)
    })

    it('C6: 外校负责人不能创建', async () => {
      const otherPrincipal = await createTestUser({ role: 'school_principal', schoolId: otherSchoolData.school.id })
      const otherPrincipalToken = generateTestToken({
        userId: otherPrincipal.user.id, role: 'school_principal',
        username: otherPrincipal.user.username, teacherId: otherPrincipal.teacherId!,
        schoolId: otherSchoolData.school.id,
      })
      const res = await createAuthenticatedRequest(app, otherPrincipalToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '外校负责人创建的比赛', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(403)
    })

    it('C7: 必填字段缺失（title）', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(400)
    })

    it('C8: 必填字段缺失（startTime）', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '测试', endTime: futureEnd() })
      expect(res.status).toBe(400)
    })

    it('C9: 必填字段缺失（endTime）', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '测试', startTime: futureStart() })
      expect(res.status).toBe(400)
    })

    it('C10: endTime <= startTime', async () => {
      const start = futureStart()
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '测试', startTime: start, endTime: start })
      expect(res.status).toBe(400)
    })

    it('C11: startTime <= now', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '测试', startTime: new Date(Date.now() - 1000).toISOString(), endTime: futureEnd() })
      expect(res.status).toBe(400)
    })

    it('C12: 创建后 teamId=null', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '测试', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(200)
      expect(res.body.data.teamId).toBeNull()
    })

    it('C13: 创建后 type=contest', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '测试', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(200)
      expect(res.body.data.type).toBe('contest')
    })

    it('C14: 创建后 schoolId 正确', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .post(`/api/schools/${schoolData.school.id}/contests`)
        .send({ title: '测试', startTime: futureStart(), endTime: futureEnd() })
      expect(res.status).toBe(200)
      expect(res.body.data.schoolId).toBe(schoolData.school.id)
    })
  })

  // ==================== 更新 API ====================
  describe('更新 API: PUT /api/schools/:schoolId/contests/:id', () => {
    it('U1: 创建者可更新自己的比赛', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, teacherToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ title: '更新后的标题' })
      expect(res.status).toBe(200)
      expect(res.body.data.title).toBe('更新后的标题')
    })

    it('U2: 学校负责人可更新任意本校比赛', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, principalToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ title: '负责人更新' })
      expect(res.status).toBe(200)
    })

    it('U3: super_admin 可更新任意比赛', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, superAdminToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ title: '超管更新' })
      expect(res.status).toBe(200)
    })

    it('U4: 非创建者教师不能更新', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, otherTeacherToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ title: '非创建者更新' })
      expect(res.status).toBe(403)
    })

    it('U5: 学生不能更新', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, studentToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ title: '学生更新' })
      expect(res.status).toBe(403)
    })

    it('U6: 外校负责人不能更新', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const otherPrincipal = await createTestUser({ role: 'school_principal', schoolId: otherSchoolData.school.id })
      const otherPrincipalToken = generateTestToken({
        userId: otherPrincipal.user.id, role: 'school_principal',
        username: otherPrincipal.user.username, teacherId: otherPrincipal.teacherId!,
        schoolId: otherSchoolData.school.id,
      })
      const res = await createAuthenticatedRequest(app, otherPrincipalToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ title: '外校负责人更新' })
      expect(res.status).toBe(403)
    })

    it('U7: 比赛不存在', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .put(`/api/schools/${schoolData.school.id}/contests/999999`)
        .send({ title: '不存在的比赛' })
      expect(res.status).toBe(404)
    })

    it('U8: 比赛不属于该学校', async () => {
      const contest = await createTestSchoolContest({
        schoolId: otherSchoolData.school.id,
        createdBy: otherSchoolTeacher.user.id,
      })
      const res = await createAuthenticatedRequest(app, teacherToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ title: '不属于该学校' })
      expect(res.status).toBe(403)
    })

    it('U9: 比赛已开始，修改 startTime 被拒绝', async () => {
      // 创建一个已开始的比赛（startTime 在过去）
      const contest = await prisma.training.create({
        data: {
          schoolId: schoolData.school.id,
          teamId: null,
          title: '已开始的比赛',
          format: 'ioi',
          type: 'contest',
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(Date.now() + 3600000),
          status: 'ongoing',
          createdBy: teacherUser.user.id,
        },
      })
      const res = await createAuthenticatedRequest(app, teacherToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ startTime: new Date(Date.now() + 86400000).toISOString() })
      expect(res.status).toBe(400)
    })

    it('U10: endTime <= startTime 被拒绝', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        startTime: new Date(Date.now() + 86400000),
        endTime: new Date(Date.now() + 86400000 * 2),
      })
      const res = await createAuthenticatedRequest(app, teacherToken)
        .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
        .send({ endTime: new Date(Date.now() + 86400000 - 1000).toISOString() })
      expect(res.status).toBe(400)
    })
  })

  // ==================== 删除 API ====================
  describe('删除 API: DELETE /api/schools/:schoolId/contests/:id', () => {
    it('D1: 创建者可删除自己的比赛', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, teacherToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      expect(res.status).toBe(200)
    })

    it('D2: 学校负责人可删除任意本校比赛', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, principalToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      expect(res.status).toBe(200)
    })

    it('D3: super_admin 可删除任意比赛', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, superAdminToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      expect(res.status).toBe(200)
    })

    it('D4: 非创建者教师不能删除', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, otherTeacherToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      expect(res.status).toBe(403)
    })

    it('D5: 学生不能删除', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, studentToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      expect(res.status).toBe(403)
    })

    it('D6: 外校负责人不能删除', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
      })
      const otherPrincipal = await createTestUser({ role: 'school_principal', schoolId: otherSchoolData.school.id })
      const otherPrincipalToken = generateTestToken({
        userId: otherPrincipal.user.id, role: 'school_principal',
        username: otherPrincipal.user.username, teacherId: otherPrincipal.teacherId!,
        schoolId: otherSchoolData.school.id,
      })
      const res = await createAuthenticatedRequest(app, otherPrincipalToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      expect(res.status).toBe(403)
    })

    it('D7: 比赛不存在', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/999999`)
      expect(res.status).toBe(404)
    })

    it('D8: 比赛不属于该学校', async () => {
      const contest = await createTestSchoolContest({
        schoolId: otherSchoolData.school.id,
        createdBy: otherSchoolTeacher.user.id,
      })
      const res = await createAuthenticatedRequest(app, teacherToken)
        .delete(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      expect(res.status).toBe(403)
    })
  })
})

// ==================== 权限函数测试 ====================
describe('校级比赛权限函数', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let otherSchoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    otherSchoolData = await createTestSchoolWithPrincipal()
  })

  describe('isSchoolMember', () => {
    it('SM1: super_admin 返回 true', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      const admin = await createTestUser({ role: 'super_admin' })
      expect(await isSchoolMember(admin.user.id, schoolData.school.id)).toBe(true)
    })

    it('SM2: platform_admin 返回 true', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      const admin = await createTestUser({ role: 'platform_admin' })
      expect(await isSchoolMember(admin.user.id, schoolData.school.id)).toBe(true)
    })

    it('SM3: 本校教师返回 true', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
      expect(await isSchoolMember(teacher.user.id, schoolData.school.id)).toBe(true)
    })

    it('SM4: 本校学生返回 true', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      const student = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      expect(await isSchoolMember(student.user.id, schoolData.school.id)).toBe(true)
    })

    it('SM5: 本校负责人返回 true', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      const principal = await createTestUser({ role: 'school_principal', schoolId: schoolData.school.id })
      expect(await isSchoolMember(principal.user.id, schoolData.school.id)).toBe(true)
    })

    it('SM6: 外校教师返回 false', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: otherSchoolData.school.id })
      expect(await isSchoolMember(teacher.user.id, schoolData.school.id)).toBe(false)
    })

    it('SM7: 外校学生返回 false', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      const student = await createTestUser({ role: 'student', schoolId: otherSchoolData.school.id })
      expect(await isSchoolMember(student.user.id, schoolData.school.id)).toBe(false)
    })

    it('SM8: 用户不存在返回 false', async () => {
      const { isSchoolMember } = await import('../src/modules/training/training.helpers')
      expect(await isSchoolMember('nonexistent-user-id', schoolData.school.id)).toBe(false)
    })
  })

  describe('isSchoolContestAdmin', () => {
    it('SCA1: super_admin 创建权限', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const admin = await createTestUser({ role: 'super_admin' })
      expect(await isSchoolContestAdmin(admin.user.id, schoolData.school.id)).toBe(true)
    })

    it('SCA2: super_admin 管理权限', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const admin = await createTestUser({ role: 'super_admin' })
      expect(await isSchoolContestAdmin(admin.user.id, schoolData.school.id, 'other-user-id')).toBe(true)
    })

    it('SCA3: 本校负责人创建权限', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const principal = await createTestUser({ role: 'school_principal', schoolId: schoolData.school.id })
      expect(await isSchoolContestAdmin(principal.user.id, schoolData.school.id)).toBe(true)
    })

    it('SCA4: 本校负责人管理任意', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const principal = await createTestUser({ role: 'school_principal', schoolId: schoolData.school.id })
      expect(await isSchoolContestAdmin(principal.user.id, schoolData.school.id, 'other-user-id')).toBe(true)
    })

    it('SCA5: 本校教师创建权限', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
      expect(await isSchoolContestAdmin(teacher.user.id, schoolData.school.id)).toBe(true)
    })

    it('SCA6: 本校教师管理自己创建', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
      expect(await isSchoolContestAdmin(teacher.user.id, schoolData.school.id, teacher.user.id)).toBe(true)
    })

    it('SCA7: 本校教师不能管理他人创建', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
      expect(await isSchoolContestAdmin(teacher.user.id, schoolData.school.id, 'other-user-id')).toBe(false)
    })

    it('SCA8: 外校负责人不能创建', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const principal = await createTestUser({ role: 'school_principal', schoolId: otherSchoolData.school.id })
      expect(await isSchoolContestAdmin(principal.user.id, schoolData.school.id)).toBe(false)
    })

    it('SCA9: 外校教师不能创建', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: otherSchoolData.school.id })
      expect(await isSchoolContestAdmin(teacher.user.id, schoolData.school.id)).toBe(false)
    })

    it('SCA10: 学生不能创建', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      const student = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      expect(await isSchoolContestAdmin(student.user.id, schoolData.school.id)).toBe(false)
    })

    it('SCA11: 用户不存在返回 false', async () => {
      const { isSchoolContestAdmin } = await import('../src/modules/training/training.helpers')
      expect(await isSchoolContestAdmin('nonexistent-user-id', schoolData.school.id)).toBe(false)
    })
  })

  describe('canAccessTraining', () => {
    it('CAT1: 校级比赛 + 本校成员可访问', async () => {
      const { canAccessTraining } = await import('../src/modules/training/training.helpers')
      const student = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      expect(await canAccessTraining(student.user.id, { teamId: null, schoolId: schoolData.school.id })).toBe(true)
    })

    it('CAT2: 校级比赛 + 外校成员不能访问', async () => {
      const { canAccessTraining } = await import('../src/modules/training/training.helpers')
      const student = await createTestUser({ role: 'student', schoolId: otherSchoolData.school.id })
      expect(await canAccessTraining(student.user.id, { teamId: null, schoolId: schoolData.school.id })).toBe(false)
    })

    it('CAT3: 无归属比赛拒绝访问', async () => {
      const { canAccessTraining } = await import('../src/modules/training/training.helpers')
      const student = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      expect(await canAccessTraining(student.user.id, { teamId: null, schoolId: null })).toBe(false)
    })
  })

  describe('canManageTraining', () => {
    it('CMT1: 校级比赛 + 学校负责人可管理', async () => {
      const { canManageTraining } = await import('../src/modules/training/training.helpers')
      const principal = await createTestUser({ role: 'school_principal', schoolId: schoolData.school.id })
      expect(await canManageTraining(principal.user.id, { teamId: null, schoolId: schoolData.school.id, createdBy: 'other-user-id' })).toBe(true)
    })

    it('CMT2: 校级比赛 + 创建者可管理', async () => {
      const { canManageTraining } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
      expect(await canManageTraining(teacher.user.id, { teamId: null, schoolId: schoolData.school.id, createdBy: teacher.user.id })).toBe(true)
    })

    it('CMT3: 校级比赛 + 非创建者教师不能管理', async () => {
      const { canManageTraining } = await import('../src/modules/training/training.helpers')
      const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
      expect(await canManageTraining(teacher.user.id, { teamId: null, schoolId: schoolData.school.id, createdBy: 'other-user-id' })).toBe(false)
    })

    it('CMT4: 无归属比赛拒绝管理', async () => {
      const { canManageTraining } = await import('../src/modules/training/training.helpers')
      const admin = await createTestUser({ role: 'super_admin' })
      // super_admin 在 isSchoolContestAdmin 中返回 true，但 getTrainingAccessMode 返回 null
      // canManageTraining 在 mode=null 时返回 false
      expect(await canManageTraining(admin.user.id, { teamId: null, schoolId: null, createdBy: admin.user.id })).toBe(false)
    })
  })
})

// ==================== 赛制行为测试 ====================
describe('赛制行为', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let teacherUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>
  let teacherToken: string
  let studentToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    teacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    teacherToken = generateTestToken({
      userId: teacherUser.user.id, role: 'teacher',
      username: teacherUser.user.username, teacherId: teacherUser.teacherId!,
      schoolId: schoolData.school.id,
    })
    studentToken = generateTestToken({
      userId: studentUser.user.id, role: 'student',
      username: studentUser.user.username, studentId: studentUser.studentId!,
      schoolId: schoolData.school.id,
    })
  })

  describe('OI 赛制可见性', () => {
    let oiContest: any
    let problem: any
    let tp: any

    beforeEach(async () => {
      oiContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        format: 'oi',
      })
      problem = await createTestContestProblem({ ownerId: teacherUser.user.id })
      tp = await addProblemToContest({
        trainingId: oiContest.id,
        problemId: problem.id,
        alias: 'A',
      })
    })

    it('OI-V1: 赛中学生提交结果被隐藏', async () => {
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: oiContest.id,
        problemId: problem.problemId,
        trainingProblemId: tp.id,
        result: 'accepted',
        submitScope: 'contest',
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${oiContest.id}/submissions`)
      expect(res.status).toBe(200)
      // OI 赛制赛中，非管理员看到 result 为 'submitted'
      const sub = res.body.data.submissions[0]
      expect(sub.result).toBe('submitted')
    })

    it('OI-V2: 赛中教师查看结果可见', async () => {
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: oiContest.id,
        problemId: problem.problemId,
        trainingProblemId: tp.id,
        result: 'accepted',
        submitScope: 'contest',
      })

      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/trainings/${oiContest.id}/submissions`)
      expect(res.status).toBe(200)
      // 管理员应看到真实结果
      const sub = res.body.data.submissions[0]
      expect(sub.result).toBe('accepted')
    })

    it('OI-V3: 赛中学生查看排名被隐藏', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${oiContest.id}/ranking`)
      expect(res.status).toBe(200)
      expect(res.body.data.hidden).toBe(true)
      expect(res.body.data.ranking).toEqual([])
    })

    it('OI-V4: 赛中教师查看排名可见', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/trainings/${oiContest.id}/ranking`)
      expect(res.status).toBe(200)
      expect(res.body.data.hidden).toBeFalsy()
    })

    it('OI-V5: 赛后学生查看结果可见', async () => {
      // 创建已结束的 OI 比赛
      const finishedContest = await prisma.training.create({
        data: {
          schoolId: schoolData.school.id,
          teamId: null,
          title: '已结束OI比赛',
          format: 'oi',
          type: 'contest',
          startTime: new Date(Date.now() - 7200000),
          endTime: new Date(Date.now() - 3600000),
          status: 'finished',
          createdBy: teacherUser.user.id,
        },
      })
      const fProblem = await createTestContestProblem({ ownerId: teacherUser.user.id })
      const fTp = await addProblemToContest({ trainingId: finishedContest.id, problemId: fProblem.id, alias: 'A' })
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: finishedContest.id,
        problemId: fProblem.problemId,
        trainingProblemId: fTp.id,
        result: 'accepted',
        submitScope: 'contest',
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${finishedContest.id}/submissions`)
      expect(res.status).toBe(200)
      const sub = res.body.data.submissions[0]
      expect(sub.result).toBe('accepted')
    })

    it('OI-V6: 赛后学生查看排名可见', async () => {
      const finishedContest = await prisma.training.create({
        data: {
          schoolId: schoolData.school.id,
          teamId: null,
          title: '已结束OI比赛-排名',
          format: 'oi',
          type: 'contest',
          startTime: new Date(Date.now() - 7200000),
          endTime: new Date(Date.now() - 3600000),
          status: 'finished',
          createdBy: teacherUser.user.id,
        },
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${finishedContest.id}/ranking`)
      expect(res.status).toBe(200)
      expect(res.body.data.hidden).toBeFalsy()
    })

    it('OI-V7: 未开始学生不能提交', async () => {
      const upcomingContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        format: 'oi',
        startTime: new Date(Date.now() + 86400000),
        endTime: new Date(Date.now() + 86400000 * 2),
        status: 'upcoming',
      })
      const uProblem = await createTestContestProblem({ ownerId: teacherUser.user.id })
      const uTp = await addProblemToContest({ trainingId: upcomingContest.id, problemId: uProblem.id, alias: 'A' })

      const res = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/trainings/${upcomingContest.id}/submit`)
        .send({ trainingProblemId: uTp.id, language: 'cpp', code: 'int main(){}' })
      // 未开始时提交被拒绝（403 或 400）
      expect([400, 403]).toContain(res.status)
    })
  })

  describe('IOI 赛制', () => {
    it('IOI-1: 赛中学生可查看真实评测结果', async () => {
      const ioiContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        format: 'ioi',
      })
      const problem = await createTestContestProblem({ ownerId: teacherUser.user.id })
      const tp = await addProblemToContest({ trainingId: ioiContest.id, problemId: problem.id, alias: 'A' })
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: ioiContest.id,
        problemId: problem.problemId,
        trainingProblemId: tp.id,
        result: 'accepted',
        submitScope: 'contest',
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${ioiContest.id}/submissions`)
      expect(res.status).toBe(200)
      const sub = res.body.data.submissions[0]
      // IOI 赛制赛中结果可见
      expect(sub.result).toBe('accepted')
    })

    it('IOI-2: 赛中学生可查看排名', async () => {
      const ioiContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        format: 'ioi',
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${ioiContest.id}/ranking`)
      expect(res.status).toBe(200)
      expect(res.body.data.hidden).toBeFalsy()
    })
  })

  describe('ICPC 赛制', () => {
    it('ICPC-1: 赛中学生可查看真实评测结果', async () => {
      const icpcContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        format: 'icpc',
      })
      const problem = await createTestContestProblem({ ownerId: teacherUser.user.id })
      const tp = await addProblemToContest({ trainingId: icpcContest.id, problemId: problem.id, alias: 'A' })
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: icpcContest.id,
        problemId: problem.problemId,
        trainingProblemId: tp.id,
        result: 'accepted',
        submitScope: 'contest',
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${icpcContest.id}/submissions`)
      expect(res.status).toBe(200)
      const sub = res.body.data.submissions[0]
      expect(sub.result).toBe('accepted')
    })

    it('ICPC-2: 赛中学生可查看排名', async () => {
      const icpcContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.user.id,
        format: 'icpc',
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${icpcContest.id}/ranking`)
      expect(res.status).toBe(200)
      expect(res.body.data.hidden).toBeFalsy()
    })
  })
})

// ==================== 训练状态可见性测试 ====================
describe('校级比赛训练状态可见性', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let teacherUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>
  let teacherToken: string
  let studentToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    teacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    teacherToken = generateTestToken({
      userId: teacherUser.user.id, role: 'teacher',
      username: teacherUser.user.username, teacherId: teacherUser.teacherId!,
      schoolId: schoolData.school.id,
    })
    studentToken = generateTestToken({
      userId: studentUser.user.id, role: 'student',
      username: studentUser.user.username, studentId: studentUser.studentId!,
      schoolId: schoolData.school.id,
    })
  })

  it('ST1: upcoming 校级比赛 + 创建者可访问题目', async () => {
    const contest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: teacherUser.user.id,
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 86400000 * 2),
      status: 'upcoming',
    })
    const res = await createAuthenticatedRequest(app, teacherToken)
      .get(`/api/trainings/${contest.id}/problems`)
    expect(res.status).toBe(200)
  })

  it('ST2: upcoming 校级比赛 + 学生不能访问题目', async () => {
    const contest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: teacherUser.user.id,
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 86400000 * 2),
      status: 'upcoming',
    })
    const res = await createAuthenticatedRequest(app, studentToken)
      .get(`/api/trainings/${contest.id}/problems`)
    expect(res.status).toBe(403)
  })

  it('ST3: ongoing 校级比赛 + 学生可访问题目', async () => {
    const contest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: teacherUser.user.id,
    })
    const res = await createAuthenticatedRequest(app, studentToken)
      .get(`/api/trainings/${contest.id}/problems`)
    expect(res.status).toBe(200)
  })
})

// ==================== 综合场景测试 ====================
describe('综合场景', () => {
  it('E2E-1: 创建校级比赛 → 添加题目 → 学生查看排名（IOI）', async () => {
    const schoolData = await createTestSchoolWithPrincipal()
    const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    const student = await createTestUser({ role: 'student', schoolId: schoolData.school.id })

    const teacherToken = generateTestToken({
      userId: teacher.user.id, role: 'teacher',
      username: teacher.user.username, teacherId: teacher.teacherId!,
      schoolId: schoolData.school.id,
    })
    const studentToken = generateTestToken({
      userId: student.user.id, role: 'student',
      username: student.user.username, studentId: student.studentId!,
      schoolId: schoolData.school.id,
    })

    // 1. 创建校级比赛
    const contest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: teacher.user.id,
      format: 'ioi',
    })

    // 2. 添加题目
    const problem = await createTestContestProblem({ ownerId: teacher.user.id })
    await addProblemToContest({ trainingId: contest.id, problemId: problem.id, alias: 'A' })

    // 3. 学生查看排名
    const res = await createAuthenticatedRequest(app, studentToken)
      .get(`/api/trainings/${contest.id}/ranking`)
    expect(res.status).toBe(200)
    expect(res.body.data.hidden).toBeFalsy()
  })

  it('E2E-2: 创建者教师管理比赛 → 学校负责人也能管理 → 非创建者教师不能管理', async () => {
    const schoolData = await createTestSchoolWithPrincipal()
    const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    const otherTeacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    const principal = await createTestUser({ role: 'school_principal', schoolId: schoolData.school.id })

    const contest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: teacher.user.id,
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 86400000 * 2),
    })

    // 创建者可更新
    const teacherToken = generateTestToken({
      userId: teacher.user.id, role: 'teacher',
      username: teacher.user.username, teacherId: teacher.teacherId!,
      schoolId: schoolData.school.id,
    })
    const res1 = await createAuthenticatedRequest(app, teacherToken)
      .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      .send({ title: '创建者更新' })
    expect(res1.status).toBe(200)

    // 学校负责人可更新
    const principalToken = generateTestToken({
      userId: principal.user.id, role: 'school_principal',
      username: principal.user.username, teacherId: principal.teacherId!,
      schoolId: schoolData.school.id,
    })
    const res2 = await createAuthenticatedRequest(app, principalToken)
      .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      .send({ title: '负责人更新' })
    expect(res2.status).toBe(200)

    // 非创建者教师不能更新
    const otherTeacherToken = generateTestToken({
      userId: otherTeacher.user.id, role: 'teacher',
      username: otherTeacher.user.username, teacherId: otherTeacher.teacherId!,
      schoolId: schoolData.school.id,
    })
    const res3 = await createAuthenticatedRequest(app, otherTeacherToken)
      .put(`/api/schools/${schoolData.school.id}/contests/${contest.id}`)
      .send({ title: '非创建者更新' })
    expect(res3.status).toBe(403)
  })

  it('E2E-3: 校级比赛和团队比赛共存 → 互不影响', async () => {
    const schoolData = await createTestSchoolWithPrincipal()
    const teacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    const student = await createTestUser({ role: 'student', schoolId: schoolData.school.id })

    const teacherToken = generateTestToken({
      userId: teacher.user.id, role: 'teacher',
      username: teacher.user.username, teacherId: teacher.teacherId!,
      schoolId: schoolData.school.id,
    })

    // 创建团队比赛
    const team = await createTestTeam({ schoolId: schoolData.school.id, ownerId: teacher.teacherId! })
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(), teamId: team.id,
        userId: student.studentId!, userType: 'student',
        role: 'member', status: 'active', joinedAt: new Date(),
      },
    })
    const teamContest = await prisma.training.create({
      data: {
        teamId: team.id, schoolId: null,
        title: '团队比赛', format: 'ioi', type: 'contest',
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() + 3600000),
        status: 'ongoing', createdBy: teacher.user.id,
      },
    })

    // 创建校级比赛
    const schoolContest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: teacher.user.id,
    })

    // 团队比赛列表不包含校级比赛
    const teamListRes = await createAuthenticatedRequest(app, teacherToken)
      .get(`/api/teams/${team.id}/trainings`)
    expect(teamListRes.status).toBe(200)
    const teamContestIds = teamListRes.body.data.map((t: any) => t.id)
    expect(teamContestIds).toContain(teamContest.id)
    expect(teamContestIds).not.toContain(schoolContest.id)

    // 校级比赛列表不包含团队比赛
    const schoolListRes = await createAuthenticatedRequest(app, teacherToken)
      .get(`/api/schools/${schoolData.school.id}/contests`)
    expect(schoolListRes.status).toBe(200)
    const schoolContestIds = schoolListRes.body.data.map((t: any) => t.id)
    expect(schoolContestIds).toContain(schoolContest.id)
    expect(schoolContestIds).not.toContain(teamContest.id)
  })
})
