import crypto from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'
import {
  listContentOptions,
  selectTrainingProblemContent,
} from '../src/modules/problem/problem.content.service'
import {
  replaceContentShares,
  saveMarkdownContent,
} from '../src/modules/problem/problem.user-content.routes'

const app = createTestApp()

describe('用户专属题面、题解与活动快照', () => {
  let author: Awaited<ReturnType<typeof createTestUser>>
  let peer: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>
  let organizationId: string

  beforeEach(async () => {
    author = await createTestUser({ role: 'teacher' })
    peer = await createTestUser({ role: 'teacher', schoolId: author.schoolId })
    problem = await createTestProblem({ ownerId: author.user.id, title: '快照测试题' })
    organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: author.schoolId } })).organizationId!
  })

  it('每位用户每题每种内容只保留一份当前版本，并递增 revision', async () => {
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const first = await client.put(`/api/problems/${problem.id}/my-content/statement`).send({
      title: '我的题面', language: 'zh', content: '# 第一版',
    })
    expect(first.status).toBe(200)
    expect(first.body.data.revision).toBe(1)

    const second = await client.put(`/api/problems/${problem.id}/my-content/statement`).send({
      title: '我的题面', language: 'zh', content: '# 第二版',
    })
    expect(second.status).toBe(200)
    expect(second.body.data.revision).toBe(2)
    expect(await prisma.userProblemContent.count({
      where: { problemId: problem.id, userId: author.user.id, kind: 'statement' },
    })).toBe(1)
  })

  it('个人内容默认私有，my-content 不会读取他人的版本', async () => {
    await saveMarkdownContent({
      problemId: problem.id, userId: author.user.id, kind: 'solution', language: 'zh', content: '作者私有题解',
    })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(peer.user))
    const response = await client.get(`/api/problems/${problem.id}/my-content`)
    expect(response.status).toBe(200)
    expect(response.body.data.contents).toEqual([])

    const options = await listContentOptions(problem.id, peer.user.id, organizationId)
    expect(options.solution.some(option => option.authorUserId === author.user.id)).toBe(false)
  })

  it('校园共享生效，且不能共享到未加入的校园', async () => {
    const content = await saveMarkdownContent({
      problemId: problem.id, userId: author.user.id, kind: 'statement', language: 'zh', content: '校园共享题面',
    })
    await replaceContentShares(content.id, author.user.id, [`organization:${organizationId}`])
    const options = await listContentOptions(problem.id, peer.user.id, organizationId)
    expect(options.statement.some(option => option.sourceId === content.id)).toBe(true)
    await expect(replaceContentShares(content.id, author.user.id, ['organization:not-a-member']))
      .rejects.toThrow('不能共享到未加入的校园')
  })

  it('活动更换内容创建新 revision，旧快照保持不可变', async () => {
    const content = await saveMarkdownContent({
      problemId: problem.id, userId: author.user.id, kind: 'statement', title: '个人版', language: 'zh', content: '活动第一版',
    })
    const training = await prisma.training.create({
      data: {
        title: '内容快照测试', startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
        status: 'ongoing', createdBy: author.user.id, organizationId,
      },
    })
    const trainingProblem = await prisma.trainingProblem.create({
      data: { id: crypto.randomUUID(), trainingId: training.id, problemId: problem.id, alias: 'A', orderIndex: 0 },
    })
    const select = async () => selectTrainingProblemContent({
      trainingProblemId: trainingProblem.id,
      problemId: problem.id,
      selectedBy: author.user.id,
      organizationId,
      statementOptionKey: `user:${content.id}`,
      solutionOptionKey: 'none',
    })
    await select()
    await saveMarkdownContent({
      problemId: problem.id, userId: author.user.id, kind: 'statement', title: '个人版', language: 'zh', content: '活动第二版',
    })
    await select()

    const snapshots = await prisma.trainingProblemContentSnapshot.findMany({
      where: { trainingProblemId: trainingProblem.id, kind: 'statement' }, orderBy: { revision: 'asc' },
    })
    expect(snapshots.map(item => [item.revision, item.content, item.sourceRevision])).toEqual([
      [1, '活动第一版', 1],
      [2, '活动第二版', 2],
    ])
  })
})
