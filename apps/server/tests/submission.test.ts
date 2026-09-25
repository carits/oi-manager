/**
 * 提交记录模块测试
 * 覆盖学校数据隔离、提交详情权限、训练提交隔离
 *
 * @see docs/team/TEST_COVERAGE_PLAN.md §4
 */

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchool, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

function organizationRequest(token: string, organizationId: string) {
  return createAuthenticatedRequest(app, token, { organizationId })
}

async function attachFinalizedJudgeRun(submissionId: number, result: string, data: {
  score?: number | null
  cases?: string | null
  subtasks?: string | null
  errorMessage?: string | null
  timeUsed?: number | null
  wallTimeUsed?: number | null
  memoryUsed?: number | null
  metricSource?: string | null
} = {}) {
  const run = await prisma.judgeRun.create({
    data: {
      id: crypto.randomUUID(), submissionId, runNumber: 1, runType: 'NORMAL', status: 'FINALIZED', result,
      score: data.score ?? null, cases: data.cases ?? null, subtasks: data.subtasks ?? null,
      errorMessage: data.errorMessage ?? null, timeUsed: data.timeUsed ?? null,
      wallTimeUsed: data.wallTimeUsed ?? null, memoryUsed: data.memoryUsed ?? null,
      metricSource: data.metricSource ?? 'submission-test', finalizedAt: new Date(),
    },
  })
  await prisma.submission.update({ where: { id: submissionId }, data: { currentJudgeRunId: run.id } })
  return run
}

