import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  status: 'pending',
  findCalls: 0,
  updateCalls: 0,
}))

vi.mock('../src/prisma', () => ({
  prisma: {
    ojFetchJob: {
      findFirst: vi.fn(async () => {
        state.findCalls += 1
        return state.status === 'pending'
          ? { id: 'job-1', platform: 'luogu', problemId: 'P1000', status: state.status, createdAt: new Date(0) }
          : null
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        state.updateCalls += 1
        if (where.id === 'job-1' && where.status === 'pending' && state.status === 'pending') {
          state.status = data.status
          return { count: 1 }
        }
        return { count: 0 }
      }),
    },
  },
}))
vi.mock('../src/modules/problem/problem.access', () => ({
  canModifyProblem: vi.fn(),
  canViewProblem: vi.fn(),
}))

import { claimNextOjFetchJob } from '../src/modules/oj-fetcher/application/oj-fetcher-queue.service'

describe('OJ fetch queue database claim', () => {
  beforeEach(() => {
    state.status = 'pending'
    state.findCalls = 0
    state.updateCalls = 0
  })

  it('allows exactly one claimant across concurrent workers', async () => {
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimNextOjFetchJob('luogu')))
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims.find(Boolean)).toMatchObject({ id: 'job-1', status: 'fetching' })
    expect(state.status).toBe('fetching')
  })
})
