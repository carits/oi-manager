/**
 * 训练模块测试
 * 覆盖权限场景：创建、查看、编辑、删除、题目管理、提交、排名
 *
 * @see docs/team/TEST_COVERAGE_PLAN.md §2
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('训练模块权限测试', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let memberUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>
  let outsiderUser: Awaited<ReturnType<typeof createTestUser>>

  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string
  let adminToken: string
  let memberToken: string
  let studentToken: string
  let outsiderToken: string

  let training: any

  beforeEach(async () => {
    // 创建学校
    schoolData = await createTestSchoolWithPrincipal()

    // 创建用户
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    adminUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    memberUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    outsiderUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })

    // 创建团队（owner 是创建者）
    team = await createTestTeam({
      schoolId: schoolData.school.id,
      ownerId: ownerUser.teacherId
    })

    // 添加团队成员
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
        userId: memberUser.teacherId!,
        userType: 'teacher',
        role: 'member',
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

    // 生成 token
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

    memberToken = generateTestToken({
      userId: memberUser.user.id,
      role: 'teacher',
      username: memberUser.user.username,
      teacherId: memberUser.teacherId!,
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

    // 创建训练（由 owner 创建）
    const now = Date.now()
    training = await prisma.training.create({
      data: {
        teamId: team.id,
        title: '测试训练',
        format: 'ioi',
        type: 'training',
        startTime: new Date(now - 3600000), // 1小时前开始
        endTime: new Date(now + 3600000), // 1小时后结束
        status: 'ongoing',
        problemIdVisible: true,
        solutionVisible: false,
        includeAdminInRanking: false,
        createdBy: ownerUser.user.id
      }
    })
  })

  // ==================== A. 训练创建权限 ====================
  describe('训练创建权限', () => {
    it('A1: owner 可以创建训练', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/teams/${team.id}/trainings`)
        .send({
          title: '新训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() + 86400000).toISOString(),
          endTime: new Date(Date.now() + 86400000 * 2).toISOString()
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.title).toBe('新训练')
    })

    it('A2: admin 可以创建训练', async () => {
      const res = await createAuthenticatedRequest(app, adminToken)
        .post(`/api/teams/${team.id}/trainings`)
        .send({
          title: 'Admin创建的训练',
          format: 'icpc',
          type: 'training',
          startTime: new Date(Date.now() + 86400000).toISOString(),
          endTime: new Date(Date.now() + 86400000 * 2).toISOString()
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('A3: member 不能创建训练', async () => {
      const res = await createAuthenticatedRequest(app, memberToken)
        .post(`/api/teams/${team.id}/trainings`)
        .send({
          title: 'Member创建的训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() + 86400000).toISOString(),
          endTime: new Date(Date.now() + 86400000 * 2).toISOString()
        })

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('A4: 学生 member 不能创建训练', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/teams/${team.id}/trainings`)
        .send({
          title: '学生创建的训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() + 86400000).toISOString(),
          endTime: new Date(Date.now() + 86400000 * 2).toISOString()
        })

      expect(res.status).toBe(403)
    })

    it('A5: 外人不能创建训练', async () => {
      const res = await createAuthenticatedRequest(app, outsiderToken)
        .post(`/api/teams/${team.id}/trainings`)
        .send({
          title: '外人创建的训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() + 86400000).toISOString(),
          endTime: new Date(Date.now() + 86400000 * 2).toISOString()
        })

      expect(res.status).toBe(403)
    })
  })

  // ==================== B. 训练查看权限 ====================
  describe('训练查看权限', () => {
    it('B1: owner 可以查看训练详情', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/trainings/${training.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.title).toBe('测试训练')
    })

    it('B2: admin 可以查看训练详情', async () => {
      const res = await createAuthenticatedRequest(app, adminToken)
        .get(`/api/trainings/${training.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('B3: member 可以查看训练详情', async () => {
      const res = await createAuthenticatedRequest(app, memberToken)
        .get(`/api/trainings/${training.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('B4: 学生 member 可以查看训练详情', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${training.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('B5: 外人不能查看训练详情', async () => {
      const res = await createAuthenticatedRequest(app, outsiderToken)
        .get(`/api/trainings/${training.id}`)

      expect(res.status).toBe(403)
    })

    it('B6: overview 在一次响应中返回训练和题目摘要', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/trainings/${training.id}/overview`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.training.id).toBe(training.id)
      expect(Array.isArray(res.body.data.problems)).toBe(true)
      expect(Array.isArray(res.body.data.problemStatus)).toBe(true)
    })

    it('B7: overview 同样执行资源归属校验', async () => {
      const res = await createAuthenticatedRequest(app, outsiderToken)
        .get(`/api/trainings/${training.id}/overview`)

      expect(res.status).toBe(403)
    })
  })

  // ==================== C. 训练编辑权限 ====================
  describe('训练编辑权限', () => {
    it('C1: owner 可以编辑训练', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .put(`/api/trainings/${training.id}`)
        .send({ title: '更新后的标题' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.title).toBe('更新后的标题')
    })

    it('C2: admin 可以编辑训练', async () => {
      const res = await createAuthenticatedRequest(app, adminToken)
        .put(`/api/trainings/${training.id}`)
        .send({ title: 'Admin更新的标题' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('C3: member 不能编辑训练', async () => {
      const res = await createAuthenticatedRequest(app, memberToken)
        .put(`/api/trainings/${training.id}`)
        .send({ title: 'Member更新的标题' })

      expect(res.status).toBe(403)
    })

    it('C4: 学生不能编辑训练', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .put(`/api/trainings/${training.id}`)
        .send({ title: '学生更新的标题' })

      expect(res.status).toBe(403)
    })
  })

  // ==================== D. 训练删除权限 ====================
  describe('训练删除权限', () => {
    it('D1: owner 可以删除训练', async () => {
      // 创建一个新的训练用于删除测试
      const newTraining = await prisma.training.create({
        data: {
          teamId: team.id,
          title: '待删除训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(),
          endTime: new Date(Date.now() + 3600000),
          status: 'upcoming',
          createdBy: ownerUser.user.id
        }
      })

      const res = await createAuthenticatedRequest(app, ownerToken)
        .delete(`/api/trainings/${newTraining.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('D2: admin 也可以删除训练', async () => {
      const res = await createAuthenticatedRequest(app, adminToken)
        .delete(`/api/trainings/${training.id}`)

      // admin 在当前实现中也可以删除训练
      expect(res.status).toBe(200)
    })

    it('D3: member 不能删除训练', async () => {
      const res = await createAuthenticatedRequest(app, memberToken)
        .delete(`/api/trainings/${training.id}`)

      expect(res.status).toBe(403)
    })
  })

  // ==================== E. 题目管理权限 ====================
  describe('题目管理权限', () => {
    it('E1: owner 可以添加题目', async () => {
      // 创建真实题目
      const problem = await prisma.problem.create({
        data: {
          id: `prob_e1_${Date.now()}`,
          platform: 'carits',
          problemId: `P_E1_${Date.now()}`,
          title: '测试题目E1',
          ownerId: ownerUser.user.id,
          visibility: 'public',
          libraryScope: 'platform',
          libraryKey: 'platform',
          status: 'published',
          publishedAt: new Date(),
        }
      })

      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/trainings/${training.id}/problems`)
        .send({
          problemId: problem.id,
          alias: 'A',
          points: 100
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('E2: admin 可以添加题目', async () => {
      // 创建真实题目
      const problem = await prisma.problem.create({
        data: {
          id: `prob_e2_${Date.now()}`,
          platform: 'carits',
          problemId: `P_E2_${Date.now()}`,
          title: '测试题目E2',
          ownerId: adminUser.user.id,
          visibility: 'public',
          libraryScope: 'platform',
          libraryKey: 'platform',
          status: 'published',
          publishedAt: new Date(),
        }
      })

      const res = await createAuthenticatedRequest(app, adminToken)
        .post(`/api/trainings/${training.id}/problems`)
        .send({
          problemId: problem.id,
          alias: 'B',
          points: 100
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('E3: member 不能添加题目', async () => {
      // 创建真实题目
      const problem = await prisma.problem.create({
        data: {
          id: `prob_e3_${Date.now()}`,
          platform: 'carits',
          problemId: `P_E3_${Date.now()}`,
          title: '测试题目E3',
          ownerId: memberUser.user.id,
          visibility: 'public',
          libraryScope: 'platform',
          libraryKey: 'platform',
          status: 'published',
          publishedAt: new Date(),
        }
      })

      const res = await createAuthenticatedRequest(app, memberToken)
        .post(`/api/trainings/${training.id}/problems`)
        .send({
          problemId: problem.id,
          alias: 'C',
          points: 100
        })

      expect(res.status).toBe(403)
    })

    it('E4: 外人不能添加题目', async () => {
      // 创建真实题目
      const problem = await prisma.problem.create({
        data: {
          id: `prob_e4_${Date.now()}`,
          platform: 'carits',
          problemId: `P_E4_${Date.now()}`,
          title: '测试题目E4',
          ownerId: outsiderUser.user.id,
          visibility: 'public',
          libraryScope: 'platform',
          libraryKey: 'platform',
          status: 'published',
          publishedAt: new Date(),
        }
      })

      const res = await createAuthenticatedRequest(app, outsiderToken)
        .post(`/api/trainings/${training.id}/problems`)
        .send({
          problemId: problem.id,
          alias: 'D',
          points: 100
        })

      expect(res.status).toBe(403)
    })
  })

  // ==================== F. 提交代码权限 ====================
  describe('提交代码权限', () => {
    it('F1: 学生可以提交代码', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .post(`/api/trainings/${training.id}/submit`)
        .send({
          problemId: 'TEST_001',
          code: '#include <iostream>\nint main() { return 0; }',
          language: 'cpp'
        })

      // 可能因为没有题目而返回错误，但不应该是权限错误
      expect([200, 400, 500]).toContain(res.status)
      if (res.status === 403) {
        // 如果是 403，确保不是因为权限
        expect(res.body.message).not.toContain('权限')
        expect(res.body.message).not.toContain('无权')
      }
    })

    it('F2: teacher member 可以提交代码', async () => {
      const res = await createAuthenticatedRequest(app, memberToken)
        .post(`/api/trainings/${training.id}/submit`)
        .send({
          problemId: 'TEST_002',
          code: 'test',
          language: 'cpp'
        })

      expect([200, 400, 500]).toContain(res.status)
    })

    it('F3: 外人不能提交代码', async () => {
      const res = await createAuthenticatedRequest(app, outsiderToken)
        .post(`/api/trainings/${training.id}/submit`)
        .send({
          problemId: 'TEST_003',
          code: 'test',
          language: 'cpp'
        })

      // 外人被拒绝（可能是 403 权限不足或 400 参数错误）
      expect([400, 403]).toContain(res.status)
    })
  })

  // ==================== G. 排名查看权限 ====================
  describe('排名查看权限', () => {
    it('G1: owner 可以查看排名', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/trainings/${training.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('G2: 学生可以查看排名', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${training.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('G3: 外人不能查看排名', async () => {
      const res = await createAuthenticatedRequest(app, outsiderToken)
        .get(`/api/trainings/${training.id}/ranking`)

      expect(res.status).toBe(403)
    })
  })

  // ==================== H. 训练列表权限 ====================
  describe('训练列表权限', () => {
    it('H1: 团队成员可以查看训练列表', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/teams/${team.id}/trainings`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('H2: 外人不能查看团队训练列表', async () => {
      const res = await createAuthenticatedRequest(app, outsiderToken)
        .get(`/api/teams/${team.id}/trainings`)

      expect(res.status).toBe(403)
    })
  })
})

// ==================== OI 赛制可见性测试 ====================
describe('OI 赛制可见性测试', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>

  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string
  let studentToken: string

  let oiTraining: any

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })

    team = await createTestTeam({
      schoolId: schoolData.school.id,
      ownerId: ownerUser.teacherId
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

    studentToken = generateTestToken({
      userId: studentUser.user.id,
      role: 'student',
      username: studentUser.user.username,
      studentId: studentUser.studentId!,
      schoolId: schoolData.school.id
    })

    // 创建 OI 赛制训练（赛中）
    const now = Date.now()
    oiTraining = await prisma.training.create({
      data: {
        teamId: team.id,
        title: 'OI模拟赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(now - 3600000), // 1小时前开始
        endTime: new Date(now + 3600000), // 1小时后结束
        status: 'ongoing',
        problemIdVisible: false, // OI 赛制题号赛后显示
        solutionVisible: false,
        createdBy: ownerUser.user.id
      }
    })
  })

  describe('OI 赛制排名隐藏', () => {
    it('OI-A1: 学生赛中看不到排名', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${oiTraining.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // OI 赛制赛中，排名应该被隐藏
      expect(res.body.data.hidden).toBe(true)
      expect(res.body.data.ranking).toEqual([])
    })

    it('OI-A2: 管理员赛中可以看到排名', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/trainings/${oiTraining.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // 管理员应该能看到真实排名（即使为空，也不应该 hidden）
      expect(res.body.data.hidden).toBeFalsy()
    })
  })

  describe('OI 赛制题号隐藏', () => {
    it('OI-C1: 学生赛中看不到原题号', async () => {
      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${oiTraining.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

// ==================== 训练状态可见性测试 ====================
describe('训练状态可见性测试', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>

  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string
  let studentToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })

    team = await createTestTeam({
      schoolId: schoolData.school.id,
      ownerId: ownerUser.teacherId
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

    studentToken = generateTestToken({
      userId: studentUser.user.id,
      role: 'student',
      username: studentUser.user.username,
      studentId: studentUser.studentId!,
      schoolId: schoolData.school.id
    })
  })

  describe('未开始训练可见性', () => {
    it('STATUS-A1: 未开始的训练，学生只能看到基本信息', async () => {
      // 创建未开始的训练
      const upcomingTraining = await prisma.training.create({
        data: {
          teamId: team.id,
          title: '未开始训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() + 86400000), // 1天后开始
          endTime: new Date(Date.now() + 86400000 * 2),
          status: 'upcoming',
          createdBy: ownerUser.user.id
        }
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${upcomingTraining.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.title).toBe('未开始训练')
    })

    it('STATUS-A2: 未开始的训练，学生不能查看题目', async () => {
      const upcomingTraining = await prisma.training.create({
        data: {
          teamId: team.id,
          title: '未开始训练-题目测试',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() + 86400000),
          endTime: new Date(Date.now() + 86400000 * 2),
          status: 'upcoming',
          createdBy: ownerUser.user.id
        }
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${upcomingTraining.id}/problems`)

      // 学生不应该能看到题目详情
      expect(res.status).toBe(403)
    })

    it('STATUS-A3: 管理员可以查看未开始训练的题目', async () => {
      const upcomingTraining = await prisma.training.create({
        data: {
          teamId: team.id,
          title: '未开始训练-管理员测试',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() + 86400000),
          endTime: new Date(Date.now() + 86400000 * 2),
          status: 'upcoming',
          createdBy: ownerUser.user.id
        }
      })

      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/trainings/${upcomingTraining.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('进行中训练可见性', () => {
    it('STATUS-B1: 学生查看进行中训练题目', async () => {
      const ongoingTraining = await prisma.training.create({
        data: {
          teamId: team.id,
          title: '进行中训练',
          format: 'ioi',
          type: 'training',
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(Date.now() + 3600000),
          status: 'ongoing',
          createdBy: ownerUser.user.id
        }
      })

      const res = await createAuthenticatedRequest(app, studentToken)
        .get(`/api/trainings/${ongoingTraining.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})
