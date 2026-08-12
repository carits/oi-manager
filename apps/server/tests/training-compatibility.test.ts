/**
 * 训练路由兼容校级比赛测试
 * 覆盖：现有训练路由（详情/题目/提交/排名/笔记/记录）对校级比赛的兼容性
 * 以及团队比赛回归测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { createTestSchoolContest, createTestContestProblem, addProblemToContest, createTestSubmission } from './helpers/school-contest-helpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

// ==================== 训练路由兼容校级比赛 ====================
describe('训练路由兼容校级比赛', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let principalUser: Awaited<ReturnType<typeof createTestUser>>
  let teacherUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>

  // 外校用户
  let otherSchoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let otherSchoolTeacher: Awaited<ReturnType<typeof createTestUser>>
  let otherSchoolStudent: Awaited<ReturnType<typeof createTestUser>>

  let principalToken: string
  let teacherToken: string
  let studentToken: string
  let superAdminToken: string
  let otherSchoolTeacherToken: string
  let otherSchoolStudentToken: string

  // 校级比赛 + 题目
  let schoolContest: any
  let contestProblem: any
  let trainingProblem: any

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    principalUser = await createTestUser({ role: 'school_principal', schoolId: schoolData.school.id })
    teacherUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    superAdminUser = await createTestUser({ role: 'super_admin', schoolId: schoolData.school.id })

    otherSchoolData = await createTestSchoolWithPrincipal()
    otherSchoolTeacher = await createTestUser({ role: 'teacher', schoolId: otherSchoolData.school.id })
    otherSchoolStudent = await createTestUser({ role: 'student', schoolId: otherSchoolData.school.id })

    principalToken = generateTestToken({
      userId: principalUser.user.id,
      role: 'school_principal',
      username: principalUser.user.username,
      teacherId: principalUser.teacherId,
      schoolId: schoolData.school.id,
    })
    teacherToken = generateTestToken({
      userId: teacherUser.user.id,
      role: 'teacher',
      username: teacherUser.user.username,
      teacherId: teacherUser.teacherId,
      schoolId: schoolData.school.id,
    })
    studentToken = generateTestToken({
      userId: studentUser.user.id,
      role: 'student',
      username: studentUser.user.username,
      studentId: studentUser.studentId,
      schoolId: schoolData.school.id,
    })
    superAdminToken = generateTestToken({
      userId: superAdminUser.user.id,
      role: 'super_admin',
      username: superAdminUser.user.username,
      adminId: superAdminUser.adminId,
      schoolId: schoolData.school.id,
    })
    otherSchoolTeacherToken = generateTestToken({
      userId: otherSchoolTeacher.user.id,
      role: 'teacher',
      username: otherSchoolTeacher.user.username,
      teacherId: otherSchoolTeacher.teacherId,
      schoolId: otherSchoolData.school.id,
    })
    otherSchoolStudentToken = generateTestToken({
      userId: otherSchoolStudent.user.id,
      role: 'student',
      username: otherSchoolStudent.user.username,
      studentId: otherSchoolStudent.studentId,
      schoolId: otherSchoolData.school.id,
    })

    // 创建校级比赛（ongoing 状态）
    schoolContest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: teacherUser.teacherId!,
      title: '兼容性测试校级比赛',
      format: 'ioi',
      type: 'contest',
      status: 'ongoing',
    })

    // 创建题目并添加到比赛
    contestProblem = await createTestContestProblem({
      ownerId: teacherUser.teacherId!,
      title: '兼容性测试题目',
    })
    trainingProblem = await addProblemToContest({
      trainingId: schoolContest.id,
      problemId: contestProblem.id,
      alias: 'A',
      points: 100,
    })
  })

  // ==================== 详情 API ====================
  describe('详情 API: GET /api/trainings/:id', () => {
    it('TD1: 团队比赛详情 - 团队成员可访问', async () => {
      const team = await createTestTeam({ schoolId: schoolData.school.id, ownerId: teacherUser.teacherId! })
      const teamTraining = await prisma.training.create({
        data: {
          schoolId: null,
          teamId: team.id,
          title: '团队训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(Date.now() + 3600000),
          status: 'ongoing',
          createdBy: teacherUser.teacherId!,
          updatedAt: new Date(),
        },
      })

      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/trainings/${teamTraining.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.id).toBe(teamTraining.id)
    })

    it('TD2: 校级比赛详情 - 本校学生可访问', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${schoolContest.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.id).toBe(schoolContest.id)
    })

    it('TD3: 校级比赛详情 - 本校教师可访问', async () => {
      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/trainings/${schoolContest.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TD4: 校级比赛详情 - 学校负责人可访问', async () => {
      const res = await createAuthenticatedRequest(app, principalToken)
        .get(`/api/trainings/${schoolContest.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TD5: 校级比赛详情 - 外校学生不能访问', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolStudentToken)
        .get(`/api/trainings/${schoolContest.id}`)

      expect(res.status).toBe(403)
    })

    it('TD6: 校级比赛详情 - 外校教师不能访问', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolTeacherToken)
        .get(`/api/trainings/${schoolContest.id}`)

      expect(res.status).toBe(403)
    })

    it('TD7: super_admin 可访问任意校级比赛', async () => {
      const res = await createAuthenticatedRequest(app, superAdminToken)
        .get(`/api/trainings/${schoolContest.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  // ==================== 题目 API ====================
  describe('题目 API: GET /api/trainings/:id/problems', () => {
    it('TP1: 团队比赛题目 - 团队成员可访问', async () => {
      const team = await createTestTeam({ schoolId: schoolData.school.id, ownerId: teacherUser.teacherId! })
      const teamTraining = await prisma.training.create({
        data: {
          schoolId: null,
          teamId: team.id,
          title: '团队训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(Date.now() + 3600000),
          status: 'ongoing',
          createdBy: teacherUser.teacherId!,
          updatedAt: new Date(),
        },
      })
      const teamProblem = await createTestContestProblem({ ownerId: teacherUser.teacherId! })
      await addProblemToContest({ trainingId: teamTraining.id, problemId: teamProblem.id })

      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/trainings/${teamTraining.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TP2: 校级比赛题目 - 本校学生可访问', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${schoolContest.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TP3: 校级比赛题目 - 外校学生不能访问', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolStudentToken)
        .get(`/api/trainings/${schoolContest.id}/problems`)

      expect(res.status).toBe(403)
    })
  })

  // ==================== 提交 API ====================
  describe('提交 API: POST /api/trainings/:id/submit', () => {
    it('TS1: 校级比赛提交 - 本校学生可提交', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/trainings/${schoolContest.id}/submit`)
        .send({
          trainingProblemId: trainingProblem.id,
          language: 'cpp',
          code: '#include <iostream>\nint main() { return 0; }',
        })

      // 提交可能成功(200)或因平台不支持返回400，但不应403
      expect(res.status).not.toBe(403)
    })

    it('TS2: 校级比赛提交 - 外校学生不能提交', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolStudentToken)
        .post(`/api/trainings/${schoolContest.id}/submit`)
        .send({
          trainingProblemId: trainingProblem.id,
          language: 'cpp',
          code: '#include <iostream>\nint main() { return 0; }',
        })

      expect(res.status).toBe(403)
    })

    it('TS3: 校级比赛提交 - 缺少必要参数返回400', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/trainings/${schoolContest.id}/submit`)
        .send({
          trainingProblemId: trainingProblem.id,
          // 缺少 language 和 code
        })

      expect(res.status).toBe(400)
    })
  })

  // ==================== 排名 API ====================
  describe('排名 API: GET /api/trainings/:id/ranking', () => {
    it('TR1: 团队比赛排名 - 团队成员可访问', async () => {
      const team = await createTestTeam({ schoolId: schoolData.school.id, ownerId: teacherUser.teacherId! })
      const teamContest = await prisma.training.create({
        data: {
          schoolId: null,
          teamId: team.id,
          title: '团队比赛',
          format: 'ioi',
          type: 'contest',
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(Date.now() + 3600000),
          status: 'ongoing',
          createdBy: teacherUser.teacherId!,
          updatedAt: new Date(),
        },
      })

      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/trainings/${teamContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TR2: 校级比赛排名 - 本校学生可访问', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${schoolContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TR3: 校级比赛排名 - 外校学生不能访问', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolStudentToken)
        .get(`/api/trainings/${schoolContest.id}/ranking`)

      expect(res.status).toBe(403)
    })

    it('TR4: IOI 校级比赛排名数据结构正确', async () => {
      // 创建提交记录
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: schoolContest.id,
        problemId: contestProblem.problemId,
        trainingProblemId: trainingProblem.id,
        result: 'accepted',
        score: 100,
        submitScope: 'contest',
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${schoolContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.format).toBe('ioi')
      expect(res.body.data.ranking).toBeDefined()
      expect(Array.isArray(res.body.data.ranking)).toBe(true)
    })

    it('TR5: ICPC 每题只标记最早有效通过者为首 A', async () => {
      const secondStudent = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      const thirdStudent = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      const startTime = new Date(Date.now() - 60 * 60 * 1000)
      const icpcContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.teacherId!,
        title: 'ICPC 首 A 测试',
        format: 'icpc',
        type: 'contest',
        status: 'ongoing',
        startTime,
      })
      const icpcProblem = await createTestContestProblem({
        ownerId: teacherUser.teacherId!,
        title: '首 A 判定题目',
      })
      const icpcTrainingProblem = await addProblemToContest({
        trainingId: icpcContest.id,
        problemId: icpcProblem.id,
        alias: 'A',
        points: 100,
      })

      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: icpcContest.id,
        problemId: icpcProblem.problemId,
        trainingProblemId: icpcTrainingProblem.id,
        result: 'wrong_answer',
        score: 0,
        createdAt: new Date(startTime.getTime() + 10 * 60 * 1000),
      })
      await createTestSubmission({
        userId: teacherUser.user.id,
        trainingId: icpcContest.id,
        problemId: icpcProblem.problemId,
        trainingProblemId: icpcTrainingProblem.id,
        result: 'accepted',
        score: 100,
        createdAt: new Date(startTime.getTime() + 15 * 60 * 1000),
      })
      await createTestSubmission({
        userId: secondStudent.user.id,
        trainingId: icpcContest.id,
        problemId: icpcProblem.problemId,
        trainingProblemId: icpcTrainingProblem.id,
        result: 'accepted',
        score: 100,
        createdAt: new Date(startTime.getTime() + 20 * 60 * 1000),
      })
      await createTestSubmission({
        userId: thirdStudent.user.id,
        trainingId: icpcContest.id,
        problemId: icpcProblem.problemId,
        trainingProblemId: icpcTrainingProblem.id,
        result: 'accepted',
        score: 100,
        createdAt: new Date(startTime.getTime() + 20 * 60 * 1000),
      })
      await createTestSubmission({
        userId: studentUser.user.id,
        trainingId: icpcContest.id,
        problemId: icpcProblem.problemId,
        trainingProblemId: icpcTrainingProblem.id,
        result: 'accepted',
        score: 100,
        createdAt: new Date(startTime.getTime() + 30 * 60 * 1000),
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${icpcContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.data.format).toBe('icpc')
      const firstAcceptedRow = res.body.data.ranking.find((row: any) => row.userId === secondStudent.user.id)
      const tiedAcceptedRow = res.body.data.ranking.find((row: any) => row.userId === thirdStudent.user.id)
      const laterAcceptedRow = res.body.data.ranking.find((row: any) => row.userId === studentUser.user.id)
      const excludedAdminRow = res.body.data.ranking.find((row: any) => row.userId === teacherUser.user.id)
      expect(firstAcceptedRow.problems[icpcTrainingProblem.id]).toMatchObject({
        solved: true,
        attempts: 1,
        isFirstAccepted: true,
      })
      expect(laterAcceptedRow.problems[icpcTrainingProblem.id]).toMatchObject({
        solved: true,
        attempts: 2,
        isFirstAccepted: false,
      })
      expect(tiedAcceptedRow.problems[icpcTrainingProblem.id].isFirstAccepted).toBe(false)
      expect(excludedAdminRow).toBeUndefined()
      const firstAcceptedCount = res.body.data.ranking.filter(
        (row: any) => row.problems[icpcTrainingProblem.id].isFirstAccepted,
      ).length
      expect(firstAcceptedCount).toBe(1)
    })
  })

  // ==================== 笔记 API ====================
  describe('笔记 API: GET/PUT /api/trainings/:id/problems/:problemId/note', () => {
    it('TN1: 校级比赛笔记查看 - 本校学生可访问', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${schoolContest.id}/problems/${trainingProblem.id}/note`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TN2: 校级比赛笔记保存 - 本校学生可保存', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .put(`/api/trainings/${schoolContest.id}/problems/${trainingProblem.id}/note`)
        .send({ content: '测试笔记内容' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.content).toBe('测试笔记内容')
    })

    it('TN3: 校级比赛笔记 - 外校学生不能访问', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolStudentToken)
        .get(`/api/trainings/${schoolContest.id}/problems/${trainingProblem.id}/note`)

      expect(res.status).toBe(403)
    })
  })

  // ==================== 比赛记录 API ====================
  describe('比赛记录 API: GET/PUT /api/trainings/:id/record', () => {
    it('TRR1: 校级比赛记录查看 - 本校学生可访问', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${schoolContest.id}/record`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('TRR2: 校级比赛记录保存 - 本校学生可保存', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .put(`/api/trainings/${schoolContest.id}/record`)
        .send({ content: '比赛记录内容' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.content).toBe('比赛记录内容')
    })

    it('TRR3: 校级比赛记录 - 外校学生不能访问', async () => {
      const res = await createAuthenticatedRequest(app, otherSchoolStudentToken)
        .get(`/api/trainings/${schoolContest.id}/record`)

      expect(res.status).toBe(403)
    })
  })

  // ==================== 状态可见性 ====================
  describe('训练状态可见性（requireTrainingStarted）', () => {
    it('ST1: upcoming 校级比赛 - 学校负责人可访问题目', async () => {
      const upcomingContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.teacherId!,
        title: '未开始校级比赛',
        status: 'upcoming',
        startTime: new Date(Date.now() + 3600000),
        endTime: new Date(Date.now() + 7200000),
      })
      const prob = await createTestContestProblem({ ownerId: teacherUser.teacherId! })
      await addProblemToContest({ trainingId: upcomingContest.id, problemId: prob.id })

      const res = await createAuthenticatedRequest(app, principalToken)
        .get(`/api/trainings/${upcomingContest.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('ST2: upcoming 校级比赛 - 创建者教师可访问题目', async () => {
      const upcomingContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.teacherId!,
        title: '未开始校级比赛',
        status: 'upcoming',
        startTime: new Date(Date.now() + 3600000),
        endTime: new Date(Date.now() + 7200000),
      })
      const prob = await createTestContestProblem({ ownerId: teacherUser.teacherId! })
      await addProblemToContest({ trainingId: upcomingContest.id, problemId: prob.id })

      const res = await createAuthenticatedRequest(app, teacherToken)
        .get(`/api/trainings/${upcomingContest.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('ST3: upcoming 校级比赛 - 本校学生不能访问题目', async () => {
      const upcomingContest = await createTestSchoolContest({
        schoolId: schoolData.school.id,
        createdBy: teacherUser.teacherId!,
        title: '未开始校级比赛',
        status: 'upcoming',
        startTime: new Date(Date.now() + 3600000),
        endTime: new Date(Date.now() + 7200000),
      })
      const prob = await createTestContestProblem({ ownerId: teacherUser.teacherId! })
      await addProblemToContest({ trainingId: upcomingContest.id, problemId: prob.id })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${upcomingContest.id}/problems`)

      expect(res.status).toBe(403)
    })

    it('ST4: ongoing 校级比赛 - 本校学生可访问题目', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${schoolContest.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

// ==================== 团队比赛回归测试 ====================
describe('团队比赛回归测试', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>
  let outsiderUser: Awaited<ReturnType<typeof createTestUser>>

  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string
  let studentToken: string
  let outsiderToken: string

  let teamTraining: any
  let teamContest: any

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    outsiderUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })

    team = await createTestTeam({ schoolId: schoolData.school.id, ownerId: ownerUser.teacherId! })

    // 添加团队成员
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: studentUser.studentId!,
        userType: 'student',
        role: 'member',
        status: 'active',
        joinedAt: new Date(),
      },
    })

    ownerToken = generateTestToken({
      userId: ownerUser.user.id,
      role: 'teacher',
      username: ownerUser.user.username,
      teacherId: ownerUser.teacherId,
      schoolId: schoolData.school.id,
    })
    studentToken = generateTestToken({
      userId: studentUser.user.id,
      role: 'student',
      username: studentUser.user.username,
      studentId: studentUser.studentId,
      schoolId: schoolData.school.id,
    })
    outsiderToken = generateTestToken({
      userId: outsiderUser.user.id,
      role: 'student',
      username: outsiderUser.user.username,
      studentId: outsiderUser.studentId,
      schoolId: schoolData.school.id,
    })

    // 创建团队训练
    teamTraining = await prisma.training.create({
      data: {
        schoolId: null,
        teamId: team.id,
        title: '回归测试团队训练',
        format: 'ioi',
        type: 'training',
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() + 3600000),
        status: 'ongoing',
        createdBy: ownerUser.teacherId!,
        updatedAt: new Date(),
      },
    })

    // 创建团队比赛
    teamContest = await prisma.training.create({
      data: {
        schoolId: null,
        teamId: team.id,
        title: '回归测试团队比赛',
        format: 'ioi',
        type: 'contest',
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() + 3600000),
        status: 'ongoing',
        createdBy: ownerUser.teacherId!,
        updatedAt: new Date(),
      },
    })
  })

  it('RG1: 团队训练列表正常', async () => {
    const res = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/teams/${team.id}/trainings`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('RG2: 团队训练创建正常', async () => {
    const res = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/teams/${team.id}/trainings`)
      .send({
        title: '新团队训练',
        format: 'ioi',
        type: 'training',
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.teamId).toBe(team.id)
    expect(res.body.data.schoolId).toBeNull()
  })

  it('RG3: 团队比赛详情正常', async () => {
    const res = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/trainings/${teamContest.id}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.id).toBe(teamContest.id)
    expect(res.body.data.teamId).toBe(team.id)
  })

  it('RG4: 团队比赛题目正常', async () => {
    const prob = await createTestContestProblem({ ownerId: ownerUser.teacherId! })
    await addProblemToContest({ trainingId: teamContest.id, problemId: prob.id })

    const res = await createAuthenticatedRequest(app, studentToken)
      .get(`/api/trainings/${teamContest.id}/problems`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('RG5: 团队比赛排名正常', async () => {
    const res = await createAuthenticatedRequest(app, studentToken)
      .get(`/api/trainings/${teamContest.id}/ranking`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('RG6: 非团队成员不能访问团队比赛', async () => {
    const res = await createAuthenticatedRequest(app, outsiderToken)
      .get(`/api/trainings/${teamContest.id}`)

    expect(res.status).toBe(403)
  })

  it('RG7: 校级比赛和团队比赛共存互不影响', async () => {
    // 同时创建校级比赛
    const schoolContest = await createTestSchoolContest({
      schoolId: schoolData.school.id,
      createdBy: ownerUser.teacherId!,
      title: '共存测试校级比赛',
      format: 'ioi',
      type: 'contest',
      status: 'ongoing',
    })

    // 团队成员访问团队比赛
    const teamRes = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/trainings/${teamContest.id}`)
    expect(teamRes.status).toBe(200)

    // 本校成员访问校级比赛
    const schoolRes = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/trainings/${schoolContest.id}`)
    expect(schoolRes.status).toBe(200)

    // 团队比赛不应出现在校级比赛列表中
    const schoolContestList = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/schools/${schoolData.school.id}/contests`)
    expect(schoolContestList.status).toBe(200)
    expect(schoolContestList.body.success).toBe(true)
    const schoolContestIds = schoolContestList.body.data.map((c: any) => c.id)
    expect(schoolContestIds).not.toContain(teamContest.id)
    expect(schoolContestIds).toContain(schoolContest.id)
  })
})
