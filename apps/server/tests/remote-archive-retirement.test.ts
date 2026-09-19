import crypto from 'node:crypto'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApplication } from '../src/app'
import { prisma } from '../src/prisma'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createApplication({ disableRateLimit: true, allowAnyCorsOrigin: true })

describe('retired remote code archive', () => {
  it.each([
    ['post', '/api/platform-bindings/codeforces/sync-archive'],
    ['post', '/api/platform-bindings/codeforces/sync-submissions'],
    ['post', '/api/platform-bindings/luogu/sync-archive'],
    ['post', '/api/platform-bindings/luogu/sync-submissions'],
    ['get', '/api/archived-problems'],
    ['post', '/api/archived-problems'],
    ['put', '/api/archived-problems/1'],
    ['delete', '/api/archived-problems/1'],
    ['post', '/api/submissions/1/refetch-code'],
  ] as const)('does not expose %s %s', async (method, endpoint) => {
    const actor = await createTestUser({ role: 'student' })
    const response = await request(app)[method](endpoint)
      .set('Cookie', `oi_session=${generateTokenFromUser(actor.user)}`)
      .send({})
    expect(response.status).toBe(404)
  })

  it('rejects remote archive rows while retaining normal remote identity fields', async () => {
    const actor = await createTestUser({ role: 'student' })
    await expect(prisma.submission.create({
      data: {
        userId: actor.user.id,
        oj: 'codeforces',
        problemId: '1A',
        language: 'cpp17',
        code: '',
        codeLength: 0,
        submitMethod: 'archive',
        ojRemoteId: `retired-${crypto.randomUUID()}`,
      },
    })).rejects.toThrow()
  })
})
