/**
 * 补题作业测试
 * 覆盖：创建补题作业、权限校验、快照克隆、sourceTrainingId 关联
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('补题作业测试', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>
  let outsiderUser: Awaited<ReturnType<typeof createTestUser>>

  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string
  let adminToken: string
  let studentToken: string
  let outsiderToken: string

  let finishedTraining: any
  let ongoingTraining: any
  let problem: any

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    adminUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    outsiderUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })

    team = await createTestTeam({
      schoolId: schoolData.school.id,
      ownerId: ownerUser.teacherId
    })

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

    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: studentUser.studentId!,
        userType: 'student',
        role: 'member',
        status: 'active',
        joinedAt: new Date()
      }
    })

    ownerToken = generateTestToken({
      userId: ownerUser.user.id,
      role: 'teacher',
      username: ownerUser.user.username,
      teacherId: ownerUser.teacherId!,
      schoolId: schoolData.school.id
    })

    adminToken = generateTestToken({
      userId: adminUser.user.id,
      role: 'teacher',
      username: adminUser.user.username,
      teacherId: adminUser.teacherId!,
      schoolId: schoolData.school.id
    })

    studentToken = generateTestToken({
      userId: studentUser.user.id,
      role: 'student',
      username: studentUser.user.username,
      studentId: studentUser.studentId!,
      schoolId: schoolData.school.id
    })

    outsiderToken = generateTestToken({
      userId: outsiderUser.user.id,
      role: 'teacher',
      username: outsiderUser.user.username,
      teacherId: outsiderUser.teacherId!,
      schoolId: schoolData.school.id
    })

    // 创建测试题目
    problem = await prisma.problem.create({
      data: {
        id: `makeup-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        platform: 'carits',
        problemId: `P_MAKEUP_${Date.now()}`,
        title: '补题作业测试题目',
        description: '测试描述',
        statementType: 'markdown',
        difficulty: '中等',
        timeLimit: 1000,
        memoryLimit: 262144,
        ownerId: ownerUser.user.id,
      }
    })

    // 创建已结束的训练（用于补题）
    const now = Date.now()
    finishedTraining = await prisma.training.create({
      data: {
        teamId: team.id,
        title: '已结束比赛',
        format: 'ioi',
        type: 'contest',
        startTime: new Date(now - 86400000 * 3),
        endTime: new Date(now - 86400000),
        status: 'finished',
        problemIdVisible: false,
        solutionVisible: false,
        includeAdminInRanking: false,
        createdBy: ownerUser.user.id
      }
    })

    // 添加题目到已结束训练（含快照）
    await prisma.trainingProblem.create({
      data: {
        id: `tp-finished-${finishedTraining.id}-0`,
        trainingId: finishedTraining.id,
        problemId: problem.id,
        alias: 'A',
        orderIndex: 0,
        points: 100,
        titleSnapshot: '题目标题快照',
        statementSnapshot: '题目描述快照',
        timeLimitSnapshot: 1000,
        memoryLimitSnapshot: 262144,
        judgeConfigSnapshot: '{}',
        allowedLanguagesSnapshot: 'cpp,cpp17',
        sourcePlatformSnapshot: 'carits',
        sourceProblemIdSnapshot: problem.problemId,
        sourceUrlSnapshot: 'https://example.com/problem/1',
        dataVersion: '1',
        snapshotCreatedAt: new Date()
      }
    })

    // 创建进行中的训练（不能创建补题）
    ongoingTraining = await prisma.training.create({
      data: {
        teamId: team.id,
        title: '进行中比赛',
        format: 'ioi',
        type: 'contest',
        startTime: new Date(now - 3600000),
        endTime: new Date(now + 3600000),
        status: 'ongoing',
        problemIdVisible: false,
        solutionVisible: false,
        includeAdminInRanking: false,
        createdBy: ownerUser.user.id
      }
    })
  })

  // ==================== A. 创建补题作业权限 ====================
  describe('创建补题作业权限', () => {
    it('A1: owner 可以创建补题作业', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.type).toBe('homework')
      expect(res.body.data.sourceTrainingId).toBe(finishedTraining.id)
      expect(res.body.data.title).toContain('补题练习')
    })

    it('A2: admin 可以创建补题作业', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, adminToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('A3: 学生不能创建补题作业', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(403)
    })

    it('A4: 非团队成员不能创建补题作业', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, outsiderToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(403)
    })
  })

  // ==================== B. 前置条件校验 ====================
  describe('前置条件校验', () => {
    it('B1: 进行中的训练不能创建补题作业', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${ongoingTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('已结束')
    })

    it('B2: 不存在的训练返回 404', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post('/api/trainings/999999/create-makeup-homework')
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(404)
    })

    it('B3: endTime 必填', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({})

      expect(res.status).toBe(400)
    })

    it('B4: endTime 必须晚于 startTime', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          startTime: new Date(Date.now() + 86400000 * 10).toISOString(),
          endTime: new Date(Date.now() + 86400000 * 5).toISOString()
        })

      expect(res.status).toBe(400)
    })
  })

  // ==================== C. 快照克隆验证 ====================
  describe('快照克隆验证', () => {
    it('C1: 补题作业包含原训练所有题目', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(200)
      expect(res.body.data.problemCount).toBe(1)

      // 验证 TrainingProblem 快照字段
      const makeupProblems = await prisma.trainingProblem.findMany({
        where: { trainingId: res.body.data.id }
      })
      expect(makeupProblems.length).toBe(1)
      expect(makeupProblems[0].alias).toBe('A')
      expect(makeupProblems[0].titleSnapshot).toBe('题目标题快照')
      expect(makeupProblems[0].timeLimitSnapshot).toBe(1000)
      expect(makeupProblems[0].memoryLimitSnapshot).toBe(262144)
      expect(makeupProblems[0].sourcePlatformSnapshot).toBe('carits')
      expect(makeupProblems[0].sourceProblemIdSnapshot).toBe(problem.problemId)
    })

    it('C2: 补题作业的 sourceTrainingId 正确', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.body.data.sourceTrainingId).toBe(finishedTraining.id)

      // 验证数据库
      const makeupTraining = await prisma.training.findUnique({
        where: { id: res.body.data.id }
      })
      expect(makeupTraining?.sourceTrainingId).toBe(finishedTraining.id)
    })

    it('C3: 补题作业 type 为 homework', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.body.data.type).toBe('homework')
    })

    it('C4: 补题作业 problemIdVisible 和 solutionVisible 为 true', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(200)
      // 验证数据库
      const makeupTraining = await prisma.training.findUnique({
        where: { id: res.body.data.id }
      })
      expect(makeupTraining?.problemIdVisible).toBe(true)
      expect(makeupTraining?.solutionVisible).toBe(true)
    })
  })

  // ==================== D. 自定义参数 ====================
  describe('自定义参数', () => {
    it('D1: 可自定义标题', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          title: '自定义补题标题',
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(200)
      expect(res.body.data.title).toBe('自定义补题标题')
    })

    it('D2: startTime 可设为过去时间', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          startTime: new Date(now - 86400000).toISOString(),
          endTime: new Date(now + 86400000 * 6).toISOString()
        })

      expect(res.status).toBe(200)
      // startTime 在过去，数据库中 status 应为 ongoing
      const makeupTraining = await prisma.training.findUnique({
        where: { id: res.body.data.id }
      })
      expect(makeupTraining?.status).toBe('ongoing')
    })

    it('D3: startTime 默认当前时间', async () => {
      const now = Date.now()
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      expect(res.status).toBe(200)
      // 默认 startTime = now，数据库中 status 应为 ongoing
      const makeupTraining = await prisma.training.findUnique({
        where: { id: res.body.data.id }
      })
      expect(makeupTraining?.status).toBe('ongoing')
    })
  })

  // ==================== E. 详情 API 返回 sourceTrainingId ====================
  describe('详情 API 返回 sourceTrainingId', () => {
    it('E1: 补题作业详情包含 sourceTrainingId', async () => {
      const now = Date.now()
      const createRes = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({
          endTime: new Date(now + 86400000 * 7).toISOString()
        })

      const makeupId = createRes.body.data.id

      const detailRes = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/trainings/${makeupId}`)

      expect(detailRes.status).toBe(200)
      expect(detailRes.body.data.sourceTrainingId).toBe(finishedTraining.id)
    })

    it('E2: 普通训练详情 sourceTrainingId 为 null', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/trainings/${finishedTraining.id}`)

      expect(res.status).toBe(200)
      expect(res.body.data.sourceTrainingId).toBeNull()
    })
  })
})