describe('提交记录学校数据隔离', () => {
  let schoolA: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let schoolB: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let teacherA: Awaited<ReturnType<typeof createTestUser>>
  let teacherB: Awaited<ReturnType<typeof createTestUser>>
  let studentA: Awaited<ReturnType<typeof createTestUser>>
  let studentB: Awaited<ReturnType<typeof createTestUser>>
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>

  let teacherAToken: string
  let teacherBToken: string
  let studentAToken: string
  let superAdminToken: string

  let submissionA: any
  let submissionB: any
  let submissionSameUserOtherOrganization: any

  beforeEach(async () => {
    // 创建两个学校
    schoolA = await createTestSchoolWithPrincipal('学校A')
    schoolB = await createTestSchoolWithPrincipal('学校B')

    // 创建用户
    teacherA = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.school.organizationId! } })
    teacherB = await createTestUser({ organization: { role: 'teacher', organizationId: schoolB.school.organizationId! } })
    studentA = await createTestUser({ organization: { role: 'student', organizationId: schoolA.school.organizationId! } })
    studentB = await createTestUser({ organization: { role: 'student', organizationId: schoolB.school.organizationId! } })
    superAdmin = await createTestUser({ accountRole: 'super_admin' })

    const secondMembershipId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: secondMembershipId,
        organizationId: schoolB.school.organizationId!,
        userId: studentA.user.id,
        memberRole: 'student',
        relationType: 'student',
        status: 'active',
        joinedAt: new Date(),
      },
    })
    await prisma.organizationStudentProfile.create({
      data: { id: crypto.randomUUID(), membershipId: secondMembershipId, name: '跨校学生', status: 'active' },
    })

    // 生成 Token
    teacherAToken = generateTestToken({ userId: teacherA.user.id, username: teacherA.user.username, accountRole: 'user' })

    teacherBToken = generateTestToken({ userId: teacherB.user.id, username: teacherB.user.username, accountRole: 'user' })

    studentAToken = generateTestToken({ userId: studentA.user.id, username: studentA.user.username, accountRole: 'user' })

    superAdminToken = generateTestToken({ userId: superAdmin.user.id, username: superAdmin.user.username, accountRole: 'super_admin' })

    // 创建测试题目
    const problem = await prisma.problem.create({
      data: {
        id: `test_problem_${Date.now()}`,
        platform: 'carits',
        problemId: `P${Date.now()}`,
        title: '测试题目',
        ownerId: teacherA.user.id,
        visibility: 'public',
        libraryScope: 'platform',
        libraryKey: 'platform',
        status: 'published',
        publishedAt: new Date(),
      }
    })

    // 创建提交记录
    const now = Date.now()
    submissionA = await prisma.submission.create({
      data: {
        userId: studentA.user.id,
        organizationId: schoolA.school.organizationId,
        problemId: problem.id,
        oj: 'carits',
        language: 'cpp',
        code: 'int main() { return 0; }',
        codeLength: 24,
        submitMethod: 'standard',
        submitScope: 'problem',
        isGlobalVisible: true
      }
    })

    submissionB = await prisma.submission.create({
      data: {
        userId: studentB.user.id,
        organizationId: schoolB.school.organizationId,
        problemId: problem.id,
        oj: 'carits',
        language: 'cpp',
        code: 'int main() { return 1; }',
        codeLength: 24,
        submitMethod: 'standard',
        submitScope: 'problem',
        isGlobalVisible: true
      }
    })

    submissionSameUserOtherOrganization = await prisma.submission.create({
      data: {
        userId: studentA.user.id,
        organizationId: schoolB.school.organizationId,
        problemId: problem.id,
        oj: 'carits',
        language: 'cpp',
        code: 'int main() { return 2; }',
        codeLength: 24,
        submitMethod: 'standard',
        submitScope: 'problem',
        isGlobalVisible: true,
      },
    })
  })

  it('S1: 教师可以查看本校学生提交', async () => {
    const res = await organizationRequest(teacherAToken, schoolA.school.organizationId!)
      .get('/api/submissions')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // 本校学生的提交应该在列表中
    const submissions = res.body.data.submissions || res.body.data || []
    const hasSubmissionA = submissions.some((s: any) => s.id === submissionA.id)
    expect(hasSubmissionA).toBe(true)
  })

  it('S2: 教师不能查看外校学生提交', async () => {
    const res = await organizationRequest(teacherAToken, schoolA.school.organizationId!)
      .get('/api/submissions')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // 外校学生的提交不应该在列表中
    const submissions = res.body.data.submissions || res.body.data || []
    const hasSubmissionB = submissions.some((s: any) => s.id === submissionB.id)
    expect(hasSubmissionB).toBe(false)
    expect(submissions.some((s: any) => s.id === submissionSameUserOtherOrganization.id)).toBe(false)
  })

  it('S3: 学生可以查看本校提交', async () => {
    const res = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .get('/api/submissions')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // 本校学生的提交应该在列表中
    const submissions = res.body.data.submissions || res.body.data || []
    const hasSubmissionA = submissions.some((s: any) => s.id === submissionA.id)
    expect(hasSubmissionA).toBe(true)
  })

  it('S4: 学生不能查看外校提交', async () => {
    const res = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .get('/api/submissions')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // 外校学生的提交不应该在列表中
    const submissions = res.body.data.submissions || res.body.data || []
    const hasSubmissionB = submissions.some((s: any) => s.id === submissionB.id)
    expect(hasSubmissionB).toBe(false)
    expect(submissions.some((s: any) => s.id === submissionSameUserOtherOrganization.id)).toBe(false)
  })

  it('S4.1: 多校园用户不能在当前校园读取自己另一校园的提交详情', async () => {
    const res = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .get(`/api/submissions/${submissionSameUserOtherOrganization.id}`)

    expect(res.status).toBe(404)
  })

  it('S5: 超管可以查看所有提交', async () => {
    const res = await createAuthenticatedRequest(app, superAdminToken)
      .get('/api/submissions')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // 超管应该能看到所有提交
    const submissions = res.body.data.submissions || res.body.data || []
    const hasSubmissionA = submissions.some((s: any) => s.id === submissionA.id)
    const hasSubmissionB = submissions.some((s: any) => s.id === submissionB.id)
    expect(hasSubmissionA).toBe(true)
    expect(hasSubmissionB).toBe(true)
  })

  it('S6: 校园用户不能通过通用接口重评其他用户或其他组织的提交', async () => {
    const teacherRes = await organizationRequest(teacherAToken, schoolA.school.organizationId!)
      .post('/api/submit/rejudge')
      .send({ submissionId: submissionA.id })
    expect(teacherRes.status).toBe(404)

    const crossOrganizationRes = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .post('/api/submit/rejudge')
      .send({ submissionId: submissionSameUserOtherOrganization.id })
    expect(crossOrganizationRes.status).toBe(404)
  })

})

