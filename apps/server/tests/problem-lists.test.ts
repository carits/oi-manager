import crypto from 'node:crypto'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestTeam, createTestUser, createTestSchoolWithPrincipal } from './helpers/testUser'
import { createTestProblemList, shareTestProblemList, createTestProblem } from './helpers/problemListHelpers'
import { generateTokenFromUser } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('题单权限模块', () => {
  // ====== 测试数据 ======
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let editUser: Awaited<ReturnType<typeof createTestUser>>
  let viewUser: Awaited<ReturnType<typeof createTestUser>>
  let strangerUser: Awaited<ReturnType<typeof createTestUser>>
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>

  let ownerToken: string
  let editToken: string
  let viewToken: string
  let strangerToken: string

  let testList: Awaited<ReturnType<typeof createTestProblemList>>
  let testProblem: Awaited<ReturnType<typeof createTestProblem>>

  const organizationRequest = (token: string) => createAuthenticatedRequest(
    app, token, { organizationId: schoolData.school.organizationId! },
  )

  beforeEach(async () => {
    // 创建学校
    schoolData = await createTestSchoolWithPrincipal('权限测试学校')

    // 创建用户：owner 是教师，edit/view 也是教师（同校），stranger 是另一个学校的教师
    ownerUser = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
    editUser = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
    viewUser = await createTestUser({ organization: { role: 'student', organizationId: schoolData.school.organizationId! } })
    strangerUser = await createTestUser({ organization: { role: 'teacher' } })

    // 生成 token
    ownerToken = generateTokenFromUser(ownerUser.user)
    editToken = generateTokenFromUser(editUser.user)
    viewToken = generateTokenFromUser(viewUser.user)
    strangerToken = generateTokenFromUser(strangerUser.user)

    // 创建题单
    testList = await createTestProblemList({
      ownerId: ownerUser.user.id,
      organizationId: schoolData.school.organizationId!,
    })

    // 分享给 edit 用户和 view 用户
    await shareTestProblemList({
      problemListId: testList.list.id,
      targetType: 'teacher',
      targetId: editUser.userId!,
      permission: 'edit',
      sharedBy: ownerUser.user.id,
    })
    await shareTestProblemList({
      problemListId: testList.list.id,
      targetType: 'student',
      targetId: viewUser.userId!,
      permission: 'view',
      sharedBy: ownerUser.user.id,
    })

    // 创建测试题目
    testProblem = await createTestProblem({
      platform: 'carits',
      problemId: `TEST_P${Date.now()}`,
      ownerId: ownerUser.user.id,
    })
  })

  describe('多校园上下文隔离', () => {
    it('同一账号不能在学校 A 上下文读取或修改学校 B 的题单', async () => {
      const schoolB = await createTestSchoolWithPrincipal('题单第二校园')
      const membershipId = crypto.randomUUID()
      await prisma.organizationMembership.create({
        data: {
          id: membershipId,
          organizationId: schoolB.school.organizationId!,
          userId: ownerUser.user.id,
          memberRole: 'teacher',
          relationType: 'employee',
          status: 'active',
          joinedAt: new Date(),
          RoleAssignments: { create: { id: crypto.randomUUID(), roleKey: 'teacher', source: 'test_fixture' } },
        },
      })
      await prisma.organizationTeacherProfile.create({
        data: { id: crypto.randomUUID(), membershipId, name: '跨校题单教师', status: 'active' },
      })
      const listB = await createTestProblemList({
        ownerId: ownerUser.user.id,
        schoolId: schoolB.school.id,
      })
      const token = generateTokenFromUser(ownerUser.user)
      const requestA = createAuthenticatedRequest(app, token, { organizationId: schoolData.school.organizationId! })
      const requestB = createAuthenticatedRequest(app, token, { organizationId: schoolB.school.organizationId! })

      const listA = await requestA.get('/api/problem-lists?tab=all&pageSize=100')
      expect(listA.status).toBe(200)
      expect(listA.body.data.lists.some((item: any) => item.id === listB.list.id)).toBe(false)

      const directFromA = await requestA.get(`/api/problem-lists/${listB.list.id}`)
      expect(directFromA.status).toBe(404)

      const deleteFromA = await requestA.delete(`/api/problem-lists/${listB.list.id}`)
      expect(deleteFromA.status).toBe(404)
      expect(await prisma.problemList.findUnique({ where: { id: listB.list.id } })).not.toBeNull()

      const directFromB = await requestB.get(`/api/problem-lists/${listB.list.id}`)
      expect(directFromB.status).toBe(200)
    })

    it('不能用当前学校题单配另一学校团队创建作业', async () => {
      const schoolB = await createTestSchoolWithPrincipal('题单作业第二校园')
      const membershipId = crypto.randomUUID()
      await prisma.organizationMembership.create({
        data: {
          id: membershipId,
          organizationId: schoolB.school.organizationId!,
          userId: ownerUser.user.id,
          memberRole: 'teacher',
          relationType: 'employee',
          status: 'active',
          joinedAt: new Date(),
          RoleAssignments: { create: { id: crypto.randomUUID(), roleKey: 'teacher', source: 'test_fixture' } },
        },
      })
      await prisma.organizationTeacherProfile.create({
        data: { id: crypto.randomUUID(), membershipId, name: '跨校题单作业教师', status: 'active' },
      })
      const teamB = await createTestTeam({
        organizationId: schoolB.school.organizationId!,
        ownerId: ownerUser.user.id,
        ownerType: 'teacher',
      })
      const token = generateTokenFromUser(ownerUser.user)
      const response = await createAuthenticatedRequest(app, token, { organizationId: schoolData.school.organizationId! })
        .post(`/api/problem-lists/${testList.list.id}/create-assignment`)
        .send({
          teamId: teamB.id,
          startTime: '2026-09-23T00:00:00.000Z',
          endTime: '2026-09-24T00:00:00.000Z',
        })
      expect(response.status).toBe(404)
    })
  })

  // ====== CRUD 权限 ======

  describe('创建题单', () => {
    it('教师可创建题单', async () => {
      const res = await organizationRequest(ownerToken)
        .post('/api/problem-lists')
        .send({ title: '新题单' })
      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
    })

    it('学生可创建题单', async () => {
      const studentUser = await createTestUser({ organization: { role: 'student', organizationId: schoolData.school.organizationId! } })
      const studentToken = generateTokenFromUser(studentUser.user)
      const res = await organizationRequest(studentToken)
        .post('/api/problem-lists')
        .send({ title: '学生题单' })
      // 校园模式：学生不能创建题单
      expect(res.status).toBe(403)
    })
  })

  describe('查看题单 (GET /:id)', () => {
    it('owner 查看 → 200 + _permission=admin', async () => {
      const res = await organizationRequest(ownerToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data._permission).toBe('admin')
    })

    it('edit 分享用户查看 → 200 + _permission=edit', async () => {
      const res = await organizationRequest(editToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data._permission).toBe('edit')
    })

    it('view 分享用户查看 → 200 + _permission=view', async () => {
      const res = await organizationRequest(viewToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data._permission).toBe('view')
    })

    it('无当前校园成员关系的用户查看 → 403', async () => {
      const res = await organizationRequest(strangerToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(403)
    })
  })

  describe('编辑题单元信息 (PUT /:id)', () => {
    it('owner 编辑 → 200', async () => {
      const res = await organizationRequest(ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '新标题' })
      expect(res.status).toBe(200)
      expect(res.body.data.title).toBe('新标题')
    })

    it('edit 分享用户编辑 → 200', async () => {
      const res = await organizationRequest(editToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: 'edit用户修改' })
      expect(res.status).toBe(200)
    })

    it('view 分享用户编辑 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: 'view尝试修改' })
      expect(res.status).toBe(403)
    })

    it('陌生人编辑 → 403', async () => {
      const res = await organizationRequest(strangerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '陌生人修改' })
      expect(res.status).toBe(403)
    })
  })

  describe('删除题单 (DELETE /:id)', () => {
    it('owner 删除 → 200', async () => {
      const list = await createTestProblemList({ ownerId: ownerUser.user.id, organizationId: schoolData.school.organizationId! })
      const res = await organizationRequest(ownerToken)
        .delete(`/api/problem-lists/${list.list.id}`)
      expect(res.status).toBe(200)
    })

    it('edit 分享用户删除 → 403', async () => {
      const res = await organizationRequest(editToken)
        .delete(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(403)
    })

    it('view 分享用户删除 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .delete(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(403)
    })

    it('陌生人删除 → 403', async () => {
      const res = await organizationRequest(strangerToken)
        .delete(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(403)
    })
  })

  // ====== 章节操作权限 ======

  describe('章节操作权限', () => {
    it('admin 添加章节 → 200', async () => {
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: '新章节' })
      expect(res.status).toBe(200)
    })

    it('edit 用户添加章节 → 200', async () => {
      const res = await organizationRequest(editToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: 'edit用户的章节' })
      expect(res.status).toBe(200)
    })

    it('view 用户添加章节 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: 'view尝试添加' })
      expect(res.status).toBe(403)
    })

    it('admin 编辑章节 → 200', async () => {
      const res = await organizationRequest(ownerToken)
        .put(`/api/problem-lists/sections/${testList.defaultSection.id}`)
        .send({ title: '修改章节名' })
      expect(res.status).toBe(200)
    })

    it('edit 用户编辑章节 → 200', async () => {
      const res = await organizationRequest(editToken)
        .put(`/api/problem-lists/sections/${testList.defaultSection.id}`)
        .send({ title: 'edit修改章节名' })
      expect(res.status).toBe(200)
    })

    it('view 用户编辑章节 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .put(`/api/problem-lists/sections/${testList.defaultSection.id}`)
        .send({ title: 'view尝试编辑' })
      expect(res.status).toBe(403)
    })

    it('admin 删除章节 → 200（需至少2个章节）', async () => {
      // 先添加第二个章节
      await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: '第二个章节' })

      const res = await organizationRequest(ownerToken)
        .delete(`/api/problem-lists/sections/${testList.defaultSection.id}`)
      expect(res.status).toBe(200)
    })

    it('edit 用户删除章节 → 200', async () => {
      // 创建新题单，两个章节
      const list = await createTestProblemList({ ownerId: ownerUser.user.id, organizationId: schoolData.school.organizationId! })
      await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${list.list.id}/sections`)
        .send({ title: '第二个章节' })
      await shareTestProblemList({
        problemListId: list.list.id,
        targetType: 'teacher',
        targetId: editUser.userId!,
        permission: 'edit',
        sharedBy: ownerUser.user.id,
      })

      const res = await organizationRequest(editToken)
        .delete(`/api/problem-lists/sections/${list.defaultSection.id}`)
      expect(res.status).toBe(200)
    })

    it('view 用户删除章节 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .delete(`/api/problem-lists/sections/${testList.defaultSection.id}`)
      expect(res.status).toBe(403)
    })

    it('章节排序不能修改另一份题单的章节', async () => {
      const other = await createTestProblemList({ ownerId: ownerUser.user.id, organizationId: schoolData.school.organizationId! })
      const res = await organizationRequest(ownerToken)
        .put(`/api/problem-lists/${testList.list.id}/sections/reorder`)
        .send({ sectionIds: [other.defaultSection.id] })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('章节不属于该题单')
    })
  })

  // ====== 条目操作权限 ======

  describe('条目操作权限', () => {
    it('admin 添加条目 → 200', async () => {
      const problem1 = await createTestProblem({ platform: 'carits', problemId: `P${Date.now()}_admin`, ownerId: ownerUser.user.id })
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: problem1.problemId, problemId: problem1.id })
      expect(res.status).toBe(200)
    })

    it('edit 用户添加条目 → 200', async () => {
      const problem2 = await createTestProblem({ platform: 'carits', problemId: `P${Date.now()}_edit`, ownerId: ownerUser.user.id })
      const res = await organizationRequest(editToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: problem2.problemId, problemId: problem2.id })
      expect(res.status).toBe(200)
    })

    it('view 用户添加条目 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: 'test' })
      expect(res.status).toBe(403)
    })

    let entryId: string

    beforeEach(async () => {
      // 添加一个条目用于删除/编辑测试（用唯一题目避免冲突）
      const entryProblem = await createTestProblem({ platform: 'carits', problemId: `P${Date.now()}_entry`, ownerId: ownerUser.user.id })
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: entryProblem.problemId, problemId: entryProblem.id })
      entryId = res.body.data.entry.id
    })

    it('admin 删除条目 → 200', async () => {
      const res = await organizationRequest(ownerToken)
        .delete(`/api/problem-lists/entries/${entryId}`)
      expect(res.status).toBe(200)
    })

    it('edit 用户删除条目 → 200', async () => {
      const res = await organizationRequest(editToken)
        .delete(`/api/problem-lists/entries/${entryId}`)
      expect(res.status).toBe(200)
    })

    it('view 用户删除条目 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .delete(`/api/problem-lists/entries/${entryId}`)
      expect(res.status).toBe(403)
    })

    it('条目排序不能修改另一章节的条目', async () => {
      const otherList = await createTestProblemList({ ownerId: ownerUser.user.id, organizationId: schoolData.school.organizationId! })
      const otherProblem = await createTestProblem({ platform: 'carits', problemId: `P${Date.now()}_foreign`, ownerId: ownerUser.user.id })
      const added = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/sections/${otherList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: otherProblem.problemId, problemId: otherProblem.id })
      const res = await organizationRequest(ownerToken)
        .put(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/reorder`)
        .send({ entryIds: [added.body.data.entry.id] })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('条目不属于该章节')
    })
  })

  describe('创建独立作业草稿', () => {

    it('学生不能从题单创建作业', async () => {
      const res = await organizationRequest(viewToken)
        .post(`/api/problem-lists/${testList.list.id}/create-assignment`)
        .send({ teamId: 'unused', startTime: '2026-09-01', endTime: '2026-09-02' })
      expect(res.status).toBe(403)
    })

    it('拒绝无效的作业时间范围', async () => {
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/create-assignment`)
        .send({ teamId: 'unused', startTime: '2026-09-02', endTime: '2026-09-01' })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('作业时间范围无效')
    })

    it('空题单不能发布作业', async () => {
      const team = await createTestTeam({
        organizationId: schoolData.school.organizationId!,
        ownerId: ownerUser.user.id,
        ownerType: 'teacher',
      })
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/create-assignment`)
        .send({
          teamId: team.id,
          title: '题单发布回归作业',
          startTime: '2026-09-01T00:00:00.000Z',
          endTime: '2026-09-02T00:00:00.000Z',
          format: 'ioi',
        })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('题单中没有题目，无法发布')
    })

    it('创建 DRAFT Assignment 并固定题单题目的当前 Revision', async () => {
      const team = await createTestTeam({ organizationId: schoolData.school.organizationId!, ownerId: ownerUser.user.id })
      const revision = await prisma.problemTestSetRevision.create({ data: {
        id: crypto.randomUUID(), problemId: testProblem.id, revisionNumber: 1, mode: 'acm', source: 'initial',
        judgeConfig: '{"mode":"acm","cases":[]}', judgeConfigHash: 'problem-list-config', graphHash: 'problem-list-graph', testdataPath: '.', createdBy: ownerUser.user.id,
      } })
      await prisma.problem.update({ where: { id: testProblem.id }, data: { latestTestSetRevisionId: revision.id } })
      await organizationRequest(ownerToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: testProblem.problemId, problemId: testProblem.id })
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/create-assignment`)
        .send({ teamId: team.id, title: '题单作业草稿', startTime: '2026-09-01T00:00:00.000Z', endTime: '2026-09-02T00:00:00.000Z' })
      expect(res.status).toBe(201)
      const assignment = await prisma.assignment.findUnique({ where: { id: res.body.data.assignmentId }, include: { Problems: true, Events: true } })
      expect(assignment?.status).toBe('DRAFT')
      expect(assignment?.rosterMode).toBe('DYNAMIC')
      expect(assignment?.Problems[0].testSetRevisionId).toBe(revision.id)
      expect(assignment?.Events[0].type).toBe('assignment.created_from_problem_list')
    })
  })

  // ====== 分享管理权限 ======

  describe('分享管理权限', () => {
    it('owner 查看分享列表 → 200', async () => {
      const res = await organizationRequest(ownerToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('非 owner 查看分享列表 → 403', async () => {
      const res = await organizationRequest(editToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      expect(res.status).toBe(403)
    })

    it('view 用户查看分享列表 → 403', async () => {
      const res = await organizationRequest(viewToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      expect(res.status).toBe(403)
    })

    it('owner 添加分享 → 200', async () => {
      const anotherTeacher = await createTestUser({ organization: { role: 'teacher', organizationId: schoolData.school.organizationId! } })
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'teacher', targetId: anotherTeacher.userId, permission: 'view' })
      expect(res.status).toBe(200)
    })

    it('不能分享给其他校园成员', async () => {
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'teacher', targetId: strangerUser.userId, permission: 'view' })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('分享对象不属于当前校园或身份不匹配')
    })

    it('分享对象身份必须与目标类型一致', async () => {
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'student', targetId: editUser.userId, permission: 'view' })
      expect(res.status).toBe(400)
    })

    it('非 owner 添加分享 → 403', async () => {
      const res = await organizationRequest(editToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'teacher', targetId: strangerUser.userId, permission: 'view' })
      expect(res.status).toBe(403)
    })

    it('分享权限不能为 admin → 400', async () => {
      const res = await organizationRequest(ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'teacher', targetId: strangerUser.userId, permission: 'admin' })
      expect(res.status).toBe(400)
    })

    it('owner 删除分享 → 200', async () => {
      // 先添加一个分享
      const share = await shareTestProblemList({
        problemListId: testList.list.id,
        targetType: 'teacher',
        targetId: strangerUser.userId!,
        permission: 'view',
        sharedBy: ownerUser.user.id,
      })
      const res = await organizationRequest(ownerToken)
        .delete(`/api/problem-lists/${testList.list.id}/shares/${share.id}`)
      expect(res.status).toBe(200)
    })

    it('不能通过另一题单路径删除分享记录', async () => {
      const otherList = await createTestProblemList({ ownerId: ownerUser.user.id, organizationId: schoolData.school.organizationId! })
      const share = await shareTestProblemList({
        problemListId: otherList.list.id,
        targetType: 'teacher',
        targetId: editUser.userId!,
        permission: 'view',
        sharedBy: ownerUser.user.id,
      })
      const res = await organizationRequest(ownerToken)
        .delete(`/api/problem-lists/${testList.list.id}/shares/${share.id}`)
      expect(res.status).toBe(404)

      const remaining = await organizationRequest(ownerToken)
        .get(`/api/problem-lists/${otherList.list.id}/shares`)
      expect(remaining.body.data.some((item: { id: string }) => item.id === share.id)).toBe(true)
    })

    it('非 owner 删除分享 → 403', async () => {
      // 获取已有分享
      const sharesRes = await organizationRequest(ownerToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      const shares = sharesRes.body.data
      if (shares.length > 0) {
        const res = await organizationRequest(editToken)
          .delete(`/api/problem-lists/${testList.list.id}/shares/${shares[0].id}`)
        expect(res.status).toBe(403)
      }
    })
  })

  // ====== 列表 _permission 字段 ======

  describe('列表 _permission 字段', () => {
    it('owner 的题单 → _permission=admin', async () => {
      const res = await organizationRequest(ownerToken)
        .get(`/api/problem-lists?tab=mine&pageSize=50`)
      expect(res.status).toBe(200)
      const mineLists = res.body.data.lists.filter((l: any) => l.id === testList.list.id)
      expect(mineLists.length).toBe(1)
      expect(mineLists[0]._permission).toBe('admin')
    })

    it('edit 分享的题单 → _permission=edit', async () => {
      const res = await organizationRequest(editToken)
        .get(`/api/problem-lists?tab=all&pageSize=50`)
      expect(res.status).toBe(200)
      const sharedLists = res.body.data.lists.filter((l: any) => l.id === testList.list.id)
      expect(sharedLists.length).toBe(1)
      expect(sharedLists[0]._permission).toBe('edit')
    })

    it('view 分享的题单 → _permission=view', async () => {
      const res = await organizationRequest(viewToken)
        .get(`/api/problem-lists?tab=all&pageSize=50`)
      expect(res.status).toBe(200)
      const sharedLists = res.body.data.lists.filter((l: any) => l.id === testList.list.id)
      expect(sharedLists.length).toBe(1)
      expect(sharedLists[0]._permission).toBe('view')
    })
  })

  // ====== 并发编辑冲突 ======

  describe('并发编辑冲突', () => {
    it('正常编辑（updatedAt 匹配） → 200', async () => {
      // 获取当前 updatedAt
      const detail = await organizationRequest(ownerToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      const updatedAt = detail.body.data.updatedAt

      const res = await organizationRequest(ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '安全更新', expectedUpdatedAt: updatedAt })
      expect(res.status).toBe(200)
    })

    it('冲突编辑（updatedAt 不匹配） → 409', async () => {
      const res = await organizationRequest(ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '冲突更新', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('CONFLICT')
    })

    it('不传 updatedAt → 200（向后兼容）', async () => {
      const res = await organizationRequest(ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '无锁更新' })
      expect(res.status).toBe(200)
    })
  })
})
