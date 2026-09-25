import crypto from 'crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestProblem } from './helpers/problemListHelpers'
import { prisma } from '../src/prisma'
import { fileService } from '../src/lib/storage'

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
    organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: author.organization!.organizationId } })).organizationId!
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
    const first = await client.put(`/api/contests/${training.id}/statement-management`).send({ selections: [{
      trainingProblemId: tp.id, visibleOptionKeys: [`user:${versionId}`], defaultOptionKey: `user:${versionId}`,
    }] })
    expect(first.status).toBe(200)

    await client.put(`/api/problems/${problem.id}/statement-versions/${versionId}/content`).send({ content: '活动第二版' })
    const matrix = await client.get(`/api/contests/${training.id}/statement-management`)
    const canonical = matrix.body.data.problems[0].options.find((item: any) => item.sourceType === 'canonical')
    expect(canonical).toBeTruthy()
    expect(canonical.name).toBe('官方中文')
    const second = await client.put(`/api/contests/${training.id}/statement-management`).send({ selections: [{
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

  it('活动题面选择使用 revision 拒绝陈旧管理员覆盖', async () => {
    await prisma.problem.update({ where: { id: problem.id }, data: { description: '# 官方题面' } })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const training = await prisma.training.create({ data: {
      title: '题面并发保护', startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
      status: 'ongoing', createdBy: author.user.id, organizationId,
    } })
    const tp = await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(), trainingId: training.id, problemId: problem.id, alias: 'A', orderIndex: 0,
    } })
    const matrix = await client.get(`/api/contests/${training.id}/statement-management`)
    const item = matrix.body.data.problems[0]
    const canonical = item.options.find((option: any) => option.sourceType === 'canonical')
    const selection = {
      trainingProblemId: tp.id,
      visibleOptionKeys: [canonical.key],
      defaultOptionKey: canonical.key,
      expectedSelectionRevision: item.selectionRevision,
    }
    expect((await client.put(`/api/contests/${training.id}/statement-management`).send({ selections: [selection] })).status).toBe(200)
    const stale = await client.put(`/api/contests/${training.id}/statement-management`).send({ selections: [selection] })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('STATEMENT_SELECTION_STALE')
  })

  it('管理员编辑活动题面会创建新集合并拒绝陈旧或非管理员写入', async () => {
    await prisma.problem.update({ where: { id: problem.id }, data: { description: '原始官方题面' } })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const participant = await createTestUser({ organization: { role: 'student', organizationId: author.organization!.organizationId } })
    const participantClient = createAuthenticatedRequest(app, generateTokenFromUser(participant.user))
    const training = await prisma.training.create({ data: {
      title: '活动快照编辑', startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
      status: 'ongoing', createdBy: author.user.id, organizationId,
    } })
    const tp = await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(), trainingId: training.id, problemId: problem.id, alias: 'A', orderIndex: 0,
    } })
    const matrix = await client.get(`/api/contests/${training.id}/statement-management`)
    const canonical = matrix.body.data.problems[0].options.find((item: any) => item.sourceType === 'canonical')
    await client.put(`/api/contests/${training.id}/statement-management`).send({ selections: [{
      trainingProblemId: tp.id, visibleOptionKeys: [canonical.key], defaultOptionKey: canonical.key,
    }] })
    const before = await prisma.trainingProblemStatementSet.findFirstOrThrow({
      where: { trainingProblemId: tp.id }, orderBy: { revision: 'desc' }, include: { Snapshot: true },
    })
    const oldSnapshot = before.Snapshot[0]
    const forbidden = await participantClient.put(`/api/contests/${training.id}/problems/${tp.id}/content-snapshots/statement/${oldSnapshot.id}`).send({ content: '越权内容' })
    expect(forbidden.status).toBe(403)

    const edited = await client.put(`/api/contests/${training.id}/problems/${tp.id}/content-snapshots/statement/${oldSnapshot.id}`).send({ content: '活动专属题面' })
    expect(edited.status).toBe(200)
    expect(edited.body.data.revision).toBe(before.revision + 1)
    const after = await prisma.trainingProblemStatementSet.findFirstOrThrow({
      where: { trainingProblemId: tp.id }, orderBy: { revision: 'desc' }, include: { Snapshot: true },
    })
    expect(after.Snapshot[0].content).toBe('活动专属题面')
    expect(after.Snapshot[0].sourceType).toBe('training')
    expect(after.Snapshot[0].sourceContentId).toBe(oldSnapshot.id)
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).description).toBe('原始官方题面')
    expect((await prisma.trainingProblemStatementSnapshot.findUniqueOrThrow({ where: { id: oldSnapshot.id } })).content).toBe('原始官方题面')

    const stale = await client.put(`/api/contests/${training.id}/problems/${tp.id}/content-snapshots/statement/${oldSnapshot.id}`).send({ content: '陈旧覆盖' })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('CONTENT_SNAPSHOT_STALE')
    expect((await client.post(`/api/contests/${training.id}/problems/${tp.id}/statement-versions`).send({ name: '禁止创建' })).status).toBe(404)
    expect((await client.put(`/api/contests/${training.id}/problems/${tp.id}/my-content/statement`).send({ content: '禁止写入' })).status).toBe(404)
    expect((await client.put(`/api/contests/${training.id}/problems/${tp.id}/my-content/statement/shares`).send({ shareKeys: ['platform'] })).status).toBe(404)
    expect((await client.delete(`/api/contests/${training.id}/problems/${tp.id}/my-content/statement`)).status).toBe(404)
  })

  it('管理员编辑活动题解会追加 revision 并保留旧快照', async () => {
    const client = createAuthenticatedRequest(app, generateTokenFromUser(author.user))
    const training = await prisma.training.create({ data: {
      title: '活动题解编辑', startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
      status: 'ongoing', createdBy: author.user.id, organizationId,
    } })
    const tp = await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(), trainingId: training.id, problemId: problem.id, alias: 'A', orderIndex: 0,
    } })
    const old = await prisma.trainingProblemContentSnapshot.create({ data: {
      id: crypto.randomUUID(), trainingProblemId: tp.id, kind: 'solution', revision: 1,
      sourceType: 'canonical', format: 'markdown', language: 'zh', content: '旧题解',
      selectedBy: author.user.id,
    } })
    const edited = await client.put(`/api/contests/${training.id}/problems/${tp.id}/content-snapshots/solution/${old.id}`).send({ content: '活动新题解' })
    expect(edited.status).toBe(200)
    expect(edited.body.data.revision).toBe(2)
    const snapshots = await prisma.trainingProblemContentSnapshot.findMany({
      where: { trainingProblemId: tp.id, kind: 'solution' }, orderBy: { revision: 'asc' },
    })
    expect(snapshots.map(item => [item.revision, item.content, item.sourceType])).toEqual([
      [1, '旧题解', 'canonical'], [2, '活动新题解', 'training'],
    ])
    const options = await client.get(`/api/contests/${training.id}/problems/${tp.id}/content-options`)
    expect(options.status).toBe(200)
    expect(options.body.data.currentSelection.solutionOptionKey).toBe(`snapshot:${edited.body.data.snapshotId}`)
    const preview = await client.get(`/api/contests/${training.id}/problems/${tp.id}/content-options/${encodeURIComponent(`snapshot:${edited.body.data.snapshotId}`)}/preview`)
    expect(preview.status).toBe(200)
    expect(preview.body.data.content).toBe('活动新题解')
  })

  it('管理员替换活动 PDF 会保留旧文件与旧快照', async () => {
    const token = generateTokenFromUser(author.user)
    const training = await prisma.training.create({ data: {
      title: '活动 PDF 编辑', startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
      status: 'ongoing', createdBy: author.user.id, organizationId,
    } })
    const tp = await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(), trainingId: training.id, problemId: problem.id, alias: 'A', orderIndex: 0,
    } })
    const originalFile = await fileService.upload(Buffer.from('%PDF-1.4\noriginal'), {
      category: 'pdf', ownerType: 'training_content', ownerId: tp.id,
      originalName: 'original.pdf', mimeType: 'application/pdf', isPublic: false,
    })
    const set = await prisma.trainingProblemStatementSet.create({ data: {
      id: crypto.randomUUID(), trainingProblemId: tp.id, revision: 1, selectedBy: author.user.id,
    } })
    const oldSnapshot = await prisma.trainingProblemStatementSnapshot.create({ data: {
      id: crypto.randomUUID(), statementSetId: set.id, sourceType: 'canonical', name: 'PDF 题面',
      format: 'pdf', snapshotFileId: originalFile.id, fileName: 'original.pdf', isDefault: true, orderIndex: 0,
    } })
    const response = await request(app)
      .post(`/api/contests/${training.id}/problems/${tp.id}/content-snapshots/statement/${oldSnapshot.id}/pdf`)
      .set('Cookie', `oi_session=${token}`)
      .attach('file', Buffer.from('%PDF-1.4\nreplacement'), { filename: 'replacement.pdf', contentType: 'application/pdf' })
    expect(response.status).toBe(200)
    const latest = await prisma.trainingProblemStatementSet.findFirstOrThrow({
      where: { trainingProblemId: tp.id }, orderBy: { revision: 'desc' }, include: { Snapshot: true },
    })
    expect(latest.revision).toBe(2)
    expect(latest.Snapshot[0].snapshotFileId).not.toBe(originalFile.id)
    expect((await prisma.trainingProblemStatementSnapshot.findUniqueOrThrow({ where: { id: oldSnapshot.id } })).snapshotFileId).toBe(originalFile.id)
    expect((await fileService.download(originalFile.id)).buffer.toString()).toContain('original')
  })
})