describe('提交详情权限', () => {
  let schoolA: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let schoolB: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let teacherA: Awaited<ReturnType<typeof createTestUser>>
  let studentA: Awaited<ReturnType<typeof createTestUser>>
  let studentB: Awaited<ReturnType<typeof createTestUser>>
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>

  let teacherAToken: string
  let studentAToken: string
  let studentBToken: string
  let superAdminToken: string

  let submissionA: any

  beforeEach(async () => {
    schoolA = await createTestSchoolWithPrincipal('学校A')
    schoolB = await createTestSchoolWithPrincipal('学校B')

    teacherA = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.school.organizationId! } })
    studentA = await createTestUser({ organization: { role: 'student', organizationId: schoolA.school.organizationId! } })
    studentB = await createTestUser({ organization: { role: 'student', organizationId: schoolB.school.organizationId! } })
    superAdmin = await createTestUser({ accountRole: 'super_admin' })

    teacherAToken = generateTestToken({ userId: teacherA.user.id, username: teacherA.user.username, accountRole: 'user' })

    studentAToken = generateTestToken({ userId: studentA.user.id, username: studentA.user.username, accountRole: 'user' })

    studentBToken = generateTestToken({ userId: studentB.user.id, username: studentB.user.username, accountRole: 'user' })

    superAdminToken = generateTestToken({ userId: superAdmin.user.id, username: superAdmin.user.username, accountRole: 'super_admin' })

    const problem = await prisma.problem.create({
      data: {
        id: `test_problem_${Date.now()}`,
        platform: 'carits',
        problemId: `P${Date.now()}`,
        title: '测试题目',
        ownerId: teacherA.user.id,
        visibility: 'public',
        libraryScope: 'platform',
        libraryKey: 'platform',
        status: 'published',
        publishedAt: new Date(),
      }
    })

    const now = Date.now()
    submissionA = await prisma.submission.create({
      data: {
        userId: studentA.user.id,
        organizationId: schoolA.school.organizationId,
        problemId: problem.problemId,
        problemInternalId: problem.id,
        oj: 'carits',
        language: 'cpp',
        code: '#include <iostream>\nint main() { std::cout << "Hello"; return 0; }',
        codeLength: 65,
        submitMethod: 'standard',
        submitScope: 'problem',
        isGlobalVisible: true
      }
    })
  })

  it('D1: 学生可以查看自己的提交详情', async () => {
    const res = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .get(`/api/submissions/${submissionA.id}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.code).toBeDefined()
    // Local submissions without a JudgeRun are inconsistent legacy fixtures:
    // the read model must fail closed instead of trusting mutable Submission
    // result columns. D1.1 below covers the valid CurrentJudgeRun projection.
    expect(res.body.data.result).toBe('system_error')
    expect(res.body.data.errorMessage).toBe('本地评测记录缺少 JudgeRun，请联系管理员')
    expect(res.body.data).toMatchObject({
      sourcePlatform: 'carits',
      sourceProblemId: submissionA.problemId,
    })
  })

  it('D1.1: 全局列表、筛选与详情优先读取 CurrentJudgeRun', async () => {
    const runId = crypto.randomUUID()
    await prisma.judgeRun.create({
      data: {
        id: runId,
        submissionId: submissionA.id,
        runNumber: 1,
        runType: 'NORMAL',
        status: 'FINALIZED',
        result: 'accepted',
        score: 100,
        cases: JSON.stringify([{ result: 'accepted', time: 23, memory: 4096 }]),
        timeUsed: 23,
        wallTimeUsed: 25,
        memoryUsed: 4096,
        metricSource: 'switch-read-test',
        finalizedAt: new Date(),
      },
    })
    await prisma.submission.update({
      where: { id: submissionA.id },
      data: { currentJudgeRunId: runId },
    })

    const accepted = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .get('/api/submissions?result=accepted')
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body.data.submissions).toContainEqual(expect.objectContaining({
      id: submissionA.id,
      result: 'accepted',
      score: 100,
      timeUsed: 23,
      memoryUsed: 4096,
    }))

    const compatibility = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .get('/api/submissions?result=wa')
    expect(compatibility.status).toBe(200)
    expect(compatibility.body.data.submissions.some((item: any) => item.id === submissionA.id)).toBe(false)

    const detail = await organizationRequest(studentAToken, schoolA.school.organizationId!)
      .get(`/api/submissions/${submissionA.id}`)
    expect(detail.status, JSON.stringify(detail.body)).toBe(200)
    expect(detail.body.data).toMatchObject({
      result: 'accepted',
      score: 100,
      cases: [{ result: 'accepted', time: 23, memory: 4096 }],
      timeUsed: 23,
      wallTimeUsed: 25,
      memoryUsed: 4096,
      metricSource: 'switch-read-test',
    })
  })

  it('D2: 教师可以查看同校学生提交详情', async () => {
    const res = await organizationRequest(teacherAToken, schoolA.school.organizationId!)
      .get(`/api/submissions/${submissionA.id}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.code).toBeDefined()
  })

  it('D3: 外校用户不能查看提交详情', async () => {
    const res = await organizationRequest(studentBToken, schoolB.school.organizationId!)
      .get(`/api/submissions/${submissionA.id}`)

    expect(res.status).toBe(404)
  })

  it('D4: 超管可以查看任意提交详情', async () => {
    const res = await createAuthenticatedRequest(app, superAdminToken)
      .get(`/api/submissions/${submissionA.id}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.code).toBeDefined()
  })
})

describe('个人工作区提交详情权限', () => {
  it.each(['teacher', 'school_principal'] as const)('%s 在个人工作区只能查看自己的提交详情', async role => {
    const school = await createTestSchool({ name: `个人工作区-${role}` })
    const owner = await createTestUser({ organization: { role: role, organizationId: school.organizationId! } })
    const other = await createTestUser({ organization: { role: role, organizationId: school.organizationId! } })
    const ownerToken = generateTestToken({ userId: owner.user.id, username: owner.user.username, workspaceMode: 'personal', accountRole: owner.user.accountRole })

    const createPersonalSubmission = async (userId: string, problemId: string) => {
      const submission = await prisma.submission.create({ data: {
        userId,
        organizationId: null,
        workspaceScope: 'personal',
        problemId,
        oj: 'carits',
        language: 'cpp',
        code: 'int main() { return 0; }',
        codeLength: 24,
        submitMethod: 'local',
        submitScope: 'problem',
        isGlobalVisible: true,
      } })
      await attachFinalizedJudgeRun(submission.id, 'accepted', { score: 100 })
      return submission
    }
    const ownSubmission = await createPersonalSubmission(owner.user.id, `PERSONAL-${role}-OWN`)
    const otherSubmission = await createPersonalSubmission(other.user.id, `PERSONAL-${role}-OTHER`)

    const list = await createAuthenticatedRequest(app, ownerToken).get('/api/submissions')
    expect(list.status, JSON.stringify(list.body)).toBe(200)
    expect(list.body.data.submissions).toContainEqual(expect.objectContaining({ id: ownSubmission.id }))
    expect(list.body.data.submissions.some((submission: any) => submission.id === otherSubmission.id)).toBe(false)

    const ownDetail = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/submissions/${ownSubmission.id}`)
    expect(ownDetail.status, JSON.stringify(ownDetail.body)).toBe(200)
    expect(ownDetail.body.data).toMatchObject({
      id: ownSubmission.id,
      username: owner.user.username,
      result: 'accepted',
    })

    const otherDetail = await createAuthenticatedRequest(app, ownerToken)
      .get(`/api/submissions/${otherSubmission.id}`)
    expect(otherDetail.status).toBe(404)
    expect(otherDetail.body.code).toBe('SUBMISSION_NOT_FOUND')
  })
})

