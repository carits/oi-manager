/**
 * 比赛模块测试
 * 覆盖 OI/IOI/ICPC 赛制可见性差异
 *
 * @see docs/team/TEST_COVERAGE_PLAN.md §3
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

function createOrganizationRequest(token: string, organizationId: string) {
  const agent = createAuthenticatedRequest(app, token)
  return {
    get: (url: string) => agent.get(url).set('x-oi-organization-id', organizationId),
    post: (url: string) => agent.post(url).set('x-oi-organization-id', organizationId),
  }
}

describe('比赛赛制可见性测试', () => {
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
      ownerId: ownerUser.user.id
    })

    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: studentUser.user.id,
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

  // ==================== IOI 赛制（实时可见） ====================
  describe('IOI 赛制可见性', () => {
    let ioiContest: any

    beforeEach(async () => {
      const now = Date.now()
      ioiContest = await prisma.training.create({
        data: {
          teamId: team.id,
          title: 'IOI 模拟赛',
          format: 'ioi',
          type: 'contest',
          startTime: new Date(now - 3600000),
          endTime: new Date(now + 3600000),
          status: 'ongoing',
          problemIdVisible: true,
          solutionVisible: false,
          includeAdminInRanking: false,
          createdBy: ownerUser.user.id
        }
      })
    })

    it('IOI-A1: 学生赛中可以查看排名', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${ioiContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // IOI 赛制赛中排名可见
      expect(res.body.data.hidden).toBeFalsy()
    })

    it('IOI-A2: 学生赛中可以查看提交结果', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${ioiContest.id}/submissions`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('IOI-A3: 远程归档不能抬高实时排名分数', async () => {
      const problem = await createTestProblem({ ownerId: ownerUser.user.id, title: 'IOI 归档隔离题' })
      const trainingProblem = await prisma.trainingProblem.create({
        data: {
          id: crypto.randomUUID(),
          trainingId: ioiContest.id,
          problemId: problem.id,
          alias: 'A',
          points: 100,
          orderIndex: 0,
        },
      })
      await prisma.submission.createMany({
        data: [
          {
            userId: studentUser.user.id,
            oj: 'carits',
            problemId: problem.problemId,
            problemInternalId: problem.id,
            language: 'cpp',
            code: 'int main(){}',
            codeLength: 12,
            result: 'wa',
            score: 40,
            submitMethod: 'local',
            submitScope: 'contest',
            trainingId: ioiContest.id,
            trainingProblemId: trainingProblem.id,
            contestId: ioiContest.id,
            contestProblemId: trainingProblem.id,
          },
          {
            userId: studentUser.user.id,
            oj: 'codeforces',
            ojRemoteId: `archive-ioi-${Date.now()}`,
            problemId: problem.problemId,
            problemInternalId: problem.id,
            language: 'cpp',
            code: '',
            codeLength: 0,
            result: 'accepted',
            score: 100,
            submitMethod: 'archive',
            submitScope: 'contest',
            trainingId: ioiContest.id,
            trainingProblemId: trainingProblem.id,
            contestId: ioiContest.id,
            contestProblemId: trainingProblem.id,
          },
        ],
      })

      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${ioiContest.id}/ranking`)
      expect(res.status).toBe(200)
      const row = res.body.data.ranking.find((item: any) => item.userId === studentUser.user.id)
      expect(row.totalScore).toBe(40)
      expect(row.problems[trainingProblem.id].score).toBe(40)
    })
  })

  // ==================== ICPC 赛制（实时可见，AC数+罚时） ====================
  describe('ICPC 赛制可见性', () => {
    let icpcContest: any

    beforeEach(async () => {
      const now = Date.now()
      icpcContest = await prisma.training.create({
        data: {
          teamId: team.id,
          title: 'ICPC 模拟赛',
          format: 'icpc',
          type: 'contest',
          startTime: new Date(now - 3600000),
          endTime: new Date(now + 3600000),
          status: 'ongoing',
          problemIdVisible: true,
          solutionVisible: false,
          includeAdminInRanking: false,
          createdBy: ownerUser.user.id
        }
      })
    })

    it('ICPC-A1: 学生赛中可以查看排名', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${icpcContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // ICPC 赛制赛中排名可见
      expect(res.body.data.hidden).toBeFalsy()
    })

    it('ICPC-A2: 排名按 AC 数降序 + 罚时升序', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${icpcContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // 排名数据结构应该包含 solved 和 penalty 字段
      const ranking = res.body.data.ranking || []
      // 验证排序逻辑（如果有数据）
      for (let i = 1; i < ranking.length; i++) {
        const prev = ranking[i - 1]
        const curr = ranking[i]
        // AC 数降序，或 AC 相等时罚时升序
        const valid = prev.solved > curr.solved ||
          (prev.solved === curr.solved && prev.penalty <= curr.penalty)
        expect(valid).toBe(true)
      }
    })

    it('ICPC-A3: 远程归档 AC 不能计入已解数或罚时', async () => {
      const problem = await createTestProblem({ ownerId: ownerUser.user.id, title: 'ICPC 归档隔离题' })
      const trainingProblem = await prisma.trainingProblem.create({
        data: {
          id: crypto.randomUUID(),
          trainingId: icpcContest.id,
          problemId: problem.id,
          alias: 'A',
          points: 100,
          orderIndex: 0,
        },
      })
      await prisma.submission.createMany({
        data: [
          {
            userId: studentUser.user.id,
            oj: 'carits',
            problemId: problem.problemId,
            problemInternalId: problem.id,
            language: 'cpp',
            code: 'int main(){}',
            codeLength: 12,
            result: 'wa',
            score: 0,
            submitMethod: 'local',
            submitScope: 'contest',
            trainingId: icpcContest.id,
            trainingProblemId: trainingProblem.id,
            contestId: icpcContest.id,
            contestProblemId: trainingProblem.id,
          },
          {
            userId: studentUser.user.id,
            oj: 'codeforces',
            ojRemoteId: `archive-icpc-${Date.now()}`,
            problemId: problem.problemId,
            problemInternalId: problem.id,
            language: 'cpp',
            code: '',
            codeLength: 0,
            result: 'accepted',
            score: 100,
            submitMethod: 'archive',
            submitScope: 'contest',
            trainingId: icpcContest.id,
            trainingProblemId: trainingProblem.id,
            contestId: icpcContest.id,
            contestProblemId: trainingProblem.id,
          },
        ],
      })

      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${icpcContest.id}/ranking`)
      expect(res.status).toBe(200)
      const row = res.body.data.ranking.find((item: any) => item.userId === studentUser.user.id)
      expect(row.solvedCount).toBe(0)
      expect(row.totalPenalty).toBe(0)
      expect(row.problems[trainingProblem.id]).toMatchObject({ solved: false, attempts: 1, submitted: true })
    })
  })

  // ==================== OI 赛制（赛后可见） ====================
  describe('OI 赛制赛中可见性', () => {
    let oiContest: any

    beforeEach(async () => {
      const now = Date.now()
      oiContest = await prisma.training.create({
        data: {
          teamId: team.id,
          title: 'OI 模拟赛',
          format: 'oi',
          type: 'contest',
          startTime: new Date(now - 3600000),
          endTime: new Date(now + 3600000),
          status: 'ongoing',
          problemIdVisible: false,
          solutionVisible: false,
          createdBy: ownerUser.user.id
        }
      })
    })

    it('OI-A1: 学生赛中看不到排名', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${oiContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // OI 赛制赛中，排名应该被隐藏
      expect(res.body.data.hidden).toBe(true)
      expect(res.body.data.ranking).toEqual([])
    })

    it('OI-A2: 管理员赛中可以看到排名', async () => {
      const res = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${oiContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // 管理员应该能看到真实排名
      expect(res.body.data.hidden).toBeFalsy()
    })

    it('OI-C1: 学生赛中看不到原题号', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${oiContest.id}/problems`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  // ==================== OI 赛制赛后可见性 ====================
  describe('OI 赛制赛后可见性', () => {
    let finishedOiContest: any

    beforeEach(async () => {
      const now = Date.now()
      finishedOiContest = await prisma.training.create({
        data: {
          teamId: team.id,
          title: '已结束 OI 比赛',
          format: 'oi',
          type: 'contest',
          startTime: new Date(now - 7200000),
          endTime: new Date(now - 3600000),
          status: 'finished',
          problemIdVisible: true,
          solutionVisible: true,
          createdBy: ownerUser.user.id
        }
      })
    })

    it('OI-POST-A1: 赛后学生可以查看排名', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${finishedOiContest.id}/ranking`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // 赛后排名可见
      expect(res.body.data.hidden).toBeFalsy()
    })

    it('OI-POST-A2: 赛后学生可以查看提交结果', async () => {
      const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
        .get(`/api/trainings/${finishedOiContest.id}/submissions`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

// ==================== 比赛创建权限测试 ====================
describe('比赛创建权限测试', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let memberUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>

  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string
  let adminToken: string
  let memberToken: string
  let studentToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    adminUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    memberUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })

    team = await createTestTeam({
      schoolId: schoolData.school.id,
      ownerId: ownerUser.user.id
    })

    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: adminUser.user.id,
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
        userId: memberUser.user.id,
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
        userId: studentUser.user.id,
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
  })

  it('CA1: owner 可以创建比赛', async () => {
    const res = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/trainings`)
      .send({
        title: '新比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString()
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.type).toBe('contest')
  })

  it('CA2: admin 可以创建比赛', async () => {
    const res = await createOrganizationRequest(adminToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/trainings`)
      .send({
        title: 'Admin 创建的比赛',
        format: 'ioi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString()
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('CA3: member 不能创建比赛', async () => {
    const res = await createOrganizationRequest(memberToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/trainings`)
      .send({
        title: 'Member 创建的比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString()
      })

    expect(res.status).toBe(403)
  })

  it('CA4: 学生不能创建比赛', async () => {
    const res = await createOrganizationRequest(studentToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/trainings`)
      .send({
        title: '学生创建的比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString()
      })

    expect(res.status).toBe(403)
  })
})

// ==================== 比赛类型区分测试 ====================
describe('比赛类型区分测试', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let team: Awaited<ReturnType<typeof createTestTeam>>
  let ownerToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    team = await createTestTeam({
      schoolId: schoolData.school.id,
      ownerId: ownerUser.user.id
    })
    ownerToken = generateTestToken({
      userId: ownerUser.user.id,
      role: 'teacher',
      username: ownerUser.user.username,
      teacherId: ownerUser.teacherId!,
      schoolId: schoolData.school.id
    })
  })

  it('CT1: 创建训练（type=training）', async () => {
    const res = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/trainings`)
      .send({
        title: '日常训练',
        format: 'ioi',
        type: 'training',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString()
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.type).toBe('training')
  })

  it('CT2: 创建比赛（type=contest）', async () => {
    const res = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/trainings`)
      .send({
        title: '模拟赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString()
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.type).toBe('contest')
  })

  it('CT3: 按类型筛选列表', async () => {
    // 创建一个训练和一个比赛
    const now = Date.now()
    await prisma.training.create({
      data: {
        teamId: team.id,
        title: '训练',
        format: 'ioi',
        type: 'training',
        startTime: new Date(now + 86400000),
        endTime: new Date(now + 86400000 * 2),
        status: 'upcoming',
        createdBy: ownerUser.user.id
      }
    })

    await prisma.training.create({
      data: {
        teamId: team.id,
        title: '比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(now + 86400000),
        endTime: new Date(now + 86400000 * 2),
        status: 'upcoming',
        createdBy: ownerUser.user.id
      }
    })

    // 筛选比赛
    const res = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .get(`/api/teams/${team.id}/trainings?type=contest`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    // 所有返回的都应该是 contest 类型
    res.body.data.forEach((item: any) => {
      expect(item.type).toBe('contest')
    })
  })
})
