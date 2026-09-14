import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AssignmentProgressDataSchema,
  BlogDiscoveryDetailSchema,
  ContestRatingDataSchema,
  SimilarityComparisonSchema,
  TrainingDesignSchema,
  TrainingStructureInputSchema,
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

  it('accepts the assignment matrix projection returned by the application service', () => {
    expect(AssignmentProgressDataSchema.safeParse({
      problems: [{
        id: 'assignment-problem-1',
        orderIndex: 0,
        category: 'REQUIRED',
        maxScore: 100,
        targetScore: 100,
        weight: 100,
        completionPolicy: 'MANUAL',
        problem: { id: 'problem-1', platform: 'carits', problemId: '1041', title: '整数求和' },
      }],
      recipients: [{
        id: 'recipient-1',
        user: { id: 'user-1', username: 'student' },
        score: 0,
        rawScore: 0,
        adjustment: 0,
        completedProblems: 0,
        lateProblems: 0,
        correctionProblems: 0,
        progress: [],
        cells: [{
          id: null,
          assignmentProblemId: 'assignment-problem-1',
          learningStatus: 'NOT_STARTED',
          timelinessStatus: 'ON_TIME',
          correctionStatus: 'NONE',
          attemptCount: 0,
          manualCompletionVersion: 0,
        }],
      }],
      pagination: { page: 1, pageSize: 40, total: 1, totalPages: 1 },
    }).success).toBe(true)
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

  it('shares the Training design and mutation contract at runtime', () => {
    expect(TrainingDesignSchema.safeParse({
      editable: true,
      statusRevision: 3,
      session: {
        id: 'session-1',
        title: '顺序训练',
        description: null,
        sessionType: 'GENERAL',
        status: 'DRAFT',
        organizationId: 'organization-1',
        teamId: null,
        scheduledStartAt: new Date('2026-09-15T00:00:00Z'),
      },
      stages: [{
        id: 'stage-1',
        clientKey: 'stage-1',
        name: '热身',
        mode: 'SEQUENTIAL',
        advanceMode: 'MANUAL',
        problemAccessMode: 'SEQUENTIAL',
        submissionMode: 'NORMAL',
        Problems: [],
      }],
      issues: [],
    }).success).toBe(true)

    expect(TrainingStructureInputSchema.safeParse({
      expectedRevision: 3,
      title: '顺序训练',
      description: '',
      stages: [{
        clientKey: 'draft-stage-1',
        name: '热身',
        mode: 'SEQUENTIAL',
        advanceMode: 'MANUAL',
        problemAccessMode: 'SEQUENTIAL',
        submissionMode: 'NORMAL',
        problems: [],
      }],
    }).success).toBe(true)
  })

  it('routes pages through feature public APIs instead of component internals', () => {
    const page = fs.readFileSync(new URL('../app/blog/page.tsx', import.meta.url), 'utf8')
    const organization = fs.readFileSync(new URL('../app/org/[organizationId]/[module]/[...segments]/page.tsx', import.meta.url), 'utf8')
    expect(page).toContain("from '@/features/blog'")
    expect(organization).toContain("from '@/features/assignment'")
    expect(organization).toContain("from '@/features/training-session/TrainingSessionWorkspace'")
    expect(organization).not.toMatch(/@\/components\/(?:assignment|blog|submission|problem|training|training-engine)\//)
    expect(organization).not.toMatch(/@\/features\/(?:assignment|blog|submission|problem|contest|training-session)\/(?:api|model|ui)\//)
  })
})
