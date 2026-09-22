import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import { processDueAssignments, syncAssignmentSubmission } from '../src/modules/assignment/assignment.service'
import { applyAssignmentMigration, inspectAssignmentMigration } from '../src/modules/maintenance/application/assignment-migration.service'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createTestApp()
const directories: string[] = []

async function configuredProblem(ownerId: string) {
  const id = crypto.randomUUID()
  const root = path.join(process.cwd(), 'testdata', id)
  directories.push(root)
  await fs.promises.mkdir(root, { recursive: true })
  await fs.promises.writeFile(path.join(root, '1.in'), '1 2\n')
  await fs.promises.writeFile(path.join(root, '1.out'), '3\n')
  const judgeConfig = 'mode: acm\ncases:\n  - input: 1.in\n    output: 1.out\n'
  const problem = await prisma.problem.create({ data: {
    id, platform: 'carits', problemId: `AS-${id.slice(0, 8)}`, title: '独立作业题目', ownerId,
    visibility: 'public', libraryScope: 'platform', libraryKey: 'platform', status: 'published', judgeConfig,
  } })
  for (const [filename, content] of [['1.in', '1 2\n'], ['1.out', '3\n']]) {
    await prisma.testdataFile.create({ data: { id: crypto.randomUUID(), problemId: id, filename, size: Buffer.byteLength(content), md5: crypto.createHash('md5').update(content).digest('hex'), sha256: crypto.createHash('sha256').update(content).digest('hex') } })
  }
  await ensureInitialTestSetRevision(id, ownerId)
  return problem
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true })))
})

