import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestApp } from './helpers/testRequest'

const app = createTestApp()

describe('retired school problem-list API', () => {
  it.each([
    ['GET', '/api/schools/legacy-school/problem-lists'],
    ['POST', '/api/schools/legacy-school/problem-lists'],
    ['DELETE', '/api/schools/legacy-school/problem-lists/legacy-link']
  ] as const)('%s %s returns the explicit retirement contract', async (method, path) => {
    const before = await prisma.problemList.count()
    const response = await request(app)[method.toLowerCase() as 'get' | 'post' | 'delete'](path)
      .send({ problemListId: 'legacy-list' })

    expect(response.status).toBe(410)
    expect(response.body).toMatchObject({
      success: false,
      code: 'LEGACY_SCHOOL_API_RETIRED'
    })
    expect(await prisma.problemList.count()).toBe(before)
  })
})
