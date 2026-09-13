import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AssignmentProgressDataSchema,
  BlogDiscoveryDetailSchema,
  ContestRatingDataSchema,
  SimilarityComparisonSchema,
} from '@oi-manager/contracts'

describe('feature slice contracts', () => {
  it('accepts explicit empty assignment progress and rejects malformed pagination', () => {
    expect(AssignmentProgressDataSchema.safeParse({
      recipients: [],
      problems: [],
      pagination: { page: 1, pageSize: 40, total: 0, totalPages: 0 },
    }).success).toBe(true)
    expect(AssignmentProgressDataSchema.safeParse({
      recipients: [],
      problems: [],
      pagination: { page: 0, pageSize: 40, total: 0, totalPages: 0 },
    }).success).toBe(false)
  })

  it('keeps public blog metadata and review excerpts in shared runtime schemas', () => {
    expect(BlogDiscoveryDetailSchema.safeParse({
      id: 'post-1',
      type: 'ARTICLE',
      visibility: 'PUBLIC',
      author: { username: 'author' },
      currentVersion: {
        title: '文章',
        version: 1,
        contentMarkdown: '正文',
        references: [],
      },
    }).success).toBe(true)
    expect(SimilarityComparisonSchema.safeParse({
      riskLevel: 'LOW',
      textSimilarityBasisPoints: 100,
      codeSimilarityBasisPoints: 200,
      maximumSimilarityBasisPoints: 200,
      source: null,
      matches: [],
    }).success).toBe(true)
  })

  it('normalizes server Date objects at the Rating response boundary', () => {
    const parsed = ContestRatingDataSchema.parse({
      finalizationStatus: 'FINALIZED',
      config: { scope: 'GLOBAL', track: 'OI', weight: 1, lockedAt: new Date('2026-09-14T00:00:00Z') },
      standing: { revision: 1, finalizedAt: new Date('2026-09-14T00:01:00Z'), entries: [] },
      batches: [],
      myChanges: [],
    })
    expect(parsed.config.lockedAt).toBe('2026-09-14T00:00:00.000Z')
    expect(parsed.standing?.finalizedAt).toBe('2026-09-14T00:01:00.000Z')
  })

  it('routes pages through feature public APIs instead of component internals', () => {
    const page = fs.readFileSync(new URL('../app/blog/page.tsx', import.meta.url), 'utf8')
    const organization = fs.readFileSync(new URL('../app/org/[organizationId]/[module]/[...segments]/page.tsx', import.meta.url), 'utf8')
    expect(page).toContain("from '@/features/blog'")
    expect(organization).toContain("from '@/features/assignment'")
    expect(organization).not.toMatch(/@\/components\/(?:assignment|blog|submission)\//)
    expect(organization).not.toMatch(/@\/features\/(?:assignment|blog|submission)\//)
  })
})