describe('independent assignment domain', () => {
  let teacher: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let outsider: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof configuredProblem>>
  let organizationId: string

  beforeEach(async () => {
    teacher = await createTestUser({ organization: { role: 'teacher' } })
    student = await createTestUser({ organization: { role: 'student', organizationId: teacher.organization!.organizationId } })
    outsider = await createTestUser({ organization: { role: 'student' } })
    organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: teacher.organization!.organizationId! } })).organizationId!
    problem = await configuredProblem(teacher.user.id)
  })

  it('creates a draft, pins revisions and atomically publishes a recipient snapshot', async () => {
    const token = generateTokenFromUser(teacher.user)
    const now = Date.now()
    const created = await createAuthenticatedRequest(app, token).post('/api/assignments').send({
      organizationId, title: '版本固定作业', rosterMode: 'SNAPSHOT',
      openAt: new Date(now + 60_000), dueAt: new Date(now + 3_600_000), closeAt: new Date(now + 7_200_000),
    })
    expect(created.status).toBe(201)
    const assignmentId = created.body.data.id
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const withProblems = await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({
      expectedRevision: 0,
      problems: [{ problemId: problem.id, testSetRevisionId: revision.id, maxScore: 100, targetScore: 100 }],
    })
    expect(withProblems.status).toBe(200)
    expect(withProblems.body.data.Problems[0].testSetRevisionId).toBe(revision.id)
    const roster = await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/roster`).send({ expectedRevision: 1, userIds: [student.user.id] })
    expect(roster.status).toBe(200)
    const published = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/publish`).send({ expectedRevision: 2 })
    expect(published.status).toBe(200)
    expect(published.body.data.status).toBe('SCHEDULED')
    const dashboardList = await createAuthenticatedRequest(app, token).get(`/api/assignments?organizationId=${organizationId}&pageSize=1`)
    expect(dashboardList.status).toBe(200)
    expect(dashboardList.body.data.statusCounts.SCHEDULED).toBeGreaterThanOrEqual(1)
    expect(dashboardList.body.data.pagination.total).toBeGreaterThanOrEqual(1)
    const activeList = await createAuthenticatedRequest(app, token).get(`/api/assignments?organizationId=${organizationId}&statusGroup=active&pageSize=1`)
    expect(activeList.status).toBe(200)
    expect(activeList.body.data.items.some((item: any) => item.id === assignmentId)).toBe(true)
    const draftList = await createAuthenticatedRequest(app, token).get(`/api/assignments?organizationId=${organizationId}&statusGroup=draft&pageSize=20`)
    expect(draftList.status).toBe(200)
    expect(draftList.body.data.items.some((item: any) => item.id === assignmentId)).toBe(false)
    expect(await prisma.assignmentProblemProgress.count({ where: { assignmentId } })).toBe(1)
    const frozen = await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({ expectedRevision: 3, problems: [] })
    expect(frozen.status).toBe(409)
    expect(frozen.body.code).toBe('ASSIGNMENT_FROZEN')
    expect((await createAuthenticatedRequest(app, generateTokenFromUser(student.user)).get(`/api/assignments/${assignmentId}`)).status).toBe(200)
    expect((await createAuthenticatedRequest(app, generateTokenFromUser(outsider.user)).get(`/api/assignments/${assignmentId}`)).status).toBe(404)
    const peerTeacher = await createTestUser({ organization: { role: 'teacher', organizationId: teacher.organization!.organizationId } })
    const peerList = await createAuthenticatedRequest(app, generateTokenFromUser(peerTeacher.user)).get(`/api/assignments?organizationId=${organizationId}`)
    expect(peerList.status).toBe(200)
    expect(peerList.body.data.items.some((item: any) => item.id === assignmentId)).toBe(false)
  })

  it('binds assignment list, create and direct-id access to the active organization context', async () => {
    const token = generateTokenFromUser(teacher.user)
    const secondOrgOwner = await createTestUser({ organization: { role: 'teacher' } })
    const secondOrganizationId = (await prisma.school.findUniqueOrThrow({
      where: { id: secondOrgOwner.organization!.organizationId! },
    })).organizationId!

    const membershipId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: secondOrganizationId,
        userId: teacher.user.id,
        memberRole: 'teacher',
        relationType: 'employee',
        status: 'active',
        joinedAt: new Date(),
        RoleAssignments: { create: { id: crypto.randomUUID(), roleKey: 'teacher', source: 'test_fixture' } },
      },
    })
    await prisma.organizationTeacherProfile.create({
      data: { id: crypto.randomUUID(), membershipId, name: '跨校作业教师', status: 'active' },
    })

    const now = Date.now()
    const secondOrgRequest = createAuthenticatedRequest(app, token, { organizationId: secondOrganizationId })
    const createdInSecondOrg = await secondOrgRequest.post('/api/assignments').send({
      organizationId: secondOrganizationId,
      title: '学校B作业',
      openAt: new Date(now + 60_000),
      dueAt: new Date(now + 120_000),
      closeAt: new Date(now + 180_000),
    })
    expect(createdInSecondOrg.status).toBe(201)
    const assignmentId = createdInSecondOrg.body.data.id as string

    const firstOrgRequest = createAuthenticatedRequest(app, token, { organizationId })
    const crossList = await firstOrgRequest.get(`/api/assignments?organizationId=${secondOrganizationId}`)
    expect(crossList.status).toBe(403)

    const crossCreate = await firstOrgRequest.post('/api/assignments').send({
      organizationId: secondOrganizationId,
      title: '不应创建到学校B',
      openAt: new Date(now + 60_000),
      dueAt: new Date(now + 120_000),
      closeAt: new Date(now + 180_000),
    })
    expect(crossCreate.status).toBe(403)

    const crossDirect = await firstOrgRequest.get(`/api/assignments/${assignmentId}`)
    expect(crossDirect.status).toBe(404)

    const correctContext = await secondOrgRequest.get(`/api/assignments/${assignmentId}`)
    expect(correctContext.status).toBe(200)
  })

  it('keeps scheduled assignments hidden from recipients until publishAt', async () => {
    const token = generateTokenFromUser(teacher.user)
    const studentToken = generateTokenFromUser(student.user)
    const now = Date.now()
    const created = await createAuthenticatedRequest(app, token).post('/api/assignments').send({
      organizationId,
      title: '延迟发布作业',
      publishAt: new Date(now + 30_000),
      openAt: new Date(now + 60_000),
      dueAt: new Date(now + 120_000),
      closeAt: new Date(now + 180_000),
    })
    const assignmentId = created.body.data.id
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({
      expectedRevision: 0,
      problems: [{ problemId: problem.id, testSetRevisionId: revision.id }],
    })
    await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/roster`).send({ expectedRevision: 1, userIds: [student.user.id] })
    await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/publish`).send({ expectedRevision: 2 })

    expect((await createAuthenticatedRequest(app, token).get(`/api/assignments/${assignmentId}`)).status).toBe(200)
    expect((await createAuthenticatedRequest(app, studentToken).get(`/api/assignments/${assignmentId}`)).status).toBe(404)
    expect((await createAuthenticatedRequest(app, studentToken).get(`/api/assignments/${assignmentId}/workspace`)).status).toBe(404)
    const hiddenList = await createAuthenticatedRequest(app, studentToken).get('/api/assignments')
    expect(hiddenList.body.data.items.some((item: any) => item.id === assignmentId)).toBe(false)

    await prisma.assignment.update({ where: { id: assignmentId }, data: { publishAt: new Date(now - 1_000) } })
    expect((await createAuthenticatedRequest(app, studentToken).get(`/api/assignments/${assignmentId}`)).status).toBe(200)
  })

  it('rejects stale edits and invalid cross-problem revisions', async () => {
    const token = generateTokenFromUser(teacher.user)
    const now = Date.now()
    const created = await createAuthenticatedRequest(app, token).post('/api/assignments').send({ organizationId, title: '并发作业', openAt: new Date(now + 60_000), dueAt: new Date(now + 120_000), closeAt: new Date(now + 180_000) })
    const assignmentId = created.body.data.id
    const second = await configuredProblem(teacher.user.id)
    const foreignRevision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: second.id } })
    const invalid = await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({ expectedRevision: 0, problems: [{ problemId: problem.id, testSetRevisionId: foreignRevision.id }] })
    expect(invalid.status).toBe(422)
    expect(invalid.body.code).toBe('ASSIGNMENT_REVISION_INVALID')
    const updated = await createAuthenticatedRequest(app, token).patch(`/api/assignments/${assignmentId}`).send({ expectedRevision: 0, title: '第一次修改' })
    expect(updated.status).toBe(200)
    const stale = await createAuthenticatedRequest(app, token).patch(`/api/assignments/${assignmentId}`).send({ expectedRevision: 0, title: '覆盖修改' })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('ASSIGNMENT_STALE')
  })

  it('creates an immutable assignment submission and recomputes progress idempotently', async () => {
    const token = generateTokenFromUser(teacher.user)
    const now = Date.now()
    const created = await createAuthenticatedRequest(app, token).post('/api/assignments').send({ organizationId, title: '提交闭环', openAt: new Date(now - 60_000), dueAt: new Date(now + 60_000), closeAt: new Date(now + 120_000) })
    const assignmentId = created.body.data.id
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const problems = await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({ expectedRevision: 0, problems: [{ problemId: problem.id, testSetRevisionId: revision.id }] })
    const assignmentProblemId = problems.body.data.Problems[0].id
    await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/roster`).send({ expectedRevision: 1, userIds: [student.user.id] })
    await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/publish`).send({ expectedRevision: 2 })
    const submitted = await createAuthenticatedRequest(app, generateTokenFromUser(student.user)).post(`/api/assignments/${assignmentId}/submit`).send({ assignmentProblemId, language: 'cpp17', code: 'int main(){}' })
    expect(submitted.status).toBe(201)
    const stored = await prisma.submission.findUniqueOrThrow({ where: { id: submitted.body.data.id }, include: { CurrentJudgeRun: true } })
    expect(stored.submitScope).toBe('assignment')
    expect(stored.submissionPhase).toBe('ORIGINAL')
    expect(stored.testSetRevisionId).toBe(revision.id)
    expect(stored.CurrentJudgeRun?.judgeConfigHash).toBe(revision.judgeConfigHash)
    await prisma.judgeRun.update({
      where: { id: stored.currentJudgeRunId! },
      data: { status: 'FINALIZED', result: 'accepted', score: 100, finalizedAt: new Date() },
    })
    const payload = { id: stored.id, userId: student.user.id, assignmentId, assignmentProblemId, assignmentRecipientId: stored.assignmentRecipientId }
    await syncAssignmentSubmission(payload)
    await syncAssignmentSubmission(payload)
    const progress = await prisma.assignmentProblemProgress.findUniqueOrThrow({ where: { assignmentProblemId_recipientId: { assignmentProblemId, recipientId: stored.assignmentRecipientId! } } })
    expect(progress.attemptCount).toBe(1)
    expect(progress.finalScore).toBe(100)
    expect(progress.learningStatus).toBe('COMPLETED')
  })

  it('moves published assignments through scheduled, open, overdue and closed states', async () => {
    const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: teacher.user.id } } })
    const assignment = await prisma.assignment.create({ data: {
      organizationId, title: '定时状态', createdByMembershipId: membership.id, status: 'SCHEDULED',
      openAt: new Date(Date.now() - 30_000), dueAt: new Date(Date.now() + 30_000), closeAt: new Date(Date.now() + 60_000), publishedAt: new Date(),
    } })
    expect((await processDueAssignments()).opened).toBe(1)
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe('OPEN')
    await prisma.assignment.update({ where: { id: assignment.id }, data: { dueAt: new Date(Date.now() - 10_000) } })
    expect((await processDueAssignments()).overdue).toBe(1)
    await prisma.assignment.update({ where: { id: assignment.id }, data: { closeAt: new Date(Date.now() - 1_000) } })
    expect((await processDueAssignments()).closed).toBe(1)
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe('CLOSED')
  })

  it('keeps correction, feedback and score adjustments as auditable facts', async () => {
    const token = generateTokenFromUser(teacher.user)
    const now = Date.now()
    const created = await createAuthenticatedRequest(app, token).post('/api/assignments').send({ organizationId, title: '批改闭环', openAt: new Date(now - 60_000), dueAt: new Date(now + 60_000), closeAt: new Date(now + 120_000) })
    const assignmentId = created.body.data.id
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const withProblem = await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({ expectedRevision: 0, problems: [{ problemId: problem.id, testSetRevisionId: revision.id }] })
    const assignmentProblemId = withProblem.body.data.Problems[0].id
    const withRoster = await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/roster`).send({ expectedRevision: 1, userIds: [student.user.id] })
    const recipientId = withRoster.body.data.Recipients[0].id
    const draftCorrection = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/corrections`).send({ assignmentProblemId, recipientId, reason: '草稿不能批改' })
    expect(draftCorrection.status).toBe(409)
    expect(draftCorrection.body.code).toBe('ASSIGNMENT_REVIEW_UNAVAILABLE')
    await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/publish`).send({ expectedRevision: 2 })
    const correction = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/corrections`).send({ assignmentProblemId, recipientId, reason: '请订正边界条件' })
    expect(correction.status).toBe(201)
    const feedback = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/feedback`).send({ assignmentProblemId, recipientId, content: '注意整数范围' })
    expect(feedback.status).toBe(201)
    const adjustment = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/score-adjustments`).send({ recipientId, delta: 5, reason: '人工复核' })
    expect(adjustment.status).toBe(201)
    const reversal = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/score-adjustments/${adjustment.body.data.id}/reverse`).send({ reason: '录入错误' })
    expect(reversal.status).toBe(201)
    expect(reversal.body.data.delta).toBe(-5)
    const duplicate = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/score-adjustments/${adjustment.body.data.id}/reverse`).send({ reason: '重复冲正' })
    expect(duplicate.status).toBe(409)
    const workspace = await createAuthenticatedRequest(app, generateTokenFromUser(student.user)).get(`/api/assignments/${assignmentId}/workspace`)
    expect(workspace.status).toBe(200)
    expect(workspace.body.data.feedback).toHaveLength(1)
    expect(workspace.body.data.corrections).toHaveLength(1)
    expect(workspace.body.data.assignment.Recipients).toHaveLength(1)
    expect(workspace.body.data.canManage).toBe(false)
    const managerWorkspace = await createAuthenticatedRequest(app, token).get(`/api/assignments/${assignmentId}/workspace`)
    expect(managerWorkspace.status).toBe(200)
    expect(managerWorkspace.body.data.canManage).toBe(true)
    expect(managerWorkspace.body.data.managerProgress.recipients).toHaveLength(1)
    expect(managerWorkspace.body.data.managerProgress.recipients[0]).toMatchObject({ id: recipientId, score: 0, adjustment: 0 })
  })

  it('supports optimistic teacher completion for MANUAL problems', async () => {
    const token = generateTokenFromUser(teacher.user)
    const now = Date.now()
    const created = await createAuthenticatedRequest(app, token).post('/api/assignments').send({
      organizationId, title: '人工完成作业', openAt: new Date(now - 60_000), dueAt: new Date(now + 60_000), closeAt: new Date(now + 120_000),
    })
    const assignmentId = created.body.data.id
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({
      expectedRevision: 0,
      problems: [{ problemId: problem.id, testSetRevisionId: revision.id, completionPolicy: 'MANUAL' }],
    })
    await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/roster`).send({ expectedRevision: 1, userIds: [student.user.id] })
    await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/publish`).send({ expectedRevision: 2 })
    const progress = await prisma.assignmentProblemProgress.findFirstOrThrow({ where: { assignmentId } })
    const beforeSubmission = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/progress/${progress.id}/manual-completion`).send({ completed: true, reason: '不应跳过首次提交', expectedVersion: 0 })
    expect(beforeSubmission.status).toBe(409)
    expect(beforeSubmission.body.code).toBe('MANUAL_COMPLETION_REQUIRES_SUBMISSION')
    const initialMatrix = await createAuthenticatedRequest(app, token).get(`/api/assignments/${assignmentId}/progress?page=1&pageSize=40&state=NOT_STARTED`)
    expect(initialMatrix.status).toBe(200)
    expect(initialMatrix.body.data.recipients[0].cells[0]).toMatchObject({ learningStatus: 'NOT_STARTED', attemptCount: 0, manualCompletionVersion: 0 })
    await prisma.assignmentProblemProgress.update({ where: { id: progress.id }, data: { attemptCount: 1, learningStatus: 'SUBMITTED', firstSubmittedAt: new Date(), lastSubmittedAt: new Date() } })
    const pendingMatrix = await createAuthenticatedRequest(app, token).get(`/api/assignments/${assignmentId}/progress?page=1&pageSize=40&state=MANUAL_PENDING`)
    expect(pendingMatrix.status).toBe(200)
    expect(pendingMatrix.body.data.statusCounts.MANUAL_PENDING).toBe(1)
    expect(pendingMatrix.body.data.recipients).toHaveLength(1)
    const completed = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/progress/${progress.id}/manual-completion`).send({ completed: true, reason: '课堂任务已现场验收', expectedVersion: 0 })
    expect(completed.status).toBe(200)
    expect(completed.body.data).toMatchObject({ learningStatus: 'COMPLETED', manualCompletionVersion: 1 })
    expect((await prisma.assignmentRecipient.findFirstOrThrow({ where: { assignmentId } })).status).toBe('COMPLETED')
    const stale = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/progress/${progress.id}/manual-completion`).send({ completed: false, reason: '旧页面撤回', expectedVersion: 0 })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('ASSIGNMENT_PROGRESS_STALE')
    const revoked = await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/progress/${progress.id}/manual-completion`).send({ completed: false, reason: '复核后需要继续完成', expectedVersion: 1 })
    expect(revoked.status).toBe(200)
    expect(revoked.body.data.learningStatus).toBe('SUBMITTED')
    expect((await prisma.assignmentRecipient.findFirstOrThrow({ where: { assignmentId } })).status).toBe('ACTIVE')
  })

  it('evaluates automatic correction policies once when the due time is reached', async () => {
    const token = generateTokenFromUser(teacher.user)
    const now = Date.now()
    const created = await createAuthenticatedRequest(app, token).post('/api/assignments').send({
      organizationId, title: '自动订正作业', correctionPolicy: 'BELOW_TARGET',
      openAt: new Date(now - 60_000), dueAt: new Date(now + 60_000), closeAt: new Date(now + 120_000),
    })
    const assignmentId = created.body.data.id
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/problems`).send({ expectedRevision: 0, problems: [{ problemId: problem.id, testSetRevisionId: revision.id, targetScore: 80 }] })
    await createAuthenticatedRequest(app, token).put(`/api/assignments/${assignmentId}/roster`).send({ expectedRevision: 1, userIds: [student.user.id] })
    await createAuthenticatedRequest(app, token).post(`/api/assignments/${assignmentId}/publish`).send({ expectedRevision: 2 })
    await prisma.assignment.update({ where: { id: assignmentId }, data: { dueAt: new Date(now - 1_000) } })

    expect((await processDueAssignments()).overdue).toBeGreaterThanOrEqual(1)
    const corrections = await prisma.assignmentCorrection.findMany({ where: { assignmentId } })
    expect(corrections).toHaveLength(1)
    expect(corrections[0]).toMatchObject({ source: 'policy', policyCode: 'BELOW_TARGET', assignedBy: 'system', status: 'NEEDS_CORRECTION' })
    await processDueAssignments()
    expect(await prisma.assignmentCorrection.count({ where: { assignmentId } })).toBe(1)
  })

  it('migrates legacy homework snapshots idempotently without changing the legacy record', async () => {
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const legacy = await prisma.training.create({ data: {
      title: '历史作业', description: '迁移前说明', type: 'homework', scope: 'campus', format: 'oi',
      organizationId, createdBy: teacher.user.id, status: 'upcoming',
      startTime: new Date(Date.now() + 60_000), endTime: new Date(Date.now() + 3_600_000),
      TrainingProblem: { create: {
        id: crypto.randomUUID(), problemId: problem.id, orderIndex: 0, points: 100,
        testSetRevisionId: revision.id, judgeConfigSnapshot: revision.judgeConfig,
      } },
      TrainingParticipant: { create: { id: crypto.randomUUID(), userId: student.user.id, userType: 'student' } },
    } })
    const before = await inspectAssignmentMigration()
    expect(before.migratable).toBeGreaterThanOrEqual(1)
    expect(before.issues.find(item => item.trainingId === legacy.id)).toBeUndefined()
    const first = await applyAssignmentMigration(before.reportHash)
    expect(first.migrated).toBeGreaterThanOrEqual(1)
    const migrated = await prisma.assignment.findUniqueOrThrow({ where: { legacyTrainingId: legacy.id }, include: { Problems: true, Recipients: true } })
    expect(migrated.title).toBe(legacy.title)
    expect(migrated.Problems).toHaveLength(1)
    expect(migrated.Problems[0].testSetRevisionId).toBe(revision.id)
    expect(migrated.Recipients.map(item => item.userId)).toContain(student.user.id)
    expect(await prisma.training.findUnique({ where: { id: legacy.id } })).not.toBeNull()
    const second = await applyAssignmentMigration(before.reportHash)
    expect(second.migrated).toBe(0)
    expect(await prisma.assignment.count({ where: { legacyTrainingId: legacy.id } })).toBe(1)
  })
})
