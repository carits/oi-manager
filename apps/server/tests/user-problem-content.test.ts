import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'
import { addProblemToContest, createTestSchoolContest } from './helpers/school-contest-helpers'

const app = createTestApp()

describe('VJudge 式多题面版本与活动快照', () => {
  let author: Awaited<ReturnType<typeof createTestUser>>
  let peer: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>
  let organizationId: string

  beforeEach(async () => {
    author = await createTestUser({ organization: { role: 'teacher' } })
    peer = await createTestUser({ organization: { role: 'teacher', organizationId: author.organization!.organizationId } })
    problem = await createTestProblem({ ownerId: author.user.id, title: '多题面测试题' })
    organizationId = author.organization!.organizationId
  })

  async function createVersion(name: string, visibility: 'private' | 'public' = 'private') {
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    return client.post(`/api/problems/${problem.id}/statement-versions`).send({
      name, language: 'zh', visibility, source: { type: 'blank' },
    })
  }

  async function createContestWithProblem(title: string) {
    const contest = await createTestSchoolContest({ organizationId, createdBy: author.user.id, title })
    const contestProblem = await addProblemToContest({
      contestId: contest.id,
      problemId: problem.id,
      alias: 'A',
      orderIndex: 0,
    })
    return { contest, contestProblem }
  }

  it('同一用户同题可创建多个独立名称，标准化同名被拒绝', async () => {
    expect((await createVersion('讲义版')).status).toBe(201)
    expect((await createVersion('简洁版')).status).toBe(201)
    const duplicate = await createVersion('  讲义版  ')
    expect(duplicate.status).toBe(409)
    expect(await prisma.userProblemContent.count({
      where: { problemId: problem.id, userId: author.user.id, kind: 'statement', deletedAt: null },
    })).toBe(2)
  })

  it('私有版本不可被他人读取，公开后可读取和独立派生', async () => {
    const created = await createVersion('作者版本')
    const versionId = created.body.data.id as string
    const authorClient = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const peerClient = createAuthenticatedRequest(app, generateTokenFromUser(peer.user))
    await authorClient.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '# 原始内容' })
    expect((await peerClient.get(`/api/problems/${problem.id}/statement-versions/${versionId}`)).status).toBe(404)

    await request(app).patch(`/api/problems/${problem.id}/statement-versions/${versionId}`)
      .set('Cookie', `oi_session=${generateTokenFromUser(author.user)}`).send({ visibility: 'public' })
    expect((await peerClient.get(`/api/problems/${problem.id}/statement-versions/${versionId}`)).status).toBe(200)
    const derived = await peerClient.post(`/api/problems/${problem.id}/statement-versions`).send({
      name: '派生版本', language: 'zh', visibility: 'private', source: { type: 'user', id: versionId },
    })
    expect(derived.status).toBe(201)
    await authorClient.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '# 来源已修改' })
    const derivedDetail = await peerClient.get(`/api/problems/${problem.id}/statement-versions/${derived.body.data.id}`)
    expect(derivedDetail.body.data.content).toBe('# 原始内容')
  })

  it('个人题解支持 Markdown、PDF、公开范围和软删除', async () => {
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const markdown = await client.put(`/api/problems/${problem.id}/my-content/solution`).send({
      language: 'zh',
      content: '# 个人题解',
    })
    expect(markdown.status).toBe(200)
    expect(markdown.body.data.revision).toBe(1)
    expect((await client.put(`/api/problems/${problem.id}/my-content/solution/shares`).send({
      shareKeys: ['platform'],
    })).status).toBe(200)

    const pdf = await request(app)
      .post(`/api/problems/${problem.id}/my-content/solution/pdf`)
      .set('Cookie', `oi_session=${generateTokenFromUser(author.user)}`)
      .field('language', 'zh')
      .attach('file', Buffer.from('%PDF-1.4\npersonal solution'), {
        filename: 'solution.pdf',
        contentType: 'application/pdf',
      })
    expect(pdf.status).toBe(200)
    expect(pdf.body.data.revision).toBe(2)
    const contentId = pdf.body.data.id as string
    const stored = await prisma.userProblemContent.findUniqueOrThrow({ where: { id: contentId } })
    expect(stored.format).toBe('pdf')
    expect(stored.visibility).toBe('public')

    expect((await client.delete(`/api/problems/${problem.id}/my-content/solution`)).status).toBe(200)
    expect((await prisma.userProblemContent.findUniqueOrThrow({ where: { id: contentId } })).deletedAt).not.toBeNull()
  })

  it('题目路径不能用于修改另一道题下的版本', async () => {
    const created = await createVersion('作用域版本')
    const other = await createTestProblem({ ownerId: author.user.id, title: '另一道题' })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const response = await request(app).patch(`/api/problems/${other.id}/statement-versions/${created.body.data.id}`)
      .set('Cookie', `oi_session=${generateTokenFromUser(author.user)}`).send({ name: '越权修改' })
    expect(response.status).toBe(400)
    const stored = await prisma.userProblemContent.findUniqueOrThrow({ where: { id: created.body.data.id } })
    expect(stored.name).toBe('作用域版本')
  })

  it('比赛选用个人题面后固化 Markdown，不受来源后续修改影响', async () => {
    const created = await createVersion('比赛个人版', 'public')
    const versionId = created.body.data.id as string
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    await client.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '比赛第一版' })
    const { contest, contestProblem } = await createContestWithProblem('题面固化比赛')
    const contestClient = createAuthenticatedRequest(app, generateTokenFromUser(author.user), { organizationId })

    const matrix = await contestClient.get(`/api/contests/${contest.publicId}/statement-management`)
    expect(matrix.status).toBe(200)
    const option = matrix.body.data.problems[0].options.find((item: any) => item.key === `user:${versionId}`)
    expect(option).toMatchObject({ format: 'markdown', sourceType: 'user' })
    const saved = await contestClient.put(`/api/contests/${contest.publicId}/statement-management`).send({ selections: [{
      contestProblemId: contestProblem.id,
      visibleOptionKeys: [option.key],
      defaultOptionKey: option.key,
    }] })
    expect(saved.status).toBe(200)

    await client.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '比赛第二版' })
    const stored = await prisma.contestProblem.findUniqueOrThrow({ where: { id: contestProblem.id } })
    expect(stored.statementType).toBe('markdown')
    expect(stored.statementMarkdown).toBe('比赛第一版')

    const reader = createAuthenticatedRequest(app, generateTokenFromUser(peer.user), { organizationId })
    const statements = await reader.get(`/api/contests/${contest.publicId}/problems/${contestProblem.id}/statements`)
    expect(statements.status).toBe(200)
    expect(statements.body.data.statements).toEqual([expect.objectContaining({
      format: 'markdown',
      content: '比赛第一版',
      isDefault: true,
    })])
  })

  it('题面管理只允许比赛管理员，组织成员只能读取已固化题面', async () => {
    await prisma.problem.update({ where: { id: problem.id }, data: { description: '# 官方比赛题面' } })
    const participant = await createTestUser({
      organization: { role: 'student', organizationId: author.organization!.organizationId },
    })
    const manager = createAuthenticatedRequest(app, generateTokenFromUser(author.user), { organizationId })
    const reader = createAuthenticatedRequest(app, generateTokenFromUser(participant.user), { organizationId })
    const { contest, contestProblem } = await createContestWithProblem('题面权限比赛')

    const matrix = await manager.get(`/api/contests/${contest.publicId}/statement-management`)
    const option = matrix.body.data.problems[0].options.find((item: any) => item.key === 'canonical:description')
    expect(option).toBeTruthy()
    expect((await manager.put(`/api/contests/${contest.publicId}/statement-management`).send({ selections: [{
      contestProblemId: contestProblem.id,
      visibleOptionKeys: [option.key],
      defaultOptionKey: option.key,
    }] })).status).toBe(200)

    const forbidden = await reader.get(`/api/contests/${contest.publicId}/statement-management`)
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.code).toBe('CONTEST_STATEMENT_MANAGE_DENIED')
    const statements = await reader.get(`/api/contests/${contest.publicId}/problems/${contestProblem.id}/statements`)
    expect(statements.status).toBe(200)
    expect(statements.body.data.statements[0].content).toBe('# 官方比赛题面')
  })

  it('比赛选用 PDF 后复制为比赛资源，不受来源文件替换影响', async () => {
    const created = await createVersion('比赛 PDF', 'public')
    const versionId = created.body.data.id as string
    const token = generateTokenFromUser(author.user)
    const client = createAuthenticatedRequest(app, token, { organizationId })
    const original = await request(app)
      .post(`/api/problems/${problem.id}/statement-versions/${versionId}/pdf`)
      .set('Cookie', `oi_session=${token}`)
      .attach('file', Buffer.from('%PDF-1.4\ncontest original'), { filename: 'original.pdf', contentType: 'application/pdf' })
    expect(original.status).toBe(200)

    const { contest, contestProblem } = await createContestWithProblem('PDF 固化比赛')
    const matrix = await client.get(`/api/contests/${contest.publicId}/statement-management`)
    const option = matrix.body.data.problems[0].options.find((item: any) => item.key === `user:${versionId}`)
    expect(option).toMatchObject({ format: 'pdf', sourceType: 'user' })
    expect((await client.put(`/api/contests/${contest.publicId}/statement-management`).send({ selections: [{
      contestProblemId: contestProblem.id,
      visibleOptionKeys: [option.key],
      defaultOptionKey: option.key,
    }] })).status).toBe(200)

    const replacementUpload = await request(app)
      .post(`/api/problems/${problem.id}/statement-versions/${versionId}/pdf`)
      .set('Cookie', `oi_session=${token}`)
      .attach('file', Buffer.from('%PDF-1.4\nsource replacement'), { filename: 'replacement.pdf', contentType: 'application/pdf' })
    expect(replacementUpload.status).toBe(200)

    const stored = await prisma.contestProblem.findUniqueOrThrow({ where: { id: contestProblem.id } })
    expect(stored.statementType).toBe('pdf')
    const resource = await prisma.contestResource.findFirstOrThrow({
      where: { contestProblemId: contestProblem.id, fileType: 'statement' },
    })
    expect(resource.fileName).toBe('original.pdf')

    const reader = createAuthenticatedRequest(app, generateTokenFromUser(peer.user), { organizationId })
    const downloaded = await reader.get(`/api/contests/${contest.publicId}/problems/${contestProblem.id}/statement/file`)
      .buffer(true).parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.from(chunk)))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
    expect(downloaded.status).toBe(200)
    expect(Buffer.from(downloaded.body).toString()).toContain('contest original')
    expect(Buffer.from(downloaded.body).toString()).not.toContain('source replacement')
  })
})
