import fs from 'node:fs'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ProblemSelectionBodySchema, ResolvedProblemSelectionSchema } from '@oi-manager/contracts'

const database = vi.hoisted(() => ({ findMany: vi.fn(), slotFindMany: vi.fn(), unexpected: vi.fn() }))
vi.mock('../src/prisma', () => ({ prisma: {
  problem: {
    findMany: database.findMany,
    findUnique: database.unexpected,
    create: database.unexpected,
    update: database.unexpected,
    upsert: database.unexpected,
  },
  problemTestSetSlot: { findMany: database.slotFindMany },
  $transaction: database.unexpected,
} }))
vi.mock('../src/modules/authorization/capabilities', () => ({
  requestHasOrganizationCapability: (user: { organizationCapabilities?: string[] }, capability: string) => user.organizationCapabilities?.includes(capability) || false,
  requestOrganizationCapabilityScope: (user: { organizationCapabilities?: string[] }, capability: string) => user.organizationCapabilities?.includes(`${capability}:all`) ? 'all' : user.organizationCapabilities?.includes(`${capability}:own`) ? 'own' : null,
}))

import { resolveProblemSelection } from '../src/modules/problem-selection/problem-selection.service'

type User = Parameters<typeof resolveProblemSelection>[0]
type Candidate = {
  id: string; platform: string; problemId: string; title: string; difficulty: string | null
  libraryScope: string; organizationId: string | null; ownerId: string; status: string; visibility: string
  TestSetSlots: Array<{ slot: 'STABLE' | 'EVOLVING'; graphHash: string; fencingToken: number; mode: string }>
}
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: 'internal-1', platform: 'luogu', problemId: 'P1001', title: 'Local example', difficulty: null,
  libraryScope: 'platform', organizationId: null, ownerId: 'manager', status: 'published', visibility: 'public',
  TestSetSlots: [], ...overrides,
})
const personal = { userId: 'reader', username: 'reader', accountRole: 'user' } as User
const manager = { ...personal, userId: 'manager', accountRole: 'platform_admin' } as User
const teacher = {
  ...personal, userId: 'teacher', organizationId: 'org-a', organizationRole: 'teacher',
  organizationCapabilities: ['organization.view', 'problem.create', 'problem.manage:own'],
} as User
let records: Candidate[] = []
const lookup = (platform: string, problemId: string, user = personal) => resolveProblemSelection(user, {
  items: [{ clientKey: 'row-1', platform, problemId }],
})

