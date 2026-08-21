import crypto from 'crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('VJudge 式多题面版本与活动快照', () => {
  let author: Awaited<ReturnType<typeof createTestUser>>
  let peer: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>
  let organizationId: string

  beforeEach(async () => {
    author = await createTestUser({ role: 'teacher' })
    peer = await createTestUser({ role: 'teacher', schoolId: author.schoolId })
    problem = await createTestProblem({ ownerId: author.user.id, title: '多题面测试题' })
    organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: author.schoolId } })).organizationId!
  })

  async function createVersion(name: string, visibility: 'private' | 'public' = 'private') {
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    return client.post(`/api/problems/${problem.id}/statement-versions`).send({
      name, language: 'zh', visibility, source: { type: 'blank' },
    })
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
      .set('Authorization', `Bearer ${generateTokenFromUser(author.user)}`).send({ visibility: 'public' })
    expect((await peerClient.get(`/api/problems/${problem.id}/statement-versions/${versionId}`)).status).toBe(200)
    const derived = await peerClient.post(`/api/problems/${problem.id}/statement-versions`).send({
      name: '派生版本', language: 'zh', visibility: 'private', source: { type: 'user', id: versionId },
    })
    expect(derived.status).toBe(201)
    await authorClient.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '# 来源已修改' })
    const derivedDetail = await peerClient.get(`/api/problems/${problem.id}/statement-versions/${derived.body.data.id}`)
    expect(derivedDetail.body.data.content).toBe('# 原始内容')
  })

  it('题目路径不能用于修改另一道题下的版本', async () => {
    const created = await createVersion('作用域版本')
    const other = await createTestProblem({ ownerId: author.user.id, title: '另一道题' })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const response = await request(app).patch(`/api/problems/${other.id}/statement-versions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${generateTokenFromUser(author.user)}`).send({ name: '越权修改' })
    expect(response.status).toBe(400)
    const stored = await prisma.userProblemContent.findUniqueOrThrow({ where: { id: created.body.data.id } })
    expect(stored.name).toBe('作用域版本')
  })

  it('活动增加其他题面时保留已选题面的原始不可变快照', async () => {
    const created = await createVersion('活动个人版', 'public')
    const versionId = created.body.data.id as string
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    await client.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '活动第一版' })
    await prisma.problem.update({ where: { id: problem.id }, data: { description: '# 官方题面' } })
    const training = await prisma.training.create({ data: {
      title: '多题面活动', startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
      status: 'ongoing', createdBy: author.user.id, organizationId,
    } })
    const tp = await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(), trainingId: training.id, problemId: problem.id, alias: 'A', orderIndex: 0,
    } })
    const first = await client.put(`/api/trainings/${training.id}/statement-management`).send({ selections: [{
      trainingProblemId: tp.id, visibleOptionKeys: [`user:${versionId}`], defaultOptionKey: `user:${versionId}`,
    }] })
    expect(first.status).toBe(200)

    await client.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '活动第二版' })
    const matrix = await client.get(`/api/trainings/${training.id}/statement-management`)
    const canonical = matrix.body.data.problems[0].options.find((item: any) => item.sourceType === 'canonical')
    expect(canonical).toBeTruthy()
    const second = await client.put(`/api/trainings/${training.id}/statement-management`).send({ selections: [{
      trainingProblemId: tp.id,
      visibleOptionKeys: [`user:${versionId}`, canonical.key],
      defaultOptionKey: `user:${versionId}`,
    }] })
    expect(second.status).toBe(200)
    const latest = await prisma.trainingProblemStatementSet.findFirstOrThrow({
      where: { trainingProblemId: tp.id }, orderBy: { revision: 'desc' }, include: { Snapshot: true },
    })
    expect(latest.revision).toBe(2)
    expect(latest.Snapshot.find(item => item.sourceContentId === versionId)?.content).toBe('活动第一版')
  })
})