describe('训练提交隔离', () => {
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let studentUser: Awaited<ReturnType<typeof createTestUser>>

  let team: Awaited<ReturnType<typeof createTestTeam>>
  let training: any
  let trainingProblem: any
  let trainingSubmission: any
  let problemSubmission: any

  let ownerToken: string
  let studentToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
    studentUser = await createTestUser({ organization: { role: 'student', organizationId: schoolData.school.organizationId! } })

    team = await createTestTeam({
      organizationId: schoolData.school.organizationId!,
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

    ownerToken = generateTestToken({ userId: ownerUser.user.id, username: ownerUser.user.username, accountRole: 'user' })

    studentToken = generateTestToken({ userId: studentUser.user.id, username: studentUser.user.username, accountRole: 'user' })

    // 创建题目
    const problem = await prisma.problem.create({
      data: {
        id: `test_problem_${Date.now()}`,
        platform: 'carits',
        problemId: `P${Date.now()}`,
        title: '测试题目',
        ownerId: ownerUser.user.id,
        visibility: 'public',
        libraryScope: 'platform',
        libraryKey: 'platform',
        status: 'published',
        publishedAt: new Date(),
      }
    })

    // 创建训练
    const now = Date.now()
    training = await prisma.training.create({
      data: {
        teamId: team.id,
        title: '测试训练',
        format: 'ioi',
        type: 'training',
        organizationId: schoolData.school.organizationId,
        startTime: new Date(now - 3600000),
        endTime: new Date(now + 3600000),
        status: 'ongoing',
        problemIdVisible: true,
        solutionVisible: false,
        includeAdminInRanking: false,
        createdBy: ownerUser.user.id
      }
    })

    // 创建训练题目
    trainingProblem = await prisma.trainingProblem.create({
      data: {
        id: `tp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        trainingId: training.id,
        problemId: problem.id,
        alias: 'A',
        orderIndex: 1,
        points: 100
      }
    })

    // 创建训练提交（submitScope: 'training'）
    trainingSubmission = await prisma.submission.create({
      data: {
        userId: studentUser.user.id,
        organizationId: schoolData.school.organizationId,
        problemId: problem.id,
        oj: 'carits',
        language: 'cpp',
        code: 'int main() { return 0; }',
        codeLength: 24,
        submitMethod: 'standard',
        submitScope: 'training',
        submitSource: 'training',
        sourceId: `training-${training.id}`,
        trainingId: training.id,
        trainingProblemId: trainingProblem.id,
        isGlobalVisible: false
      }
    })
    await attachFinalizedJudgeRun(trainingSubmission.id, 'accepted', {
      score: 100,
      cases: JSON.stringify([{ result: 'accepted', time: 100, memory: 1024 }]),
      timeUsed: 100,
      memoryUsed: 1024,
    })

    // 创建题库提交（submitScope: 'problem'）
    problemSubmission = await prisma.submission.create({
      data: {
        userId: studentUser.user.id,
        organizationId: schoolData.school.organizationId,
        problemId: problem.id,
        oj: 'carits',
        language: 'cpp',
        code: 'int main() { return 1; }',
        codeLength: 24,
        submitMethod: 'standard',
        submitScope: 'problem',
        isGlobalVisible: true
      }
    })
  })

  it('TI1: 全局详情端点也执行训练权限策略', async () => {
    await prisma.trainingProblem.update({
      where: { id: trainingProblem.id },
      data: {
        sourcePlatformSnapshot: 'codeforces',
        sourceProblemIdSnapshot: '1454E',
      },
    })
    const res = await organizationRequest(studentToken, schoolData.school.organizationId!)
      .get(`/api/submissions/${trainingSubmission.id}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: trainingSubmission.id,
      trainingId: training.id,
      result: 'accepted',
      sourcePlatform: 'codeforces',
      sourceProblemId: '1454E',
    })
  })

  it('TI1.0: 多校园用户不能在当前校园读取另一校园的活动提交详情', async () => {
    const secondSchool = await createTestSchoolWithPrincipal('训练提交第二校园')
    const membershipId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: secondSchool.school.organizationId!,
        userId: studentUser.user.id,
        memberRole: 'student',
        relationType: 'student',
        status: 'active',
        joinedAt: new Date(),
      },
    })
    await prisma.organizationStudentProfile.create({
      data: { id: crypto.randomUUID(), membershipId, name: '跨校训练学生', status: 'active' },
    })

    const wrongContext = await organizationRequest(studentToken, secondSchool.school.organizationId!)
      .get(`/api/submissions/${trainingSubmission.id}`)
    expect(wrongContext.status).toBe(404)

    const correctContext = await organizationRequest(studentToken, schoolData.school.organizationId!)
      .get(`/api/submissions/${trainingSubmission.id}`)
    expect(correctContext.status).toBe(200)
  })

  it('TI1.1: OI 赛中通过任意详情端点都不会泄露真实评测结果', async () => {
    await prisma.training.update({
      where: { id: training.id },
      data: { format: 'oi' },
    })

    for (const path of [
      `/api/submissions/${trainingSubmission.id}`,
      `/api/contests/${training.id}/submissions/${trainingSubmission.id}`,
    ]) {
      const res = await organizationRequest(studentToken, schoolData.school.organizationId!).get(path)
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200)
      expect(res.body.data).toMatchObject({
        id: trainingSubmission.id,
        hidden: true,
        displayResult: 'pending',
        result: null,
        score: null,
        timeUsed: null,
        memoryUsed: null,
        cases: null,
        subtasks: null,
        ojRemoteId: null,
        errorMessage: null,
      })
    }
  })

  it('TI2: 训练提交可以通过训练端点访问', async () => {
    const res = await organizationRequest(studentToken, schoolData.school.organizationId!)
      .get(`/api/contests/${training.id}/submissions`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // 训练提交应该在列表中
    const submissions = res.body.data.submissions || []
    const hasTrainingSubmission = submissions.some((s: any) => s.id === trainingSubmission.id)
    expect(hasTrainingSubmission).toBe(true)
  })

  it('TI2.1: 没有测试点明细的终态提交仍可查看详情', async () => {
    const relation = await prisma.trainingProblem.findUniqueOrThrow({
      where: { id: trainingProblem.id },
      include: { Problem: true },
    })
    const submission = await prisma.submission.create({
      data: {
        userId: studentUser.user.id,
        organizationId: schoolData.school.organizationId,
        problemId: relation.Problem.problemId,
        oj: 'carits',
        language: 'cpp',
        code: 'int main() { while (true) {} }',
        codeLength: 31,
        submitMethod: 'standard',
        submitScope: 'training',
        submitSource: 'training',
        trainingId: training.id,
        trainingProblemId: trainingProblem.id,
        isGlobalVisible: false,
      },
    })
    await attachFinalizedJudgeRun(submission.id, 'ole', {
      score: 0,
      errorMessage: 'output limit exceeded',
    })

    const listRes = await organizationRequest(ownerToken, schoolData.school.organizationId!)
      .get(`/api/contests/${training.id}/submissions`)
    expect(listRes.status, JSON.stringify(listRes.body)).toBe(200)
    const listItem = listRes.body.data.submissions.find((item: any) => item.id === submission.id)
    expect(listItem).toMatchObject({ result: 'ole', trainingProblemId: trainingProblem.id })

    const detailRes = await organizationRequest(ownerToken, schoolData.school.organizationId!)
      .get(`/api/contests/${training.id}/submissions/${submission.id}`)
    expect(detailRes.status).toBe(200)
    expect(detailRes.body.data).toMatchObject({
      result: 'ole',
      errorMessage: 'output limit exceeded',
      trainingProblemId: trainingProblem.id,
      cases: null,
    })
  })

  it('TI2.2: 列表、详情、筛选和排名统一从 CurrentJudgeRun 读取', async () => {
    const relation = await prisma.trainingProblem.findUniqueOrThrow({
      where: { id: trainingProblem.id },
      include: { Problem: true },
    })
    const runCases = JSON.stringify([{ result: 'accepted', time: 17, memory: 2048 }])
    const runSubtasks = JSON.stringify([{ id: 1, score: 100 }])
    const current = await prisma.submission.findUniqueOrThrow({
      where: { id: trainingSubmission.id },
      select: { currentJudgeRunId: true },
    })
    await prisma.judgeRun.update({
      where: { id: current.currentJudgeRunId! },
      data: {
        result: 'accepted',
        score: 100,
        cases: runCases,
        subtasks: runSubtasks,
        timeUsed: 17,
        wallTimeUsed: 19,
        memoryUsed: 2048,
        metricSource: 'switch-read-test',
        finalizedAt: new Date(),
      },
    })
    await prisma.submission.update({
      where: { id: trainingSubmission.id },
      data: { problemId: relation.Problem.problemId },
    })

    const acceptedList = await organizationRequest(ownerToken, schoolData.school.organizationId!)
      .get(`/api/contests/${training.id}/submissions?result=accepted`)
    expect(acceptedList.status, JSON.stringify(acceptedList.body)).toBe(200)
    expect(acceptedList.body.data.submissions).toContainEqual(expect.objectContaining({
      id: trainingSubmission.id,
      result: 'accepted',
      score: 100,
      timeUsed: 17,
      memoryUsed: 2048,
    }))

    const compatibilityFilter = await organizationRequest(ownerToken, schoolData.school.organizationId!)
      .get(`/api/contests/${training.id}/submissions?result=wa`)
    expect(compatibilityFilter.status).toBe(200)
    expect(compatibilityFilter.body.data.submissions.some((item: any) => item.id === trainingSubmission.id)).toBe(false)

    const detail = await organizationRequest(ownerToken, schoolData.school.organizationId!)
      .get(`/api/contests/${training.id}/submissions/${trainingSubmission.id}`)
    expect(detail.status, JSON.stringify(detail.body)).toBe(200)
    expect(detail.body.data).toMatchObject({
      result: 'accepted',
      score: 100,
      cases: [{ result: 'accepted', time: 17, memory: 2048 }],
      subtasks: [{ id: 1, score: 100 }],
      timeUsed: 17,
      wallTimeUsed: 19,
      memoryUsed: 2048,
      metricSource: 'switch-read-test',
    })

    const ranking = await organizationRequest(ownerToken, schoolData.school.organizationId!)
      .get(`/api/contests/${training.id}/ranking`)
    expect(ranking.status, JSON.stringify(ranking.body)).toBe(200)
    const studentRow = ranking.body.data.ranking.find((item: any) => item.userId === studentUser.user.id)
    expect(studentRow).toMatchObject({ totalScore: 100 })
    expect(studentRow.problems[trainingProblem.id]).toMatchObject({ score: 100, submitted: true })
  })

  it('TI3: 全局提交列表排除训练提交', async () => {
    const res = await organizationRequest(studentToken, schoolData.school.organizationId!)
      .get('/api/submissions')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const submissions = res.body.data.submissions || res.body.data || []

    // 训练提交不应该在全局列表中
    const hasTrainingSubmission = submissions.some((s: any) => s.id === trainingSubmission.id)
    expect(hasTrainingSubmission).toBe(false)

    // 题库提交应该在全局列表中
    const hasProblemSubmission = submissions.some((s: any) => s.id === problemSubmission.id)
    expect(hasProblemSubmission).toBe(true)
  })
})