beforeEach(() => {
  vi.clearAllMocks()
  records = []
  database.unexpected.mockImplementation(() => { throw new Error('Unexpected database operation') })
  database.slotFindMany.mockImplementation(({ where }) => {
    const ids = new Set(where.problemId.in as string[])
    return records.flatMap(record => ids.has(record.id)
      ? record.TestSetSlots.map(slot => ({ problemId: record.id, ...slot }))
      : [])
  })
  database.findMany.mockImplementation(({ where }) => {
    const pairs = where.AND[0].OR as Array<{ platform: string; problemId: string }>
    const scopes = where.AND[1].OR as Array<{ libraryScope: string; organizationId?: string }>
    return records.filter(record =>
      pairs.some(pair => pair.platform === record.platform && pair.problemId === record.problemId)
      && scopes.some(scope => scope.libraryScope === record.libraryScope && (!scope.organizationId || scope.organizationId === record.organizationId)),
    )
  })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External IO is forbidden in lookup') }))
})
afterEach(() => {
  expect(database.unexpected).not.toHaveBeenCalled()
  expect(globalThis.fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

describe('read-only local primary identity lookup', () => {
  it('maps Chinese display names and trims numbers without requiring Stable', async () => {
    records = [candidate()]
    const result = await lookup(' 洛谷 ', ' P1001 ')
    expect(result.items[0]).toMatchObject({ platform: 'luogu', problemId: 'P1001', status: 'resolved', problem: { id: 'internal-1' } })
    expect(result.items[0].problem?.stableData).toBeUndefined()
    expect(database.findMany).toHaveBeenCalledTimes(1)
    expect(database.findMany.mock.calls[0][0].where.AND[0]).toEqual({ OR: [{ platform: 'luogu', problemId: 'P1001' }] })
  })

  it('keeps number case, prefix and leading zeroes exact', async () => {
    records = [candidate(), candidate({ id: 'hdu-1', platform: 'hdu', problemId: '00123' })]
    expect((await lookup('Luogu', 'p1001')).items[0].status).toBe('not_found')
    expect((await lookup('HDU', '123')).items[0].status).toBe('not_found')
    expect((await lookup('HDU', '00123')).items[0].status).toBe('resolved')
    expect((await lookup('codeforces', 'CF2036G')).items[0].status).toBe('not_found')
  })

  it('never interprets a Carits input as the internal UUID', async () => {
    const id = '00000000-0000-0000-0000-000000000001'
    records = [candidate({ id, platform: 'carits', problemId: '10086' })]
    expect((await lookup('Carits平台', id)).items[0].status).toBe('not_found')
    expect((await lookup('CARITS', '10086')).items[0].problem?.id).toBe(id)
  })

  it('does not search titles or require a fetch adapter', async () => {
    records = [candidate({ platform: 'uva', problemId: '100', title: 'P1001' })]
    expect((await lookup('UVA', '100')).items[0].status).toBe('resolved')
    expect((await lookup('UVA', 'P1001')).items[0].status).toBe('not_found')
    const source = fs.readFileSync(new URL('../src/modules/problem-selection/problem-selection.service.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/ojBindings|findAccessibleProblem|findUsableProblemByExternalId|oj-adapters|oj-fetcher/)
  })

  it('returns invalid_input for an unregistered platform without querying', async () => {
    expect((await lookup('CF', '2036G')).items[0]).toMatchObject({ status: 'invalid_input', platform: '' })
    expect(database.findMany).not.toHaveBeenCalled()
  })

  it('preserves batch order and client keys while querying unique exact pairs once', async () => {
    records = [candidate(), candidate({ id: 'cf-1', platform: 'codeforces', problemId: '2036G' })]
    const result = await resolveProblemSelection(personal, { items: [
      { clientKey: 'b', platform: 'CodeForces', problemId: '2036G' },
      { clientKey: 'a', platform: '洛谷', problemId: 'P1001' },
      { clientKey: 'c', platform: 'codeforces', problemId: '2036G' },
      { clientKey: 'd', platform: 'luogu', problemId: '2036G' },
    ] })
    expect(result.items.map(item => item.clientKey)).toEqual(['b', 'a', 'c', 'd'])
    expect(result.items.map(item => item.problem?.id)).toEqual(['cf-1', 'internal-1', 'cf-1', undefined])
    expect(database.findMany).toHaveBeenCalledTimes(1)
    expect(database.findMany.mock.calls[0][0].where.AND[0].OR).toHaveLength(3)
  })

  it('reports two visible library records instead of preferring a school copy', async () => {
    records = [candidate(), candidate({ id: 'school-copy', libraryScope: 'school', organizationId: 'org-a', visibility: 'private' })]
    const result = (await lookup('luogu', 'P1001', teacher)).items[0]
    expect(result.status).toBe('identity_conflict')
    expect(result.problem).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('school-copy')
  })

  it('does not count another school private record as a conflict', async () => {
    records = [candidate(), candidate({ id: 'secret', libraryScope: 'school', organizationId: 'org-b', visibility: 'private' })]
    const result = (await lookup('luogu', 'P1001', teacher)).items[0]
    expect(result.status).toBe('resolved')
    expect(result.problem?.id).toBe('internal-1')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('makes an inaccessible draft indistinguishable from an absent record', async () => {
    const absent = await lookup('luogu', 'P1001')
    records = [candidate({ status: 'draft', visibility: 'private', title: 'Secret title' })]
    expect(await lookup('luogu', 'P1001')).toEqual(absent)
  })

  it('reports manageable unpublished identities without disclosing their metadata', async () => {
    records = [candidate({ status: 'draft', title: 'Secret draft title' })]
    const result = (await lookup('luogu', 'P1001', manager)).items[0]
    expect(result).toMatchObject({ status: 'not_published' })
    expect(result.problem).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('Secret draft title')
    expect(JSON.stringify(result)).not.toContain('internal-1')
  })

  it('returns existing Stable and Evolving metadata without creating or changing it', async () => {
    records = [candidate({ TestSetSlots: [
      { slot: 'STABLE', graphHash: 'stable', fencingToken: 7, mode: 'oi' },
      { slot: 'EVOLVING', graphHash: 'evolving', fencingToken: 8, mode: 'oi' },
    ] })]
    const problem = (await lookup('luogu', 'P1001')).items[0].problem
    expect(problem?.stableData).toEqual({ slot: 'STABLE', graphHash: 'stable', fencingToken: 7, mode: 'oi' })
    expect(problem?.evolvingData).toEqual({ slot: 'EVOLVING', graphHash: 'evolving', fencingToken: 8, mode: 'oi' })
  })

  it('propagates storage failures instead of fabricating not_found rows', async () => {
    database.findMany.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(lookup('luogu', 'P1001')).rejects.toThrow('database unavailable')
  })

  it('does not compensate for un-migrated stored platform names', async () => {
    records = [candidate({ platform: '洛谷' })]
    expect((await lookup('洛谷', 'P1001')).items[0].status).toBe('not_found')
  })
})

describe('selection contract boundaries', () => {
  it('rejects batches over 100 and repeated client keys', () => {
    const item = { clientKey: 'a', platform: 'luogu', problemId: 'P1001' }
    expect(ProblemSelectionBodySchema.safeParse({ items: [item, item] }).success).toBe(false)
    expect(ProblemSelectionBodySchema.safeParse({ items: Array.from({ length: 101 }, (_, i) => ({ ...item, clientKey: String(i) })) }).success).toBe(false)
    expect(ProblemSelectionBodySchema.safeParse({ items: [item] }).success).toBe(true)
  })

  it('requires metadata for a found identity and forbids it for hidden results', () => {
    const base = { clientKey: 'a', platform: 'luogu', problemId: 'P1001' }
    const problem = { id: '1', platform: 'luogu', problemId: 'P1001', title: 'Example' }
    expect(ResolvedProblemSelectionSchema.safeParse({ ...base, status: 'resolved' }).success).toBe(false)
    expect(ResolvedProblemSelectionSchema.safeParse({ ...base, status: 'resolved', problem }).success).toBe(true)
    expect(ResolvedProblemSelectionSchema.safeParse({ ...base, status: 'not_found', problem }).success).toBe(false)
    expect(ResolvedProblemSelectionSchema.safeParse({ ...base, status: 'identity_conflict', problem }).success).toBe(false)
  })
})
