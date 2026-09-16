import crypto from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../src/prisma'
import { platformBindingRouter } from '../src/modules/platform-binding/platform-binding.routes'
import { fetchCfAllSubmissions } from '../src/modules/platform-binding/binders/codeforces-archiver'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = express()
app.use(express.json())
app.use('/api/platform-bindings', platformBindingRouter)

function cfResponse(result: unknown[], status = 'OK'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status, result }),
  } as Response
}

function submission(id: number, verdict: string, index = 'A') {
  return {
    id,
    verdict,
    creationTimeSeconds: 1_700_000_000 + id,
    programmingLanguage: 'GNU C++17',
    timeConsumedMillis: 31,
    memoryConsumedBytes: 1024 * 1024,
    problem: { contestId: 1000, index },
  }
}

async function boundUser() {
  const created = await createTestUser({ role: 'student' })
  await prisma.userPlatformBinding.create({
    data: {
      id: crypto.randomUUID(),
      userId: created.user.id,
      platform: 'codeforces',
      platformUsername: 'e2e_handle',
      bindingStatus: 'bound',
      bindingData: JSON.stringify({ handle: 'e2e_handle', jsessionid: 'test-session' }),
      verifiedAt: new Date(),
    },
  })
  return { user: created.user, token: generateTokenFromUser(created.user) }
}

afterEach(() => vi.unstubAllGlobals())

describe('remote submission archive', () => {
  it('serves one runtime contract for platform metadata, binding status and request validation', async () => {
    const platforms = await request(app).get('/api/platform-bindings/platforms')
    expect(platforms.status).toBe(200)
    expect(platforms.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codeforces', supported: true }),
      expect.objectContaining({ id: 'luogu', supported: true }),
    ]))

    const config = await request(app).get('/api/platform-bindings/codeforces/config-schema')
    expect(config.status).toBe(200)
    expect(config.body.data.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'JSESSIONID', required: true }),
    ]))

    const { token } = await boundUser()
    const bindings = await request(app)
      .get('/api/platform-bindings')
      .set('Authorization', `Bearer ${token}`)
    expect(bindings.status).toBe(200)
    expect(bindings.body.data).toEqual([
      expect.objectContaining({ platform: 'codeforces', bindingStatus: 'bound', platformUsername: 'e2e_handle' }),
    ])

    const invalid = await request(app)
      .post('/api/platform-bindings/codeforces/bind')
      .set('Authorization', `Bearer ${token}`)
      .send({ extra: { JSESSIONID: { nested: 'invalid' } } })
    expect(invalid.status).toBe(422)
    expect(invalid.body.code).toBe('API_CONTRACT_REQUEST_INVALID')
  })

  it('imports remote records as idempotent archive-only submissions', async () => {
    const { user, token } = await boundUser()
    vi.stubGlobal('fetch', vi.fn(async () => cfResponse([
      submission(7001, 'WRONG_ANSWER'),
      submission(7002, 'OK'),
    ])))

    const first = await request(app)
      .post('/api/platform-bindings/codeforces/sync-submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ problemId: '1000A' })
    expect(first.status).toBe(200)
    expect(first.body.data).toEqual({ count: 2, total: 2, skipped: 0 })

    const rows = await prisma.submission.findMany({
      where: { userId: user.id },
      orderBy: { ojRemoteId: 'asc' },
    })
    expect(rows).toHaveLength(2)
    expect(rows.map(row => ({
      remoteId: row.ojRemoteId,
      method: row.submitMethod,
      scope: row.workspaceScope,
      trainingId: row.trainingId,
      result: row.result,
      score: row.score,
    }))).toEqual([
      { remoteId: '7001', method: 'archive', scope: 'personal', trainingId: null, result: 'wa', score: 0 },
      { remoteId: '7002', method: 'archive', scope: 'personal', trainingId: null, result: 'accepted', score: 100 },
    ])
    expect(await prisma.trainingUserProblemStatus.count({ where: { userId: user.id } })).toBe(0)
    expect(await prisma.contestUserProblemStatus.count({ where: { userId: user.id } })).toBe(0)

    const repeated = await request(app)
      .post('/api/platform-bindings/codeforces/sync-submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ problemId: '1000A' })
    expect(repeated.status).toBe(200)
    expect(repeated.body.data).toEqual({ count: 0, total: 2, skipped: 2 })
    expect(await prisma.submission.count({ where: { userId: user.id } })).toBe(2)
  })

  it('returns a remote dependency error instead of reporting an empty archive', async () => {
    const { user, token } = await boundUser()
    vi.stubGlobal('fetch', vi.fn(async () => cfResponse([], 'FAILED')))

    const response = await request(app)
      .post('/api/platform-bindings/codeforces/sync-submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ problemId: '1000A' })
    expect(response.status).toBe(502)
    expect(response.body.code).toBe('REMOTE_ARCHIVE_UNAVAILABLE')
    expect(await prisma.submission.count({ where: { userId: user.id } })).toBe(0)

    const problemArchive = await request(app)
      .post('/api/platform-bindings/codeforces/sync-archive')
      .set('Authorization', `Bearer ${token}`)
      .send({ problemId: '1000A' })
    expect(problemArchive.status).toBe(502)
    expect(problemArchive.body.code).toBe('REMOTE_ARCHIVE_UNAVAILABLE')
  })

  it('rejects malformed filters before contacting the remote platform', async () => {
    const { token } = await boundUser()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const invalidProblem = await request(app)
      .post('/api/platform-bindings/codeforces/sync-submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ problemId: '../../etc/passwd' })
    expect(invalidProblem.status).toBe(400)
    expect(invalidProblem.body.code).toBe('INVALID_ARCHIVE_REQUEST')

    const invalidWindow = await request(app)
      .post('/api/platform-bindings/codeforces/sync-submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ startTime: 'not-a-date' })
    expect(invalidWindow.status).toBe(400)

    const invalidBody = await request(app)
      .post('/api/platform-bindings/codeforces/sync-submissions')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('null')
    expect(invalidBody.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps one sync request at the latest 1000 Codeforces records', async () => {
    let page = 0
    const fetchMock = vi.fn(async () => {
      const offset = page++ * 100
      return cfResponse(Array.from({ length: 100 }, (_, index) => submission(offset + index + 1, 'OK')))
    })
    vi.stubGlobal('fetch', fetchMock)

    const records = await fetchCfAllSubmissions('large_history_handle', { problemId: '1000A' })
    expect(records).toHaveLength(1000)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })
})
