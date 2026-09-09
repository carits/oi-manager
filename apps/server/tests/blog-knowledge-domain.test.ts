import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestProblem } from './helpers/problemListHelpers'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createTestApp()

describe('V1 Blog / Knowledge Publishing Domain', () => {
  let author: Awaited<ReturnType<typeof createTestUser>>
  let reader: Awaited<ReturnType<typeof createTestUser>>
  let problem: Awaited<ReturnType<typeof createTestProblem>>
  let revisionId: string

  beforeEach(async () => {
    author = await createTestUser({ role: 'teacher' })
    reader = await createTestUser({ role: 'student' })
    problem = await createTestProblem({ ownerId: author.user.id, title: 'Knowledge domain problem' })
    revisionId = crypto.randomUUID()
    await prisma.problemTestSetRevision.create({ data: {
      id: revisionId,
      problemId: problem.id,
      revisionNumber: 1,
      mode: 'acm',
      source: 'initial',
      judgeConfig: 'type: default\nmode: acm\n',
      judgeConfigHash: 'blog-judge-v1',
      graphHash: 'blog-graph-v1',
      testdataPath: '/test/blog-v1',
      createdBy: author.user.id,
    } })
    await prisma.problem.update({ where: { id: problem.id }, data: { latestTestSetRevisionId: revisionId } })
  })

  const client = (user: typeof author) => createAuthenticatedRequest(app, generateTokenFromUser(user.user))

  async function createProblemBlog(extra: Record<string, unknown> = {}) {
    return client(author).post('/api/blogs').send({
      type: 'SOLUTION_NOTE',
      slug: `knowledge-${crypto.randomUUID().slice(0, 8)}`,
      title: 'A stable knowledge article',
      summary: 'A versioned article.',
      contentMarkdown: '# Idea\n\nUse $O(n)$ time.\n\n```cpp\nint main() {}\n```',
      references: [{
        type: 'PROBLEM_REVISION',
        problemId: problem.id,
        problemRevisionId: revisionId,
        relationType: 'PRIMARY_SUBJECT',
        displayMode: 'CARD',
        positionKey: 'primary-problem',
      }],
      ...extra,
    })
  }

  it('publishes immutable versions, pins a problem revision, and powers reverse lookup', async () => {
    const created = await createProblemBlog()
    expect(created.status).toBe(201)
    expect(created.body.data.draft.revision).toBe(1)
    const postId = created.body.data.id as string

    const published = await client(author).post(`/api/blogs/${postId}/publish`).send({ expectedDraftRevision: 1, visibility: 'PUBLIC' })
    expect(published.status).toBe(200)
    expect(published.body.data.currentVersion.version).toBe(1)
    expect(published.body.data.currentVersion.references[0]).toMatchObject({
      type: 'PROBLEM_REVISION',
      referenceId: problem.id,
      referenceVersionId: revisionId,
      accessMode: 'PUBLIC',
    })
    expect(published.body.data.renderingContract).toMatchObject({ rawHtml: false, latex: true, fencedCode: true, executableCode: false })

    const publicRead = await client(reader).get(`/api/blogs/${postId}`)
    expect(publicRead.status).toBe(200)
    expect(publicRead.body.data.draft).toBeUndefined()

    const related = await client(reader).get(`/api/problems/${problem.id}/blogs`)
    expect(related.status).toBe(200)
    expect(related.body.data.items.map((item: any) => item.id)).toContain(postId)

    const edited = await client(author).patch(`/api/blogs/${postId}/draft`).send({
      expectedRevision: 2,
      contentMarkdown: '# Revised idea\n\nThe proof now covers the boundary.',
    })
    expect(edited.status).toBe(200)
    expect(edited.body.data.revision).toBe(3)
    const second = await client(author).post(`/api/blogs/${postId}/publish`).send({ expectedDraftRevision: 3, visibility: 'PUBLIC' })
    expect(second.body.data.currentVersion.version).toBe(2)

    const versions = await client(reader).get(`/api/blogs/${postId}/versions`)
    expect(versions.body.data.map((item: any) => item.status)).toEqual(['CURRENT', 'SUPERSEDED'])
    const firstId = versions.body.data[1].id
    const old = await client(reader).get(`/api/blogs/${postId}/versions/${firstId}`)
    expect(old.body.data.contentMarkdown).toContain('Use $O(n)$')
    await expect(prisma.blogPostVersion.update({ where: { id: firstId }, data: { contentMarkdown: 'mutated' } })).rejects.toThrow()
    await expect(prisma.blogPostVersion.update({ where: { id: firstId }, data: { status: 'CURRENT' } })).rejects.toThrow()
    await expect(prisma.blogReference.deleteMany({ where: { postVersionId: firstId } })).rejects.toThrow()
  })

  it('fails closed across organization visibility and keeps unlisted posts out of discovery', async () => {
    const school = await prisma.school.findUniqueOrThrow({ where: { id: author.schoolId } })
    const member = await createTestUser({ role: 'student', schoolId: school.id })
    const schoolProblem = await createTestProblem({ ownerId: author.user.id, title: 'Private school problem' })
    await prisma.problem.update({ where: { id: schoolProblem.id }, data: {
      libraryScope: 'school',
      libraryKey: `organization:${school.organizationId}`,
      organizationId: school.organizationId,
      visibility: 'private',
    } })

    const created = await client(author).post('/api/blogs').send({
      slug: `school-${crypto.randomUUID().slice(0, 8)}`,
      organizationId: school.organizationId,
      title: 'School-only knowledge',
      contentMarkdown: 'This material belongs to the active school.',
      references: [{ type: 'PROBLEM', problemId: schoolProblem.id, relationType: 'PRIMARY_SUBJECT' }],
    })
    const postId = created.body.data.id
    expect((await client(author).post(`/api/blogs/${postId}/publish`).send({ expectedDraftRevision: 1, visibility: 'PUBLIC' })).body.code).toBe('BLOG_REFERENCE_VISIBILITY_CONFLICT')
    expect((await client(author).post(`/api/blogs/${postId}/publish`).send({ expectedDraftRevision: 1, visibility: 'ORGANIZATION' })).status).toBe(200)
    expect((await client(member).get(`/api/blogs/${postId}`)).status).toBe(200)
    expect((await client(reader).get(`/api/blogs/${postId}`)).status).toBe(404)

    const unlisted = await createProblemBlog({ slug: `unlisted-${crypto.randomUUID().slice(0, 8)}` })
    const unlistedId = unlisted.body.data.id
    expect((await client(author).post(`/api/blogs/${unlistedId}/publish`).send({ expectedDraftRevision: 1, visibility: 'UNLISTED' })).status).toBe(200)
    expect((await client(reader).get(`/api/blogs/${unlistedId}`)).status).toBe(200)
    const related = await client(reader).get(`/api/problems/${problem.id}/blogs`)
    expect(related.body.data.items.map((item: any) => item.id)).not.toContain(unlistedId)
  })

  it('never exposes an older private or organization version after a later public publish', async () => {
    const privatePost = await createProblemBlog({ slug: `private-history-${crypto.randomUUID().slice(0, 8)}` })
    const privatePostId = privatePost.body.data.id
    const privatePublish = await client(author).post(`/api/blogs/${privatePostId}/publish`).send({ expectedDraftRevision: 1, visibility: 'PRIVATE' })
    const privateVersionId = privatePublish.body.data.currentVersion.id
    await client(author).patch(`/api/blogs/${privatePostId}/draft`).send({ expectedRevision: 2, contentMarkdown: 'This later version is intentionally public.' })
    await client(author).post(`/api/blogs/${privatePostId}/publish`).send({ expectedDraftRevision: 3, visibility: 'PUBLIC' })

    expect((await client(reader).get(`/api/blogs/${privatePostId}`)).status).toBe(200)
    const visibleVersions = await client(reader).get(`/api/blogs/${privatePostId}/versions`)
    expect(visibleVersions.body.data.map((item: any) => item.version)).toEqual([2])
    expect((await client(reader).get(`/api/blogs/${privatePostId}/versions/${privateVersionId}`)).status).toBe(404)

    const school = await prisma.school.findUniqueOrThrow({ where: { id: author.schoolId } })
    const member = await createTestUser({ role: 'student', schoolId: school.id })
    const organizationPost = await createProblemBlog({ slug: `organization-history-${crypto.randomUUID().slice(0, 8)}`, organizationId: school.organizationId })
    const organizationPostId = organizationPost.body.data.id
    const organizationPublish = await client(author).post(`/api/blogs/${organizationPostId}/publish`).send({ expectedDraftRevision: 1, visibility: 'ORGANIZATION' })
    const organizationVersionId = organizationPublish.body.data.currentVersion.id
    await client(author).patch(`/api/blogs/${organizationPostId}/draft`).send({ expectedRevision: 2, contentMarkdown: 'The new version has a wider, public scope.' })
    await client(author).post(`/api/blogs/${organizationPostId}/publish`).send({ expectedDraftRevision: 3, visibility: 'PUBLIC' })

    expect((await client(member).get(`/api/blogs/${organizationPostId}/versions/${organizationVersionId}`)).status).toBe(200)
    expect((await client(reader).get(`/api/blogs/${organizationPostId}/versions/${organizationVersionId}`)).status).toBe(404)
  })

  it('pins solution, standing, and Rating facts without copying private source records', async () => {
    const solutionId = crypto.randomUUID()
    const contributionId = crypto.randomUUID()
    const contributionRevisionId = crypto.randomUUID()
    const verificationId = crypto.randomUUID()
    const solutionVersionId = crypto.randomUUID()
    await prisma.solutionContribution.create({ data: {
      id: contributionId,
      problemId: problem.id,
      authorUserId: author.user.id,
      type: 'EXPLANATION',
      title: 'Published explanation',
      contentMarkdown: 'A stable published explanation.',
      sourceType: 'ORIGINAL',
      licenseDeclarationVersion: 1,
      licenseAcceptedAt: new Date(),
      targetTestSetRevisionId: revisionId,
      statementSnapshotHash: 'statement-v1',
      status: 'PUBLISHED',
      currentRevision: 1,
      publishedAt: new Date(),
    } })
    await prisma.solutionContributionRevision.create({ data: {
      id: contributionRevisionId,
      contributionId,
      revision: 1,
      title: 'Published explanation',
      contentMarkdown: 'A stable published explanation.',
      sourceType: 'ORIGINAL',
      licenseDeclarationVersion: 1,
      licenseAcceptedAt: new Date(),
      statementSnapshot: { title: problem.title },
      statementSnapshotHash: 'statement-v1',
      targetTestSetRevisionId: revisionId,
      contentHash: 'solution-content-v1',
    } })
    await prisma.solutionVerification.create({ data: {
      id: verificationId,
      contributionRevisionId,
      verifiedTestSetRevisionId: revisionId,
      status: 'SKIPPED',
      completedAt: new Date(),
    } })
    await prisma.problemSolution.create({ data: {
      id: solutionId,
      problemId: problem.id,
      type: 'EXPLANATION',
      authorUserId: author.user.id,
      title: 'Published explanation',
      visibilityPolicy: 'PUBLIC',
    } })
    const managerContributionId = crypto.randomUUID()
    const managerContributionRevisionId = crypto.randomUUID()
    const managerVerificationId = crypto.randomUUID()
    const managerVersionId = crypto.randomUUID()
    await prisma.solutionContribution.create({ data: {
      id: managerContributionId,
      problemId: problem.id,
      authorUserId: author.user.id,
      type: 'EXPLANATION',
      title: 'Private historical explanation',
      contentMarkdown: 'This version must remain manager only.',
      sourceType: 'ORIGINAL',
      licenseDeclarationVersion: 1,
      licenseAcceptedAt: new Date(),
      targetTestSetRevisionId: revisionId,
      statementSnapshotHash: 'manager-statement-v1',
      status: 'PUBLISHED',
    } })
    await prisma.solutionContributionRevision.create({ data: {
      id: managerContributionRevisionId,
      contributionId: managerContributionId,
      revision: 1,
      title: 'Private historical explanation',
      contentMarkdown: 'This version must remain manager only.',
      sourceType: 'ORIGINAL',
      licenseDeclarationVersion: 1,
      licenseAcceptedAt: new Date(),
      statementSnapshot: { title: problem.title },
      statementSnapshotHash: 'manager-statement-v1',
      targetTestSetRevisionId: revisionId,
      contentHash: 'manager-solution-content-v1',
    } })
    await prisma.solutionVerification.create({ data: {
      id: managerVerificationId,
      contributionRevisionId: managerContributionRevisionId,
      verifiedTestSetRevisionId: revisionId,
      status: 'SKIPPED',
      completedAt: new Date(),
    } })
    await prisma.problemSolutionVersion.create({ data: {
      id: managerVersionId,
      solutionId,
      version: 1,
      title: 'Private historical explanation',
      contentMarkdown: 'This version must remain manager only.',
      sourceType: 'ORIGINAL',
      licenseDeclarationVersion: 1,
      statementSnapshot: { title: problem.title },
      statementSnapshotHash: 'manager-statement-v1',
      verifiedTestSetRevisionId: revisionId,
      sourceContributionRevisionId: managerContributionRevisionId,
      verificationId: managerVerificationId,
      contentHash: 'manager-solution-content-v1',
      visibilityPolicy: 'MANAGER_ONLY',
      publishedByUserId: author.user.id,
      status: 'SUPERSEDED',
    } })
    await prisma.problemSolutionVersion.create({ data: {
      id: solutionVersionId,
      solutionId,
      version: 2,
      title: 'Published explanation',
      contentMarkdown: 'A stable published explanation.',
      sourceType: 'ORIGINAL',
      licenseDeclarationVersion: 1,
      statementSnapshot: { title: problem.title },
      statementSnapshotHash: 'statement-v1',
      verifiedTestSetRevisionId: revisionId,
      sourceContributionRevisionId: contributionRevisionId,
      verificationId,
      contentHash: 'solution-content-v1',
      visibilityPolicy: 'PUBLIC',
      publishedByUserId: author.user.id,
    } })
    await prisma.problemSolution.update({ where: { id: solutionId }, data: { currentVersionId: solutionVersionId } })

    const leakedReference = await client(reader).post('/api/blogs').send({
      slug: `forbidden-solution-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Must not reference hidden historical solution',
      contentMarkdown: 'The current solution is public, but this fixed version is not.',
      references: [{ type: 'SOLUTION_VERSION', solutionVersionId: managerVersionId }],
    })
    expect(leakedReference.status).toBe(201)
    expect((await client(reader).post(`/api/blogs/${leakedReference.body.data.id}/publish`).send({ expectedDraftRevision: 1, visibility: 'PRIVATE' })).body.code).toBe('BLOG_REFERENCE_NOT_FOUND')

    const training = await prisma.training.create({ data: {
      title: 'Platform final contest',
      description: 'Finalized contest for a review.',
      format: 'ioi',
      startTime: new Date(Date.now() - 3_600_000),
      endTime: new Date(Date.now() - 1_800_000),
      status: 'finished',
      createdBy: author.user.id,
      scope: 'platform',
      finalizationStatus: 'FINALIZED',
    } })
    const standingId = crypto.randomUUID()
    await prisma.contestStandingSnapshot.create({ data: {
      id: standingId,
      trainingId: training.id,
      revision: 1,
      scoringMode: 'IOI',
      rulesHash: 'standing-rules-v1',
      status: 'FINALIZED',
      inputHash: 'standing-input-v1',
      createdBy: author.user.id,
      finalizedAt: new Date(),
      Entries: { create: {
        id: crypto.randomUUID(),
        userId: author.user.id,
        rank: 2,
        ratingTieGroup: 'score:90',
        totalScore: 90,
      } },
    } })
    await prisma.training.update({ where: { id: training.id }, data: { finalizedStandingId: standingId } })
    const pool = await prisma.ratingPool.create({ data: {
      id: crypto.randomUUID(),
      scopeType: 'GLOBAL',
      track: 'IOI',
    } })
    const account = await prisma.ratingAccount.create({ data: {
      id: crypto.randomUUID(),
      poolId: pool.id,
      userId: author.user.id,
      rating: 1520,
      peakRating: 1520,
      ratedContestCount: 1,
    } })
    const batch = await prisma.ratingBatch.create({ data: {
      id: crypto.randomUUID(),
      trainingId: training.id,
      poolId: pool.id,
      standingSnapshotId: standingId,
      algorithmCode: 'CARITS_MULTI_ELO',
      algorithmVersion: 1,
      fieldSize: 2,
      status: 'APPLIED',
      inputHash: 'rating-input-v1',
      sequenceAt: training.endTime,
      appliedAt: new Date(),
    } })
    const ratingChange = await prisma.ratingChange.create({ data: {
      id: crypto.randomUUID(),
      batchId: batch.id,
      accountId: account.id,
      userId: author.user.id,
      ratingBefore: 1500,
      expectedPerformance: 0.5,
      actualPerformance: 1,
      rank: 2,
      fieldSize: 2,
      rawDelta: 20,
      appliedDelta: 20,
      ratingAfter: 1520,
    } })

    const created = await client(author).post('/api/blogs').send({
      slug: `facts-${crypto.randomUUID().slice(0, 8)}`,
      type: 'CONTEST_REVIEW',
      title: 'Contest facts are pinned',
      contentMarkdown: 'The cards below are fixed facts, not copied prose.',
      references: [
        { type: 'SOLUTION_VERSION', solutionVersionId, relationType: 'SOLUTION' },
        { type: 'CONTEST_STANDING', standingSnapshotId: standingId, relationType: 'RESULT' },
        { type: 'RATING_CHANGE', ratingChangeId: ratingChange.id, relationType: 'RESULT' },
      ],
    })
    const postId = created.body.data.id
    const published = await client(author).post(`/api/blogs/${postId}/publish`).send({ expectedDraftRevision: 1, visibility: 'PUBLIC' })
    expect(published.status).toBe(200)
    expect(published.body.data.currentVersion.references.map((item: any) => item.type)).toEqual(['SOLUTION_VERSION', 'CONTEST_STANDING', 'RATING_CHANGE'])
    const snapshots = published.body.data.currentVersion.references.map((item: any) => item.snapshot)
    expect(snapshots[1]).toMatchObject({ rank: 2, score: 90, standingRevision: 1 })
    expect(snapshots[2]).toMatchObject({ ratingBefore: 1500, appliedDelta: 20, ratingAfter: 1520 })
    expect(JSON.stringify(snapshots)).not.toContain(author.user.username)

    const byContest = await client(reader).get(`/api/trainings/${training.id}/blogs`)
    const bySolution = await client(reader).get(`/api/solutions/${solutionId}/related-blogs`)
    expect(byContest.body.data.items.map((item: any) => item.id)).toContain(postId)
    expect(bySolution.body.data.items.map((item: any) => item.id)).toContain(postId)
  })

  it('copies a fixed blog version into a separate solution contribution draft', async () => {
    const created = await createProblemBlog()
    const postId = created.body.data.id
    const published = await client(author).post(`/api/blogs/${postId}/publish`).send({ expectedDraftRevision: 1, visibility: 'PUBLIC' })
    const versionId = published.body.data.currentVersion.id
    const converted = await client(author).post(`/api/blogs/${postId}/versions/${versionId}/convert-to-solution-contribution`).send({
      licenseAccepted: true,
      type: 'COMMUNITY_EDITORIAL',
      complexityTime: 'O(n)',
      complexityMemory: 'O(1)',
      language: 'cpp17',
      referenceCode: 'int main() { return 0; }',
    })
    expect(converted.status).toBe(201)
    expect(converted.body.data).toMatchObject({ problemId: problem.id, status: 'DRAFT', contentMarkdown: published.body.data.currentVersion.contentMarkdown })
    expect(await prisma.problemSolution.count({ where: { problemId: problem.id } })).toBe(0)

    await client(author).patch(`/api/blogs/${postId}/draft`).send({ expectedRevision: 2, contentMarkdown: '# Changed after conversion' })
    const contribution = await prisma.solutionContribution.findUniqueOrThrow({ where: { id: converted.body.data.id } })
    expect(contribution.contentMarkdown).not.toContain('Changed after conversion')
  })

  it('keeps controlled tags and ordered series linked without mutating historical classification', async () => {
    const superAdmin = await createTestUser({ role: 'super_admin' })
    expect((await client(author).post('/api/platform/blog-tags').send({ name: 'Graph' })).status).toBe(403)
    const systemTag = await client(superAdmin).post('/api/platform/blog-tags').send({ name: 'Graph' })
    expect(systemTag.status).toBe(201)
    expect(systemTag.body.data).toMatchObject({ kind: 'SYSTEM', name: 'Graph' })
    const seriesCreated = await client(author).post('/api/blog-series').send({
      title: 'From Zero to Graphs',
      description: 'An ordered public learning path.',
      visibility: 'PUBLIC',
    })
    expect(seriesCreated.status).toBe(201)
    const seriesId = seriesCreated.body.data.id as string

    const first = await createProblemBlog({
      slug: `series-first-${crypto.randomUUID().slice(0, 8)}`,
      classification: { seriesId, authorTags: ['Graph', 'Learning note'] },
    })
    const firstId = first.body.data.id as string
    const firstPublished = await client(author).post(`/api/blogs/${firstId}/publish`).send({ expectedDraftRevision: 1, visibility: 'PUBLIC' })
    expect(firstPublished.status).toBe(200)
    expect(firstPublished.body.data.currentVersion.classification).toMatchObject({
      series: { id: seriesId, title: 'From Zero to Graphs' },
    })
    expect(firstPublished.body.data.currentVersion.classification.tags.map((tag: any) => tag.name).sort()).toEqual(['Graph', 'Learning note'])
    const firstVersionId = firstPublished.body.data.currentVersion.id as string

    const second = await createProblemBlog({
      slug: `series-second-${crypto.randomUUID().slice(0, 8)}`,
      title: 'A second stable knowledge article',
      classification: { seriesId, authorTags: ['Graph'] },
    })
    const secondId = second.body.data.id as string
    expect((await client(author).post(`/api/blogs/${secondId}/publish`).send({ expectedDraftRevision: 1, visibility: 'PUBLIC' })).status).toBe(200)

    const series = await client(author).get(`/api/blog-series/${seriesId}`)
    expect(series.body.data.entries.map((entry: any) => entry.post.id)).toEqual([firstId, secondId])
    const reordered = await client(author).put(`/api/blog-series/${seriesId}/entries`).send({
      expectedRevision: series.body.data.revision,
      postIds: [secondId, firstId],
    })
    expect(reordered.status).toBe(200)
    const publicSeries = await client(reader).get(`/api/blog-series/${seriesId}`)
    expect(publicSeries.body.data.entries.map((entry: any) => entry.post.id)).toEqual([secondId, firstId])

    const availableTags = await client(author).get('/api/blog-tags')
    const graphTag = availableTags.body.data.items.find((tag: any) => tag.name === 'Graph')
    expect(graphTag).toMatchObject({ kind: 'SYSTEM', id: systemTag.body.data.id })
    const tagged = await client(reader).get(`/api/blog-tags/${graphTag.id}/blogs`)
    expect(tagged.body.data.items.map((item: any) => item.id)).toEqual(expect.arrayContaining([firstId, secondId]))

    await client(author).patch(`/api/blogs/${firstId}/draft`).send({
      expectedRevision: 2,
      classification: { seriesId, authorTags: ['Dynamic programming'] },
    })
    await client(author).post(`/api/blogs/${firstId}/publish`).send({ expectedDraftRevision: 3, visibility: 'PUBLIC' })
    const historical = await client(reader).get(`/api/blogs/${firstId}/versions/${firstVersionId}`)
    expect(historical.body.data.classification.tags.map((tag: any) => tag.name).sort()).toEqual(['Graph', 'Learning note'])
  })

  it('rejects unsafe links, external images, floating solution references, and stale writes', async () => {
    const created = await createProblemBlog()
    const postId = created.body.data.id
    const stale = await client(author).patch(`/api/blogs/${postId}/draft`).send({ expectedRevision: 99, title: 'stale update' })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('BLOG_DRAFT_STALE')
    expect((await client(author).patch(`/api/blogs/${postId}/draft`).send({ expectedRevision: 1, contentMarkdown: '[bad](javascript:alert(1))' })).body.code).toBe('BLOG_CONTENT_UNSAFE')
    expect((await client(author).patch(`/api/blogs/${postId}/draft`).send({ expectedRevision: 1, contentMarkdown: '![tracking](https://example.com/a.png)' })).body.code).toBe('BLOG_EXTERNAL_IMAGE_FORBIDDEN')
    expect((await client(author).patch(`/api/blogs/${postId}/draft`).send({ expectedRevision: 1, references: [{ type: 'SOLUTION_VERSION' }] })).body.code).toBe('BLOG_REFERENCE_VERSION_REQUIRED')
    const submissionReference = await client(author).post('/api/blogs').send({
      slug: `submission-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Unsafe direct submission reference',
      contentMarkdown: 'A private submission must never be opened by a blog reference.',
      references: [{ type: 'SUBMISSION', submissionId: crypto.randomUUID() }],
    })
    expect(submissionReference.status).toBe(422)
    expect(submissionReference.body.code).toBe('BLOG_SUBMISSION_SNAPSHOT_REQUIRED')
  })
})
