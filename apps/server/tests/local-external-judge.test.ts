import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { submitRouter } from '../src/routes/submit'
import { trainingsRouter } from '../src/modules/training/training.routes'
import { prisma } from '../src/prisma'
import { createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'

const app = express()
app.use(express.json())
app.use('/api/submit', submitRouter)
app.use('/api', trainingsRouter)

async function fixture(judgeConfig: string | null = 'mode: acm\ncases: []\n', withTestdata = true) {
  const actor = await createTestUser({ role: 'platform_admin' })
  const token = generateTestToken({
    userId: actor.user.id,
    username: actor.user.username,
    role: 'platform_admin',
    workspaceMode: 'personal',
  })
  const suffix = crypto.randomUUID()
  const problem = await prisma.problem.create({
    data: {
      id: `external-${suffix}`,
      platform: 'codeforces',
      problemId: `1000A-${suffix}`,
      title: 'External source with local data',
      ownerId: actor.user.id,
      visibility: 'public',
      libraryScope: 'platform',
      libraryKey: 'platform',
      status: 'published',
      publishedAt: new Date(),
      judgeConfig,
    },
  })
  if (withTestdata) {
    await prisma.testdataFile.create({
      data: {
        id: crypto.randomUUID(),
        problemId: problem.id,
        filename: '1.in',
        size: 1,
      },
    })
  }
  return { actor, token, problem }
}

describe('external-source local judging', () => {
  it.each(['robot', 'myAccount', 'local'])('normalizes legacy %s submissions to the local queue', async submitMethod => {
    const { actor, token, problem } = await fixture()
    const response = await request(app)
      .post('/api/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problemId: problem.problemId,
        oj: problem.platform,
        language: 'cpp',
        code: 'int main() { return 0; }',
        submitMethod,
      })

    expect(response.status).toBe(200)
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: response.body.data.submissionId } })
    expect(submission).toMatchObject({
      userId: actor.user.id,
      oj: 'codeforces',
      problemId: problem.problemId,
      problemInternalId: problem.id,
      submitMethod: 'local',
      result: 'queuing',
      ojRemoteId: null,
    })
  })

  it('rejects code submission when local judge data is not configured', async () => {
    const { token, problem } = await fixture(null, false)
    const response = await request(app)
      .post('/api/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problemId: problem.problemId,
        oj: problem.platform,
        language: 'cpp',
        code: 'int main() {}',
        submitMethod: 'robot',
      })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('LOCAL_JUDGE_NOT_CONFIGURED')
    expect(await prisma.submission.count({ where: { problemInternalId: problem.id } })).toBe(0)
  })

  it('rejects code submission when the judge config has no local testdata', async () => {
    const { token, problem } = await fixture('mode: acm\ncases: []\n', false)
    const response = await request(app)
      .post('/api/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problemId: problem.problemId,
        oj: problem.platform,
        language: 'cpp',
        code: 'int main() {}',
        submitMethod: 'local',
      })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('LOCAL_JUDGE_NOT_CONFIGURED')
  })

  it('rejects archive payloads at the code submission endpoint', async () => {
    const { token, problem } = await fixture()
    const response = await request(app)
      .post('/api/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problemId: problem.problemId,
        oj: problem.platform,
        language: 'cpp',
        code: 'int main() {}',
        submitMethod: 'archive',
      })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('USE_ARCHIVE_SYNC')
  })

  it('does not enqueue an imported archive record for rejudge', async () => {
    const { actor, token, problem } = await fixture()
    const archived = await prisma.submission.create({
      data: {
        userId: actor.user.id,
        workspaceScope: 'personal',
        oj: problem.platform,
        problemId: problem.problemId,
        problemInternalId: problem.id,
        language: 'cpp',
        code: '',
        codeLength: 0,
        result: 'accepted',
        score: 100,
        submitMethod: 'archive',
        submitScope: 'problem',
        ojRemoteId: 'remote-123',
      },
    })

    const response = await request(app)
      .post('/api/submit/rejudge')
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: archived.id })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: false, message: '远程归档记录不支持重新评测' })
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: archived.id } })).result).toBe('accepted')
  })

  it('queues an external training problem locally using its judge config snapshot', async () => {
    const { actor, token, problem } = await fixture()
    const now = Date.now()
    const training = await prisma.training.create({
      data: {
        title: 'External local judge training',
        format: 'icpc',
        type: 'training',
        scope: 'campus',
        organizationId: 'platform-organization-00000000',
        startTime: new Date(now - 60_000),
        endTime: new Date(now + 60_000),
        status: 'ongoing',
        createdBy: actor.user.id,
        updatedAt: new Date(),
      },
    })
    const trainingProblem = await prisma.trainingProblem.create({
      data: {
        id: crypto.randomUUID(),
        trainingId: training.id,
        problemId: problem.id,
        alias: 'A',
        orderIndex: 1,
        points: 100,
        judgeConfigSnapshot: 'mode: acm\ncases: []\n',
      },
    })
    await prisma.problem.update({ where: { id: problem.id }, data: { judgeConfig: null } })

    const response = await request(app)
      .post(`/api/trainings/${training.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        trainingProblemId: trainingProblem.id,
        language: 'cpp',
        code: 'int main() { return 0; }',
        submitMethod: 'myAccount',
      })

    expect(response.status).toBe(200)
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: response.body.data.submissionId } })
    expect(submission).toMatchObject({
      oj: 'codeforces',
      problemInternalId: problem.id,
      trainingId: training.id,
      trainingProblemId: trainingProblem.id,
      submitMethod: 'local',
      result: 'queuing',
      ojRemoteId: null,
    })
  })
})
