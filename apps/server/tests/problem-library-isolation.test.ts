import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'
import { fileService } from '../src/lib/storage'
import { STORAGE_ROOT } from '../src/config/storage'
import fs from 'fs'
import path from 'path'

const app = createTestApp()

describe('学校私有题库隔离', () => {
  let schoolA: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let schoolB: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerA: Awaited<ReturnType<typeof createTestUser>>
  let peerA: Awaited<ReturnType<typeof createTestUser>>
  let teacherB: Awaited<ReturnType<typeof createTestUser>>
  let studentA: Awaited<ReturnType<typeof createTestUser>>
  let platformAdmin: Awaited<ReturnType<typeof createTestUser>>
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>
  let ownerAToken: string
  let peerAToken: string
  let principalAToken: string
  let teacherBToken: string
  let studentAToken: string
  let platformAdminToken: string
  let superAdminToken: string

  const tokenFor = (account: Awaited<ReturnType<typeof createTestUser>>, workspaceMode: 'work' | 'personal' = 'work') =>
    generateTestToken({
      userId: account.user.id,
      role: account.user.role,
      username: account.user.username,
      teacherId: account.teacherId,
      studentId: account.studentId,
      adminId: account.adminId,
      schoolId: account.schoolId,
      workspaceMode,
    })

  const organizationRequest = (token: string, organizationId: string) =>
    createAuthenticatedRequest(app, token, { organizationId })

  const schoolARequest = (token: string) => organizationRequest(token, schoolA.school.organizationId)
  const schoolBRequest = (token: string) => organizationRequest(token, schoolB.school.organizationId)

  beforeEach(async () => {
    schoolA = await createTestSchoolWithPrincipal('隔离测试学校 A')
    schoolB = await createTestSchoolWithPrincipal('隔离测试学校 B')
    ownerA = await createTestUser({ role: 'teacher', schoolId: schoolA.school.id })
    peerA = await createTestUser({ role: 'teacher', schoolId: schoolA.school.id })
    teacherB = await createTestUser({ role: 'teacher', schoolId: schoolB.school.id })
    studentA = await createTestUser({ role: 'student', schoolId: schoolA.school.id })
    platformAdmin = await createTestUser({ role: 'platform_admin' })
    superAdmin = await createTestUser({ role: 'super_admin' })

    ownerAToken = tokenFor(ownerA)
    peerAToken = tokenFor(peerA)
    teacherBToken = tokenFor(teacherB)
    studentAToken = tokenFor(studentA)
    platformAdminToken = tokenFor(platformAdmin)
    superAdminToken = tokenFor(superAdmin)
    principalAToken = generateTestToken({
      userId: schoolA.principal.userId,
      role: 'school_principal',
      username: schoolA.principal.username,
      teacherId: schoolA.principal.teacherId,
      schoolId: schoolA.school.id,
      workspaceMode: 'work',
    })
  })

  async function createSchoolProblem(status: 'draft' | 'published' = 'draft', suffix = crypto.randomUUID()) {
    return organizationRequest(ownerAToken, schoolA.school.organizationId)
      .post('/api/problems')
      .send({
        title: `学校 A 题目 ${suffix}`,
        status,
        schoolId: schoolB.school.id,
        libraryScope: 'platform',
        ojBindings: [{ platform: 'luogu', problemId: `A-${suffix}` }],
        statements: [{ format: 'markdown', language: 'zh', content: '校内题面', isVisible: true }],
        solutions: [{ format: 'markdown', language: 'zh', content: '隐藏题解', isVisible: false }],
      })
  }

  it('服务端强制归属当前学校，草稿仅作者和负责人可见', async () => {
    const created = await createSchoolProblem('draft')
    expect(created.status).toBe(201)
    const problem = await prisma.problem.findUniqueOrThrow({ where: { id: created.body.data.id } })
    expect(problem.libraryScope).toBe('school')
    expect(problem.libraryKey).toBe(`organization:${schoolA.school.organizationId}`)
    expect(problem.organizationId).toBe(schoolA.school.organizationId)
    expect(problem.status).toBe('draft')
    expect(problem.publishedAt).toBeNull()

    const ownerList = await organizationRequest(ownerAToken, schoolA.school.organizationId).get('/api/problems?library=school')
    const peerList = await organizationRequest(peerAToken, schoolA.school.organizationId).get('/api/problems?library=school')
    const principalList = await organizationRequest(principalAToken, schoolA.school.organizationId).get('/api/problems?library=school')
    const otherSchool = await organizationRequest(teacherBToken, schoolB.school.organizationId).get(`/api/problems/${problem.id}`)

    expect(ownerList.body.data.data.map((item: { id: string }) => item.id)).toContain(problem.id)
    expect(peerList.body.data.data.map((item: { id: string }) => item.id)).not.toContain(problem.id)
    expect(principalList.body.data.data.map((item: { id: string }) => item.id)).toContain(problem.id)
    expect(otherSchool.status).toBe(404)
  })

  it('发布后同校教师可使用，但不能编辑或读取隐藏题解与评测配置', async () => {
    const created = await createSchoolProblem('draft')
    const problemId = created.body.data.id as string
    await prisma.problem.update({ where: { id: problemId }, data: { judgeConfig: '{"secret":true}' } })

    const publish = await schoolARequest(ownerAToken)
      .put(`/api/problems/${problemId}`)
      .send({ status: 'published' })
    expect(publish.status).toBe(200)
    expect(publish.body.data.publishedAt).toBeTruthy()

    const peerDetail = await schoolARequest(peerAToken).get(`/api/problems/${problemId}`)
    const peerEdit = await schoolARequest(peerAToken)
      .put(`/api/problems/${problemId}`)
      .send({ title: '越权修改' })
    const principalEdit = await schoolARequest(principalAToken)
      .put(`/api/problems/${problemId}`)
      .send({ title: '负责人修改' })

    expect(peerDetail.status).toBe(200)
    expect(peerDetail.body.data.solutions).toEqual([])
    expect(peerDetail.body.data.judgeConfig).toBeNull()
    expect(peerDetail.body.data.permissions.canEdit).toBe(false)
    expect(peerEdit.status).toBe(404)
    expect(principalEdit.status).toBe(200)
  })

  it('学生、其他学校和平台管理员不能枚举或直接读取学校题目', async () => {
    const created = await createSchoolProblem('published')
    const problemId = created.body.data.id as string

    const studentList = await schoolARequest(studentAToken).get('/api/problems?library=school')
    const studentDetail = await schoolARequest(studentAToken).get(`/api/problems/${problemId}`)
    const otherDetail = await schoolBRequest(teacherBToken).get(`/api/problems/${problemId}`)
    const platformDetail = await createAuthenticatedRequest(app, platformAdminToken).get(`/api/problems/${problemId}`)
    const superDetail = await createAuthenticatedRequest(app, superAdminToken).get(`/api/problems/${problemId}`)
    const personalSchoolList = await createAuthenticatedRequest(app, tokenFor(ownerA, 'personal')).get('/api/problems?library=school')

    expect(studentList.status).toBe(403)
    expect(studentList.body.code).toBe('TEACHER_ONLY')
    expect(studentDetail.status).toBe(404)
    expect(otherDetail.status).toBe(404)
    expect(platformDetail.status).toBe(404)
    expect(superDetail.status).toBe(404)
    expect(personalSchoolList.status).toBe(403)
    expect(personalSchoolList.body.code).toBe('ORGANIZATION_REQUIRED')
  })

  it('不同学校可使用相同 OJ 题号，同校重复创建被拒绝', async () => {
    const payload = {
      title: 'P1000 学校副本',
      status: 'published',
      ojBindings: [{ platform: 'luogu', problemId: 'P1000' }],
    }
    const schoolAProblem = await schoolARequest(ownerAToken).post('/api/problems').send(payload)
    const duplicateA = await schoolARequest(peerAToken).post('/api/problems').send(payload)
    const schoolBProblem = await schoolBRequest(teacherBToken).post('/api/problems').send(payload)

    expect(schoolAProblem.status).toBe(201)
    expect(duplicateA.status).toBe(409)
    expect(schoolBProblem.status).toBe(201)
    expect(schoolBProblem.body.data.id).not.toBe(schoolAProblem.body.data.id)
  })

  it('题目与题面版本在创建和更新失败时保持原子性', async () => {
    const createId = `ATOMIC-${crypto.randomUUID()}`
    const rejectedCreate = await schoolARequest(ownerAToken)
      .post('/api/problems')
      .send({
        title: '不应留下的半成品题目',
        ojBindings: [{ platform: 'luogu', problemId: createId }],
        statements: [{ content: '缺少 format' }],
      })
    expect(rejectedCreate.status).toBe(422)
    expect(rejectedCreate.body.code).toBe('API_CONTRACT_REQUEST_INVALID')
    expect(await prisma.problem.count({ where: {
      organizationId: schoolA.school.organizationId,
      platform: 'luogu',
      problemId: createId,
    } })).toBe(0)

    const created = await createSchoolProblem('draft')
    const originalTitle = created.body.data.title as string
    const rejectedUpdate = await schoolARequest(ownerAToken)
      .put(`/api/problems/${created.body.data.id}`)
      .send({ title: '不应提交的标题', statements: [{ content: '缺少 format' }], solutions: [] })
    expect(rejectedUpdate.status).toBe(422)
    expect(rejectedUpdate.body.code).toBe('API_CONTRACT_REQUEST_INVALID')
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: created.body.data.id } })).title).toBe(originalTitle)
  })

  it('平台题复制为本校独立草稿，重复复制返回已有副本', async () => {
    const platformProblem = await createAuthenticatedRequest(app, platformAdminToken)
      .post('/api/problems')
      .send({
        title: '平台复制源题',
        status: 'published',
        ojBindings: [{ platform: 'codeforces', problemId: '1000A' }],
        statements: [{ format: 'markdown', language: 'zh', content: '平台题面', isVisible: true }],
      })
    expect(platformProblem.status).toBe(201)

    const firstCopy = await schoolARequest(ownerAToken)
      .post(`/api/problems/${platformProblem.body.data.id}/copy-to-school`)
    const duplicateCopy = await schoolARequest(peerAToken)
      .post(`/api/problems/${platformProblem.body.data.id}/copy-to-school`)
    const otherSchoolCopy = await schoolBRequest(teacherBToken)
      .post(`/api/problems/${platformProblem.body.data.id}/copy-to-school`)

    expect(firstCopy.status).toBe(201)
    expect(firstCopy.body.data.problem.status).toBe('draft')
    expect(firstCopy.body.data.problem.organizationId).toBe(schoolA.school.organizationId)
    expect(firstCopy.body.data.problem.sourceProblemId).toBe(platformProblem.body.data.id)
    expect(duplicateCopy.status).toBe(409)
    expect(duplicateCopy.body.code).toBe('SCHOOL_PROBLEM_EXISTS')
    expect(duplicateCopy.body.data.id).toBe(firstCopy.body.data.problem.id)
    expect(otherSchoolCopy.status).toBe(201)
    expect(otherSchoolCopy.body.data.problem.organizationId).toBe(schoolB.school.organizationId)
  })

  it('平台题库按 Carits 与其他来源在数据库查询层分组', async () => {
    const client = createAuthenticatedRequest(app, platformAdminToken)
    const carits = await client.post('/api/problems').send({
      title: 'Carits 分组题',
      status: 'published',
      statements: [{ format: 'markdown', language: 'zh', content: 'Carits 题面', isVisible: true }],
    })
    const codeforces = await client.post('/api/problems').send({
      title: 'Codeforces 分组题',
      status: 'published',
      ojBindings: [{ platform: 'codeforces', problemId: 'GROUP-1000A' }],
      statements: [{ format: 'markdown', language: 'zh', content: 'Codeforces 题面', isVisible: true }],
    })
    const luogu = await client.post('/api/problems').send({
      title: '洛谷分组题',
      status: 'published',
      ojBindings: [{ platform: 'luogu', problemId: 'GROUP-P1000' }],
      statements: [{ format: 'markdown', language: 'zh', content: '洛谷题面', isVisible: true }],
    })
    expect(carits.status).toBe(201)
    expect(codeforces.status).toBe(201)
    expect(luogu.status).toBe(201)

    const viewer = createAuthenticatedRequest(app, tokenFor(ownerA, 'personal'))
    const legacy = await viewer.get('/api/problems?library=platform&pageSize=100')
    const caritsGroup = await viewer.get('/api/problems?library=platform&sourceGroup=carits&pageSize=100')
    const externalGroup = await viewer.get('/api/problems?library=platform&sourceGroup=external&pageSize=100')
    const luoguOnly = await viewer.get('/api/problems?library=platform&sourceGroup=external&platform=luogu&pageSize=100')
    const externalSearch = await viewer.get('/api/problems?library=platform&sourceGroup=external&keyword=Codeforces&pageSize=100')

    const idsOf = (response: { body: { data: { data: Array<{ id: string }> } } }) => response.body.data.data.map(item => item.id)
    expect(idsOf(legacy)).toEqual(expect.arrayContaining([carits.body.data.id, codeforces.body.data.id, luogu.body.data.id]))
    expect(idsOf(caritsGroup)).toContain(carits.body.data.id)
    expect(idsOf(caritsGroup)).not.toContain(codeforces.body.data.id)
    expect(idsOf(caritsGroup)).not.toContain(luogu.body.data.id)
    expect(idsOf(externalGroup)).toEqual(expect.arrayContaining([codeforces.body.data.id, luogu.body.data.id]))
    expect(idsOf(externalGroup)).not.toContain(carits.body.data.id)
    expect(idsOf(luoguOnly)).toContain(luogu.body.data.id)
    expect(idsOf(luoguOnly)).not.toContain(codeforces.body.data.id)
    expect(idsOf(externalSearch)).toContain(codeforces.body.data.id)
    expect(idsOf(externalSearch)).not.toContain(luogu.body.data.id)
    expect(caritsGroup.body.data.total).toBe(caritsGroup.body.data.data.length)
    expect(externalGroup.body.data.total).toBe(externalGroup.body.data.data.length)

    for (const url of [
      '/api/problems?library=platform&sourceGroup=unknown',
      '/api/problems?library=platform&sourceGroup=carits&platform=luogu',
      '/api/problems?library=platform&sourceGroup=external&platform=carits',
    ]) {
      const response = await viewer.get(url)
      expect(response.status).toBe(400)
      expect(response.body.code).toBe('INVALID_PROBLEM_SOURCE_GROUP')
    }
    const schoolGroup = await schoolARequest(ownerAToken)
      .get('/api/problems?library=school&sourceGroup=carits')
    expect(schoolGroup.status).toBe(400)
    expect(schoolGroup.body.code).toBe('INVALID_PROBLEM_SOURCE_GROUP')
  })

  it('附件、文件元数据、测试数据与 AI 操作沿用同一学校边界', async () => {
    const created = await createSchoolProblem('published')
    const problemId = created.body.data.id as string
    const fileId = crypto.randomUUID()
    const fileUrl = `/api/files/${fileId}/download`
    await prisma.file.create({
      data: {
        id: fileId,
        relativePath: 'private/problem-attachments',
        fileName: 'isolation.txt',
        originalName: 'isolation.txt',
        mimeType: 'text/plain',
        fileSize: 4,
        accessLevel: 'private',
        isPublic: false,
        ownerType: 'problem',
        ownerId: problemId,
        category: 'attachment',
      },
    })
    await prisma.problemAttachment.create({
      data: { id: crypto.randomUUID(), problemId, fileName: 'isolation.txt', fileSize: 4, fileUrl },
    })

    const ownerAttachments = await schoolARequest(ownerAToken).get(`/api/problems/${problemId}/attachments`)
    const studentAttachments = await schoolARequest(studentAToken).get(`/api/problems/${problemId}/attachments`)
    const otherAttachments = await schoolBRequest(teacherBToken).get(`/api/problems/${problemId}/attachments`)
    const adminFileMetadata = await createAuthenticatedRequest(app, platformAdminToken).get(`/api/files/${fileId}`)
    const ownerTestdata = await schoolARequest(ownerAToken).get(`/api/problems/${problemId}/testdata`)
    const peerTestdata = await schoolARequest(peerAToken).get(`/api/problems/${problemId}/testdata`)
    const otherTestdata = await schoolBRequest(teacherBToken).get(`/api/problems/${problemId}/testdata`)
    const adminAi = await createAuthenticatedRequest(app, platformAdminToken)
      .post(`/api/problems/${problemId}/ai/format`)
      .send({})

    expect(ownerAttachments.status).toBe(200)
    expect(studentAttachments.status).toBe(404)
    expect(otherAttachments.status).toBe(404)
    expect(adminFileMetadata.status).toBe(404)
    expect(ownerTestdata.status).toBe(200)
    expect(peerTestdata.status).toBe(403)
    expect(otherTestdata.status).toBe(404)
    expect(adminAi.status).toBe(404)
  })

  it('学生只能通过已授权题单上下文读取题面与被引用文件', async () => {
    const created = await createSchoolProblem('published')
    const problemId = created.body.data.id as string
    const uploaded = await fileService.upload(Buffer.from('题单附件'), {
      category: 'attachment',
      ownerType: 'problem',
      ownerId: problemId,
      originalName: 'list-context.txt',
      mimeType: 'text/plain',
      isPublic: false,
    })
    await prisma.problemAttachment.create({
      data: {
        id: crypto.randomUUID(),
        problemId,
        fileName: uploaded.originalName,
        fileSize: uploaded.fileSize,
        fileUrl: uploaded.fileUrl,
      },
    })

    const listId = crypto.randomUUID()
    const sectionId = crypto.randomUUID()
    const entryId = crypto.randomUUID()
    await prisma.problemList.create({
      data: {
        id: listId,
        title: '授权题单',
        ownerId: ownerA.user.id,
        ownerType: 'teacher',
        scope: 'campus',
        organizationId: schoolA.school.organizationId,
        ProblemListSection: {
          create: {
            id: sectionId,
            title: '默认章节',
            ProblemListEntry: { create: { id: entryId, problemId } },
          },
        },
        ProblemListShare: {
          create: {
            id: crypto.randomUUID(),
            targetType: 'student',
            targetId: studentA.user.id,
            permission: 'view',
            sharedBy: ownerA.user.id,
          },
        },
      },
    })

    const contextualProblem = await schoolARequest(studentAToken)
      .get(`/api/problem-lists/${listId}/entries/${entryId}/problem`)
    const contextualFile = await schoolARequest(studentAToken)
      .get(`/api/problem-lists/${listId}/entries/${entryId}/files/${uploaded.id}`)
    const rawProblem = await schoolARequest(studentAToken).get(`/api/problems/${problemId}`)
    const swappedEntry = await schoolARequest(studentAToken)
      .get(`/api/problem-lists/${listId}/entries/${crypto.randomUUID()}/files/${uploaded.id}`)
    const otherSchoolContext = await schoolBRequest(teacherBToken)
      .get(`/api/problem-lists/${listId}/entries/${entryId}/problem`)

    expect(contextualProblem.status).toBe(200)
    expect(contextualProblem.body.data.attachments[0].fileUrl)
      .toBe(`/api/problem-lists/${listId}/entries/${entryId}/files/${uploaded.id}`)
    expect(contextualProblem.body.data.solutions).toBeUndefined()
    expect(contextualFile.status).toBe(200)
    expect(contextualFile.text).toBe('题单附件')
    expect(rawProblem.status).toBe(404)
    expect(swappedEntry.status).toBe(404)
    expect(otherSchoolContext.status).toBe(404)

    const physicalPath = path.join(STORAGE_ROOT, uploaded.relativePath, uploaded.fileName)
    if (fs.existsSync(physicalPath)) fs.unlinkSync(physicalPath)
  })

  it('公开个人题面 PDF 仍受学校题目边界约束', async () => {
    const created = await createSchoolProblem('published')
    const problemId = created.body.data.id as string
    const version = await schoolARequest(ownerAToken)
      .post(`/api/problems/${problemId}/statement-versions`)
      .send({
        name: '学校公开版本',
        language: 'zh',
        visibility: 'public',
        source: { type: 'blank' },
      })
    expect(version.status).toBe(201)
    const versionId = version.body.data.id as string
    const uploaded = await request(app)
      .post(`/api/problems/${problemId}/statement-versions/${versionId}/pdf`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-OI-Organization-ID', schoolA.school.organizationId)
      .attach('file', Buffer.from('%PDF-1.4\nschool statement'), {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      })
    expect(uploaded.status).toBe(200)
    expect((await schoolARequest(ownerAToken)
      .get(`/api/problems/${problemId}/statement-versions/${versionId}/file`)).status).toBe(200)
    expect((await schoolBRequest(teacherBToken)
      .get(`/api/problems/${problemId}/statement-versions/${versionId}/file`)).status).toBe(404)
  })

  it('匿名请求保持 401', async () => {
    const response = await request(app).get('/api/problems?library=school')
    expect(response.status).toBe(401)
  })
})
