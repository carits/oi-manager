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
import {
  createContestProblemTx,
  deleteContestProblemTx,
  reorderContestProblemsTx,
  updateContestProblemTx,
} from '../src/modules/contest/contest-command.service'

const app = createTestApp()

function createOrganizationRequest(token: string, organizationId: string) {
  const agent = createAuthenticatedRequest(app, token)
  return {
    get: (url: string) => agent.get(url).set('x-oi-organization-id', organizationId),
    post: (url: string) => agent.post(url).set('x-oi-organization-id', organizationId),
    put: (url: string) => agent.put(url).set('x-oi-organization-id', organizationId),
    delete: (url: string) => agent.delete(url).set('x-oi-organization-id', organizationId),
  }
}

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
    ownerUser = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
    adminUser = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
    memberUser = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
    studentUser = await createTestUser({ organization: { role: 'student', organizationId: schoolData.school.organizationId! } })

    team = await createTestTeam({
      organizationId: schoolData.school.organizationId!,
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

    ownerToken = generateTestToken({ userId: ownerUser.user.id, username: ownerUser.user.username, accountRole: 'user' })

    adminToken = generateTestToken({ userId: adminUser.user.id, username: adminUser.user.username, accountRole: 'user' })

    memberToken = generateTestToken({ userId: memberUser.user.id, username: memberUser.user.username, accountRole: 'user' })

    studentToken = generateTestToken({ userId: studentUser.user.id, username: studentUser.user.username, accountRole: 'user' })
  })

  it('CA1: owner 可以创建比赛', async () => {
    const res = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/contests`)
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
      .post(`/api/teams/${team.id}/contests`)
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
      .post(`/api/teams/${team.id}/contests`)
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
      .post(`/api/teams/${team.id}/contests`)
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
    ownerUser = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
    team = await createTestTeam({
      organizationId: schoolData.school.organizationId!,
      ownerId: ownerUser.user.id
    })
    ownerToken = generateTestToken({ userId: ownerUser.user.id, username: ownerUser.user.username, accountRole: 'user' })
  })

  it('CT1: 创建训练（type=training）', async () => {
    const res = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/contests`)
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
      .post(`/api/teams/${team.id}/contests`)
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

    await createContestRuntimeFixture({
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
      .get(`/api/teams/${team.id}/contests?type=contest`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    // 所有返回的都应该是 contest 类型
    res.body.data.forEach((item: any) => {
      expect(item.type).toBe('contest')
    })
  })

  it('CT4: 比赛开始和结束通过统一命令同步聚合、Rating 锁和终态', async () => {
    const created = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/contests`)
      .send({
        title: '生命周期比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString(),
      })

    expect(created.status).toBe(200)
    const contestId = created.body.data.id as number

    const started = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/contests/${contestId}/start`)
    expect(started.status).toBe(200)
    expect(started.body.data.status).toBe('ongoing')
    expect(started.body.data.title).toBe('生命周期比赛')

    const afterStart = await prisma.contest.findUniqueOrThrow({
      where: { publicId: contestId },
      include: { RatingConfig: true },
    })
    expect(afterStart.status).toBe('ongoing')
    expect(afterStart.RatingConfig?.lockedAt).not.toBeNull()

    const finished = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/contests/${contestId}/finish`)
    expect(finished.status).toBe(200)
    expect(finished.body.data.status).toBe('finished')
    expect(finished.body.data.finalizationStatus).toBe('JUDGING')

    const afterFinish = await prisma.contest.findUniqueOrThrow({
      where: { publicId: contestId },
    })
    expect(afterFinish.status).toBe('finished')
    expect(afterFinish.endAt).not.toBeNull()
    expect(afterFinish.finalizationStatus).toBe('JUDGING')
  })

  it('CT5: 比赛基本信息、赛制和结束时间通过统一命令同步', async () => {
    const created = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/contests`)
      .send({
        title: '待编辑比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString(),
      })

    expect(created.status).toBe(200)
    const contestId = created.body.data.id as number
    const renamedEndTime = new Date(Date.now() + 86400000 * 3)
    const updated = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .put(`/api/contests/${contestId}`)
      .send({ title: '已编辑比赛', format: 'ioi' })
    expect(updated.status).toBe(200)
    expect(updated.body.data.title).toBe('已编辑比赛')
    expect(updated.body.data.format).toBe('ioi')

    const extended = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .put(`/api/contests/${contestId}/end-time`)
      .send({ endTime: renamedEndTime.toISOString() })
    expect(extended.status).toBe(200)

    const aggregate = await prisma.contest.findUniqueOrThrow({
      where: { publicId: contestId },
      include: { RatingConfig: true },
    })
    expect(aggregate.title).toBe('已编辑比赛')
    expect(aggregate.format).toBe('ioi')
    expect(aggregate.endAt?.getTime()).toBe(renamedEndTime.getTime())
    expect(aggregate.RatingConfig?.track).toBe('IOI')
  })

  it('CT6: 删除未终结比赛会同时删除聚合和兼容运行时', async () => {
    const created = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/contests`)
      .send({
        title: '待删除比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString(),
      })

    expect(created.status).toBe(200)
    const contestId = created.body.data.id as number
    const aggregateBefore = await prisma.contest.findUniqueOrThrow({
      where: { publicId: contestId },
    })

    const deleted = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .delete(`/api/contests/${contestId}`)
    expect(deleted.status).toBe(200)
    expect(await prisma.training.findUnique({ where: { id: contestId } })).toBeNull()
    expect(await prisma.contest.findUnique({ where: { id: aggregateBefore.id } })).toBeNull()
  })

  it('CT7: 比赛题目的增改排序删除只通过统一命令同步', async () => {
    const created = await createOrganizationRequest(ownerToken, schoolData.school.organizationId!)
      .post(`/api/teams/${team.id}/contests`)
      .send({
        title: '题目命令比赛',
        format: 'oi',
        type: 'contest',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 86400000 * 2).toISOString(),
      })
    expect(created.status).toBe(200)
    const contestId = created.body.data.id as number
    const [problemA, problemB] = await Promise.all([
      createTestProblem({ ownerId: ownerUser.user.id, title: '命令题 A' }),
      createTestProblem({ ownerId: ownerUser.user.id, title: '命令题 B' }),
    ])

    const [runtimeA, runtimeB] = await prisma.$transaction(async tx => {
      const a = await createContestProblemTx(tx, contestId, {
        id: crypto.randomUUID(), problemId: problemA.id, alias: 'A', points: 40,
      })
      const b = await createContestProblemTx(tx, contestId, {
        id: crypto.randomUUID(), problemId: problemB.id, alias: 'B', points: 60,
      })
      return [a.problem!, b.problem!]
    })

    await prisma.$transaction(tx => updateContestProblemTx(tx, contestId, runtimeA.id, {
      alias: 'X', points: 50,
    }))
    await prisma.$transaction(tx => reorderContestProblemsTx(tx, contestId, [
      { id: runtimeB.id, orderIndex: 0 },
      { id: runtimeA.id, orderIndex: 1 },
    ]))

    const aggregateProblems = await prisma.contestProblem.findMany({
      where: { Contest: { publicId: contestId } },
      orderBy: { orderIndex: 'asc' },
    })
    expect(aggregateProblems.map(problem => [problem.id, problem.orderIndex]))
      .toEqual([[runtimeB.id, 0], [runtimeA.id, 1]])
    expect(aggregateProblems[1]).toMatchObject({ points: 50 })

    await prisma.$transaction(tx => deleteContestProblemTx(tx, contestId, runtimeA.id))
    expect(await prisma.contestProblem.findUnique({ where: { id: runtimeA.id } })).toBeNull()
  })
})
