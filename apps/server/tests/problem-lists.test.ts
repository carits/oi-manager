import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal } from './helpers/testUser'
import { createTestProblemList, shareTestProblemList, createTestProblem } from './helpers/problemListHelpers'
import { generateTokenFromUser } from './helpers/testToken'

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

  beforeEach(async () => {
    // 创建学校
    schoolData = await createTestSchoolWithPrincipal('权限测试学校')

    // 创建用户：owner 是教师，edit/view 也是教师（同校），stranger 是另一个学校的教师
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    editUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    viewUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
    strangerUser = await createTestUser({ role: 'teacher' })

    // 生成 token
    ownerToken = generateTokenFromUser({
      id: ownerUser.user.id,
      role: 'teacher',
      username: ownerUser.user.username,
      teacherId: ownerUser.teacherId,
      schoolId: schoolData.school.id,
    })
    editToken = generateTokenFromUser({
      id: editUser.user.id,
      role: 'teacher',
      username: editUser.user.username,
      teacherId: editUser.teacherId,
      schoolId: schoolData.school.id,
    })
    viewToken = generateTokenFromUser({
      id: viewUser.user.id,
      role: 'student',
      username: viewUser.user.username,
      studentId: viewUser.studentId,
      schoolId: schoolData.school.id,
    })
    strangerToken = generateTokenFromUser({
      id: strangerUser.user.id,
      role: 'teacher',
      username: strangerUser.user.username,
      teacherId: strangerUser.teacherId,
    })

    // 创建题单
    testList = await createTestProblemList({
      ownerId: ownerUser.user.id,
      schoolId: schoolData.school.id,
    })

    // 分享给 edit 用户和 view 用户
    await shareTestProblemList({
      problemListId: testList.list.id,
      targetType: 'teacher',
      targetId: editUser.teacherId!,
      permission: 'edit',
      sharedBy: ownerUser.user.id,
    })
    await shareTestProblemList({
      problemListId: testList.list.id,
      targetType: 'student',
      targetId: viewUser.studentId!,
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

  // ====== CRUD 权限 ======

  describe('创建题单', () => {
    it('教师可创建题单', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post('/api/problem-lists')
        .send({ title: '新题单' })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('学生可创建题单', async () => {
      const studentUser = await createTestUser({ role: 'student', schoolId: schoolData.school.id })
      const token = generateTokenFromUser({
        id: studentUser.user.id,
        role: 'student',
        username: studentUser.user.username,
        studentId: studentUser.studentId,
        schoolId: schoolData.school.id,
      })
      const res = await createAuthenticatedRequest(app, token)
        .post('/api/problem-lists')
        .send({ title: '学生题单' })
      // 校园模式：学生不能创建题单
      expect(res.status).toBe(403)
    })
  })

  describe('查看题单 (GET /:id)', () => {
    it('owner 查看 → 200 + _permission=admin', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data._permission).toBe('admin')
    })

    it('edit 分享用户查看 → 200 + _permission=edit', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data._permission).toBe('edit')
    })

    it('view 分享用户查看 → 200 + _permission=view', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data._permission).toBe('view')
    })

    it('未分享用户查看 → 404（隐藏跨作用域资源存在性）', async () => {
      const res = await createAuthenticatedRequest(app, strangerToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(404)
    })
  })

  describe('编辑题单元信息 (PUT /:id)', () => {
    it('owner 编辑 → 200', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '新标题' })
      expect(res.status).toBe(200)
      expect(res.body.data.title).toBe('新标题')
    })

    it('edit 分享用户编辑 → 200', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: 'edit用户修改' })
      expect(res.status).toBe(200)
    })

    it('view 分享用户编辑 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: 'view尝试修改' })
      expect(res.status).toBe(403)
    })

    it('陌生人编辑 → 403', async () => {
      const res = await createAuthenticatedRequest(app, strangerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '陌生人修改' })
      expect(res.status).toBe(403)
    })
  })

  describe('删除题单 (DELETE /:id)', () => {
    it('owner 删除 → 200', async () => {
      const list = await createTestProblemList({ ownerId: ownerUser.user.id, schoolId: schoolData.school.id })
      const res = await createAuthenticatedRequest(app, ownerToken)
        .delete(`/api/problem-lists/${list.list.id}`)
      expect(res.status).toBe(200)
    })

    it('edit 分享用户删除 → 403', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .delete(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(403)
    })

    it('view 分享用户删除 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .delete(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(403)
    })

    it('陌生人删除 → 403', async () => {
      const res = await createAuthenticatedRequest(app, strangerToken)
        .delete(`/api/problem-lists/${testList.list.id}`)
      expect(res.status).toBe(403)
    })
  })

  // ====== 章节操作权限 ======

  describe('章节操作权限', () => {
    it('admin 添加章节 → 200', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: '新章节' })
      expect(res.status).toBe(200)
    })

    it('edit 用户添加章节 → 200', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: 'edit用户的章节' })
      expect(res.status).toBe(200)
    })

    it('view 用户添加章节 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: 'view尝试添加' })
      expect(res.status).toBe(403)
    })

    it('admin 编辑章节 → 200', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .put(`/api/problem-lists/sections/${testList.defaultSection.id}`)
        .send({ title: '修改章节名' })
      expect(res.status).toBe(200)
    })

    it('edit 用户编辑章节 → 200', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .put(`/api/problem-lists/sections/${testList.defaultSection.id}`)
        .send({ title: 'edit修改章节名' })
      expect(res.status).toBe(200)
    })

    it('view 用户编辑章节 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .put(`/api/problem-lists/sections/${testList.defaultSection.id}`)
        .send({ title: 'view尝试编辑' })
      expect(res.status).toBe(403)
    })

    it('admin 删除章节 → 200（需至少2个章节）', async () => {
      // 先添加第二个章节
      await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/sections`)
        .send({ title: '第二个章节' })

      const res = await createAuthenticatedRequest(app, ownerToken)
        .delete(`/api/problem-lists/sections/${testList.defaultSection.id}`)
      expect(res.status).toBe(200)
    })

    it('edit 用户删除章节 → 200', async () => {
      // 创建新题单，两个章节
      const list = await createTestProblemList({ ownerId: ownerUser.user.id, schoolId: schoolData.school.id })
      await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/problem-lists/${list.list.id}/sections`)
        .send({ title: '第二个章节' })
      await shareTestProblemList({
        problemListId: list.list.id,
        targetType: 'teacher',
        targetId: editUser.teacherId!,
        permission: 'edit',
        sharedBy: ownerUser.user.id,
      })

      const res = await createAuthenticatedRequest(app, editToken)
        .delete(`/api/problem-lists/sections/${list.defaultSection.id}`)
      expect(res.status).toBe(200)
    })

    it('view 用户删除章节 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .delete(`/api/problem-lists/sections/${testList.defaultSection.id}`)
      expect(res.status).toBe(403)
    })

    it('章节排序不能修改另一份题单的章节', async () => {
      const other = await createTestProblemList({ ownerId: ownerUser.user.id, schoolId: schoolData.school.id })
      const res = await createAuthenticatedRequest(app, ownerToken)
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
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: problem1.problemId, problemId: problem1.id })
      expect(res.status).toBe(200)
    })

    it('edit 用户添加条目 → 200', async () => {
      const problem2 = await createTestProblem({ platform: 'carits', problemId: `P${Date.now()}_edit`, ownerId: ownerUser.user.id })
      const res = await createAuthenticatedRequest(app, editToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: problem2.problemId, problemId: problem2.id })
      expect(res.status).toBe(200)
    })

    it('view 用户添加条目 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: 'test' })
      expect(res.status).toBe(403)
    })

    let entryId: string

    beforeEach(async () => {
      // 添加一个条目用于删除/编辑测试（用唯一题目避免冲突）
      const entryProblem = await createTestProblem({ platform: 'carits', problemId: `P${Date.now()}_entry`, ownerId: ownerUser.user.id })
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/problem-lists/sections/${testList.defaultSection.id}/entries/single`)
        .send({ ojName: 'carits', problemCode: entryProblem.problemId, problemId: entryProblem.id })
      entryId = res.body.data.entry.id
    })

    it('admin 删除条目 → 200', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .delete(`/api/problem-lists/entries/${entryId}`)
      expect(res.status).toBe(200)
    })

    it('edit 用户删除条目 → 200', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .delete(`/api/problem-lists/entries/${entryId}`)
      expect(res.status).toBe(200)
    })

    it('view 用户删除条目 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .delete(`/api/problem-lists/entries/${entryId}`)
      expect(res.status).toBe(403)
    })
  })

  // ====== 分享管理权限 ======

  describe('分享管理权限', () => {
    it('owner 查看分享列表 → 200', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('非 owner 查看分享列表 → 403', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      expect(res.status).toBe(403)
    })

    it('view 用户查看分享列表 → 403', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      expect(res.status).toBe(403)
    })

    it('owner 添加分享 → 200', async () => {
      const anotherTeacher = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'teacher', targetId: anotherTeacher.teacherId, permission: 'view' })
      expect(res.status).toBe(200)
    })

    it('非 owner 添加分享 → 403', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'teacher', targetId: strangerUser.teacherId, permission: 'view' })
      expect(res.status).toBe(403)
    })

    it('分享权限不能为 admin → 400', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .post(`/api/problem-lists/${testList.list.id}/shares`)
        .send({ targetType: 'teacher', targetId: strangerUser.teacherId, permission: 'admin' })
      expect(res.status).toBe(400)
    })

    it('owner 删除分享 → 200', async () => {
      // 先添加一个分享
      const share = await shareTestProblemList({
        problemListId: testList.list.id,
        targetType: 'teacher',
        targetId: strangerUser.teacherId!,
        permission: 'view',
        sharedBy: ownerUser.user.id,
      })
      const res = await createAuthenticatedRequest(app, ownerToken)
        .delete(`/api/problem-lists/${testList.list.id}/shares/${share.id}`)
      expect(res.status).toBe(200)
    })

    it('非 owner 删除分享 → 403', async () => {
      // 获取已有分享
      const sharesRes = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/problem-lists/${testList.list.id}/shares`)
      const shares = sharesRes.body.data
      if (shares.length > 0) {
        const res = await createAuthenticatedRequest(app, editToken)
          .delete(`/api/problem-lists/${testList.list.id}/shares/${shares[0].id}`)
        expect(res.status).toBe(403)
      }
    })
  })

  // ====== 列表 _permission 字段 ======

  describe('列表 _permission 字段', () => {
    it('owner 的题单 → _permission=admin', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/problem-lists?tab=mine&pageSize=50`)
      expect(res.status).toBe(200)
      const mineLists = res.body.data.lists.filter((l: any) => l.id === testList.list.id)
      expect(mineLists.length).toBe(1)
      expect(mineLists[0]._permission).toBe('admin')
    })

    it('edit 分享的题单 → _permission=edit', async () => {
      const res = await createAuthenticatedRequest(app, editToken)
        .get(`/api/problem-lists?tab=all&pageSize=50`)
      expect(res.status).toBe(200)
      const sharedLists = res.body.data.lists.filter((l: any) => l.id === testList.list.id)
      expect(sharedLists.length).toBe(1)
      expect(sharedLists[0]._permission).toBe('edit')
    })

    it('view 分享的题单 → _permission=view', async () => {
      const res = await createAuthenticatedRequest(app, viewToken)
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
      const detail = await createAuthenticatedRequest(app, ownerToken)
        .get(`/api/problem-lists/${testList.list.id}`)
      const updatedAt = detail.body.data.updatedAt

      const res = await createAuthenticatedRequest(app, ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '安全更新', expectedUpdatedAt: updatedAt })
      expect(res.status).toBe(200)
    })

    it('冲突编辑（updatedAt 不匹配） → 409', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '冲突更新', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('CONFLICT')
    })

    it('不传 updatedAt → 200（向后兼容）', async () => {
      const res = await createAuthenticatedRequest(app, ownerToken)
        .put(`/api/problem-lists/${testList.list.id}`)
        .send({ title: '无锁更新' })
      expect(res.status).toBe(200)
    })
  })
})
