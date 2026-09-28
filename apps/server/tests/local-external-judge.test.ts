import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { submitRouter } from '../src/routes/submit'
import { contestRouter } from '../src/modules/contest/contest.routes'
import { prisma } from '../src/prisma'
import { createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { acquireTestSetReader } from '../src/modules/problem/problem.testset-slot.service'

const app = express()
app.use(express.json())
app.use('/api/submit', submitRouter)
app.use('/api', contestRouter)

async function fixture(judgeConfig: string | null = 'mode: acm\ncases: []\n', withTestdata = true) {
  const actor = await createTestUser({ accountRole: 'platform_admin' })
  const token = generateTestToken({ userId: actor.user.id, username: actor.user.username, workspaceMode: 'personal', accountRole: 'platform_admin' })
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
  it('queues a local submission for an external-source problem', async () => {
    const { actor, token, problem } = await fixture()
    const response = await request(app)
      .post('/api/submit')
      .set('Cookie', 'oi_session=' + token)
      .send({
        problemId: problem.problemId,
        oj: problem.platform,
        language: 'cpp',
        code: 'int main() { return 0; }',
        submitMethod: 'local',
      })

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const submission = await prisma.submission.findUniqueOrThrow({
      where: { id: response.body.data.submissionId },
      include: { CurrentJudgeRun: true },
    })
    expect(submission).toMatchObject({
      userId: actor.user.id,
      oj: 'codeforces',
      problemId: problem.problemId,
      problemInternalId: problem.id,
      submitMethod: 'local',
      ojRemoteId: null,
      CurrentJudgeRun: expect.objectContaining({ status: 'QUEUED' }),
    })
  })

  it('rejects code submission when local judge data is not configured', async () => {
    const { token, problem } = await fixture(null, false)
    const response = await request(app)
      .post('/api/submit')
      .set('Cookie', `oi_session=${token}`)
      .send({
        problemId: problem.problemId,
        oj: problem.platform,
        language: 'cpp',
        code: 'int main() {}',
        submitMethod: 'local',
      })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('LOCAL_JUDGE_NOT_CONFIGURED')
    expect(await prisma.submission.count({ where: { problemInternalId: problem.id } })).toBe(0)
  })

  it('persists independent submission IO in Submission and JudgeRun', async () => {
    const { token, problem } = await fixture()
    const response = await request(app).post('/api/submit').set('Cookie', `oi_session=${token}`).send({
      problemId: problem.problemId, oj: problem.platform, language: 'cpp',
      code: 'int main() { return 0; }', submitMethod: 'local',
      inputFilename: 'travel.in', outputFilename: 'answer.txt',
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: response.body.data.submissionId }, include: { CurrentJudgeRun: true } })
    expect(submission).toMatchObject({ inputFilename: 'travel.in', outputFilename: 'answer.txt', ioAdapterVersion: 1 })
    expect(submission.CurrentJudgeRun).toMatchObject({ inputFilename: 'travel.in', outputFilename: 'answer.txt', ioAdapterVersion: 1 })
  })

  it('rejects unsafe submission IO before creating a record', async () => {
    const { token, problem } = await fixture()
    const response = await request(app).post('/api/submit').set('Cookie', `oi_session=${token}`).send({
      problemId: problem.problemId, oj: problem.platform, language: 'cpp',
      code: 'int main() { return 0; }', inputFilename: '../travel.in',
    })
    expect(response.status).toBe(422)
    expect(response.body.code).toBe('INVALID_SUBMISSION_IO')
    expect(await prisma.submission.count({ where: { problemInternalId: problem.id } })).toBe(0)
  })

  it('rejects code submission when the judge config has no local testdata', async () => {
    const { token, problem } = await fixture('mode: acm\ncases: []\n', false)
    const response = await request(app)
      .post('/api/submit')
      .set('Cookie', `oi_session=${token}`)
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

  it('queues an external contest problem locally using its held Stable slot', async () => {
    const { actor, token, problem } = await fixture()
    const now = Date.now()
    const slot = await prisma.problemTestSetSlot.create({ data: {
      problemId: problem.id, slot: 'STABLE', mode: 'acm', source: 'initial',
      judgeConfig: 'mode: acm\ncases: []\n', judgeConfigHash: 'external-local-judge', graphHash: 'external-local-judge',
      materializedPath: 'slots/stable', fencingToken: 1,
    } })
    const contest = await prisma.contest.create({
      data: {
        id: crypto.randomUUID(), title: 'External local judge contest', format: 'icpc', type: 'judged', scope: 'platform',
        contestDate: new Date(now - 60_000), startAt: new Date(now - 60_000), endAt: new Date(now + 60_000),
        status: 'ongoing', createdBy: actor.user.id,
      },
    })
    const contestProblemId = crypto.randomUUID()
    const heldStable = await acquireTestSetReader({
      problemId: problem.id, slot: 'STABLE', ownerType: 'CONTEST_PROBLEM', ownerId: contestProblemId,
    })
    const contestProblem = await prisma.contestProblem.create({
      data: {
        id: contestProblemId, contestId: contest.id, canonicalProblemId: problem.id, testSetSlot: 'STABLE', testSetGraphHash: slot.graphHash, testSetJudgeConfigHash: slot.judgeConfigHash, testSetFencingToken: slot.fencingToken, testSetReaderId: heldStable.reader.id,
        alias: 'A', orderIndex: 1, points: 100, title: problem.title, ojName: problem.platform, problemId: problem.problemId,
      },
    })
    await prisma.problem.update({ where: { id: problem.id }, data: { judgeConfig: null } })

    const response = await request(app)
      .post(`/api/contests/${contest.publicId}/submit`)
      .set('Cookie', `oi_session=${token}`)
      .send({
        contestProblemId: contestProblem.id,
        language: 'cpp',
        code: 'int main() { return 0; }',
        submitMethod: 'myAccount',
      })

    expect(response.status).toBe(200)
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: response.body.data.submissionId } })
    expect(submission).toMatchObject({
      oj: 'codeforces',
      problemInternalId: problem.id,
      canonicalContestId: contest.id,
      canonicalContestProblemId: contestProblem.id,
      testSetSlot: 'STABLE',
      testSetGraphHash: slot.graphHash,
      submitMethod: 'local',
      ojRemoteId: null,
    })
  })
})
