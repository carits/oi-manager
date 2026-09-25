import crypto from 'node:crypto'
import type { JwtPayload } from '@oi-manager/shared'
import {
  BlogPostType,
  BlogPostStatus,
  BlogReferenceDisplayMode,
  BlogReferenceRelationType,
  BlogReferenceType,
  BlogTagKind,
  BlogVisibility,
  Prisma,
  SolutionVisibilityPolicy,
} from '@prisma/client'
import { prisma } from '../../prisma'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { canModifyProblem, canViewProblem } from '../problem/problem.access'
import { createSolutionContribution, SolutionDomainError } from '../solution/solution.service'
import { findContestForBlogReview } from '../contest/contest-query.facade'

const MAX_MARKDOWN_BYTES = 1024 * 1024
const MAX_REFERENCES = 50
const MAX_TAGS = 5
const SAFE_RENDERING_CONTRACT = Object.freeze({
  version: 1,
  format: 'markdown' as const,
  rawHtml: false,
  sanitizeAst: true,
  latex: true,
  fencedCode: true,
  executableCode: false,
  externalLinks: { protocols: ['http', 'https'], rel: 'nofollow noopener noreferrer' },
  images: { external: false, authenticatedPlatformAssetsOnly: true },
})

export class BlogDomainError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string, details?: unknown): never {
  throw new BlogDomainError(statusCode, code, message, details)
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function nullableText(value: unknown, max: number) {
  const result = text(value, max)
  return result || null
}

function parseEnum<T extends string>(value: unknown, values: readonly T[], field: string, fallback?: T): T {
  if ((value === undefined || value === null || value === '') && fallback) return fallback
  const result = String(value || '').toUpperCase() as T
  if (!values.includes(result)) fail(422, 'BLOG_FIELD_INVALID', `${field} 无效`, { field })
  return result
}

function assertMarkdown(markdown: string, publication = false) {
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
    fail(413, 'BLOG_CONTENT_TOO_LARGE', '博客 Markdown 不能超过 1MB')
  }
  if (/\0/.test(markdown)) fail(422, 'BLOG_CONTENT_UNSAFE', '博客内容包含不允许的控制字符')

  // Raw HTML is never rendered. Dangerous protocols are also rejected so an
  // exported draft cannot accidentally turn into an executable link elsewhere.
  const prose = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
  if (/<\s*(script|iframe|object|embed|style|link|meta)\b/i.test(prose)
    || /\]\(\s*(?:javascript|vbscript|data):/i.test(prose)) {
    fail(422, 'BLOG_CONTENT_UNSAFE', '博客包含不允许的 HTML 或危险链接')
  }
  if (/!\[[^\]]*\]\(\s*(?:https?:|data:|\/\/)/i.test(prose)) {
    fail(422, 'BLOG_EXTERNAL_IMAGE_FORBIDDEN', '博客图片必须使用平台上传资源或安全图片代理')
  }
  if (publication && !markdown.trim()) fail(422, 'BLOG_CONTENT_REQUIRED', '发布内容不能为空')
}

function validateTitle(title: string, publication = false) {
  if (!title || (publication && title.length < 3)) fail(422, 'BLOG_TITLE_REQUIRED', publication ? '发布标题至少需要 3 个字符' : '标题不能为空')
}

function slug(value: unknown) {
  const result = text(value, 80).toLowerCase()
  if (!result || !/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(result)) {
    fail(422, 'BLOG_SLUG_INVALID', 'slug 只能使用 3～80 位小写字母、数字和连字符')
  }
  return result
}

function normalizedName(value: unknown, field: string, max = 120) {
  if (typeof value !== 'string') fail(422, 'BLOG_FIELD_INVALID', `${field} 无效`, { field })
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!name || name.length > max || /[\u0000-\u001f\u007f]/.test(name)) {
    fail(422, 'BLOG_FIELD_INVALID', `${field} 无效`, { field })
  }
  return { name, key: name.toLocaleLowerCase('zh-CN') }
}

type DraftClassificationInput = {
  seriesId: string | null
  tagIds: string[]
  authorTags: string[]
}

function normalizeClassification(value: unknown): DraftClassificationInput {
  if (value === undefined || value === null) return { seriesId: null, tagIds: [], authorTags: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, 'BLOG_CLASSIFICATION_INVALID', 'classification 必须是对象')
  const raw = value as Record<string, unknown>
  const seriesId = nullableText(raw.seriesId, 100)
  if (raw.tagIds !== undefined && !Array.isArray(raw.tagIds)) fail(422, 'BLOG_TAGS_INVALID', 'tagIds 必须是数组')
  if (raw.authorTags !== undefined && !Array.isArray(raw.authorTags)) fail(422, 'BLOG_TAGS_INVALID', 'authorTags 必须是数组')
  const tagIds = [...new Set((raw.tagIds as unknown[] | undefined || []).map((item, index) => {
    const id = text(item, 100)
    if (!id) fail(422, 'BLOG_TAGS_INVALID', `第 ${index + 1} 个标签 ID 无效`)
    return id
  }))]
  const authorTagMap = new Map<string, string>()
  for (const [index, item] of (raw.authorTags as unknown[] | undefined || []).entries()) {
    const tag = normalizedName(item, `authorTags[${index}]`, 30)
    if (!authorTagMap.has(tag.key)) authorTagMap.set(tag.key, tag.name)
  }
  // An author may type the name of a system tag that is also selected by ID.
  // Resolve that overlap against the database before enforcing the final
  // unique-tag cap; only bound each untrusted input list at this layer.
  if (tagIds.length > MAX_TAGS || authorTagMap.size > MAX_TAGS) {
    fail(422, 'BLOG_TAGS_LIMIT', `每篇文章最多使用 ${MAX_TAGS} 个标签`)
  }
  return { seriesId, tagIds, authorTags: [...authorTagMap.values()] }
}

type DraftReferenceInput = {
  type: BlogReferenceType
  problemId?: string
  problemRevisionId?: string
  solutionVersionId?: string
  standingSnapshotId?: string
  ratingChangeId?: string
  submissionSnapshotId?: string
  relationType: BlogReferenceRelationType
  displayMode: BlogReferenceDisplayMode
  positionKey?: string
}

function normalizeDraftReferences(value: unknown): DraftReferenceInput[] {
  if (!Array.isArray(value)) fail(422, 'BLOG_REFERENCES_INVALID', 'references 必须是数组')
  if (value.length > MAX_REFERENCES) fail(422, 'BLOG_REFERENCES_LIMIT', `每篇文章最多引用 ${MAX_REFERENCES} 个事实对象`)
  const seen = new Set<string>()
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(422, 'BLOG_REFERENCE_INVALID', `第 ${index + 1} 个引用格式无效`)
    const item = raw as Record<string, unknown>
    const requestedType = String(item.type || '').toUpperCase()
    if (requestedType === 'SUBMISSION' || requestedType === 'JUDGE_RUN') {
      fail(422, 'BLOG_SUBMISSION_SNAPSHOT_REQUIRED', 'V1 禁止直接引用 Submission/JudgeRun；必须由后续安全快照流程显式裁剪后才能公开')
    }
    const type = parseEnum(item.type, Object.values(BlogReferenceType), `references[${index}].type`)
    const relationType = parseEnum(item.relationType, Object.values(BlogReferenceRelationType), `references[${index}].relationType`, 'MENTION')
    const displayMode = parseEnum(item.displayMode, Object.values(BlogReferenceDisplayMode), `references[${index}].displayMode`, 'CARD')
    const positionKey = nullableText(item.positionKey, 80) || undefined
    if (positionKey && !/^[A-Za-z0-9_-]+$/.test(positionKey)) fail(422, 'BLOG_REFERENCE_POSITION_INVALID', `第 ${index + 1} 个引用位置键无效`)
    const normalized: DraftReferenceInput = {
      type,
      problemId: nullableText(item.problemId, 100) || undefined,
      problemRevisionId: nullableText(item.problemRevisionId, 100) || undefined,
      solutionVersionId: nullableText(item.solutionVersionId, 100) || undefined,
      standingSnapshotId: nullableText(item.standingSnapshotId, 100) || undefined,
      ratingChangeId: nullableText(item.ratingChangeId, 100) || undefined,
      submissionSnapshotId: nullableText(item.submissionSnapshotId, 100) || undefined,
      relationType,
      displayMode,
      positionKey,
    }
    if (type === 'PROBLEM' && (!normalized.problemId || normalized.problemRevisionId)) {
      fail(422, 'BLOG_REFERENCE_INVALID', 'PROBLEM 引用只接受题目 ID；需要固定数据版本时请使用 PROBLEM_REVISION')
    }
    if (type === 'PROBLEM_REVISION' && (!normalized.problemId || !normalized.problemRevisionId)) {
      fail(422, 'BLOG_REFERENCE_VERSION_REQUIRED', '题目版本引用必须同时提供 problemId 和 problemRevisionId')
    }
    if (type === 'SOLUTION_VERSION' && !normalized.solutionVersionId) fail(422, 'BLOG_REFERENCE_VERSION_REQUIRED', '题解引用必须固定到 ProblemSolutionVersion')
    if (type === 'CONTEST_STANDING' && !normalized.standingSnapshotId) fail(422, 'BLOG_REFERENCE_VERSION_REQUIRED', '比赛引用必须固定到 StandingSnapshot')
    if (type === 'RATING_CHANGE' && !normalized.ratingChangeId) fail(422, 'BLOG_REFERENCE_VERSION_REQUIRED', 'Rating 引用必须固定到 RatingChange')
    if (type === 'SUBMISSION_SNAPSHOT' && !normalized.submissionSnapshotId) fail(422, 'BLOG_REFERENCE_VERSION_REQUIRED', '提交引用必须固定到安全快照')
    const key = JSON.stringify(normalized)
    if (seen.has(key)) fail(422, 'BLOG_REFERENCE_DUPLICATE', `第 ${index + 1} 个引用重复`)
    seen.add(key)
    return normalized
  })
}

type Db = Prisma.TransactionClient

async function activeOrganizationMember(db: Db, userId: string, organizationId: string) {
  return Boolean(await db.organizationMembership.findFirst({
    where: {
      userId,
      organizationId,
      status: 'active',
      Organization: { status: 'active', OR: [{ type: { not: 'school' } }, { School: { is: { directoryStatus: { not: 'legacy' }, status: 'active' } } }] },
    },
    select: { id: true },
  }))
}

function publicProblem(problem: { libraryScope: string; status: string; visibility: string }) {
  return problem.libraryScope === 'platform' && problem.status === 'published' && problem.visibility === 'public'
}

async function canReadSolution(db: Db, user: JwtPayload, solution: any) {
  if (!canViewProblem(user, solution.Solution.Problem)) return false
  if (canModifyProblem(user, solution.Solution.Problem) || solution.Solution.authorUserId === user.userId) return true
  if (solution.visibilityPolicy === SolutionVisibilityPolicy.PUBLIC) return true
  if (solution.visibilityPolicy === SolutionVisibilityPolicy.MANAGER_ONLY) return false
  return Boolean(await db.submission.findFirst({
    where: {
      userId: user.userId,
      problemInternalId: solution.Solution.problemId,
      OR: [
        { CurrentJudgeRun: { is: { status: 'FINALIZED', result: 'accepted', score: { gte: 100 } } } },
      ],
    },
    select: { id: true },
  }))
}

type ResolvedReference = {
  referenceType: BlogReferenceType
  referenceId: string
  referenceVersionId: string | null
  relationType: BlogReferenceRelationType
  displayMode: BlogReferenceDisplayMode
  positionKey: string | null
  snapshotData: Prisma.InputJsonValue
  accessMode: BlogVisibility
  problemId?: string
  problemRevisionId?: string
  solutionVersionId?: string
  contestId?: number
  standingSnapshotId?: string
  ratingChangeId?: string
  submissionSnapshotId?: string
}

async function resolveReference(db: Db, user: JwtPayload, input: DraftReferenceInput): Promise<ResolvedReference> {
  const shared = { relationType: input.relationType, displayMode: input.displayMode, positionKey: input.positionKey || null }
  if (input.type === 'PROBLEM' || input.type === 'PROBLEM_REVISION') {
    const problem = await db.problem.findUnique({ where: { id: input.problemId! } })
    if (!problem || !canViewProblem(user, problem)) fail(404, 'BLOG_REFERENCE_NOT_FOUND', '引用的题目不存在或不可访问')
    let revision: { id: string; revisionNumber: number } | null = null
    if (input.type === 'PROBLEM_REVISION') {
      revision = await db.problemTestSetRevision.findFirst({ where: { id: input.problemRevisionId!, problemId: problem.id }, select: { id: true, revisionNumber: true } })
      if (!revision) fail(404, 'BLOG_REFERENCE_NOT_FOUND', '引用的题目测试版本不存在')
    }
    const accessMode = publicProblem(problem) ? BlogVisibility.PUBLIC : problem.organizationId ? BlogVisibility.ORGANIZATION : BlogVisibility.PRIVATE
    return {
      ...shared,
      referenceType: input.type,
      referenceId: problem.id,
      referenceVersionId: revision?.id || null,
      problemId: problem.id,
      problemRevisionId: revision?.id,
      accessMode,
      snapshotData: {
        kind: 'problem', title: problem.title, platform: problem.platform,
        problemId: problem.problemId, organizationId: problem.organizationId,
        testSetRevision: revision?.revisionNumber || null,
      },
    }
  }
  if (input.type === 'SOLUTION_VERSION') {
    const version = await db.problemSolutionVersion.findUnique({
      where: { id: input.solutionVersionId! },
      include: { Solution: { include: { Problem: true } } },
    })
    if (!version || !await canReadSolution(db, user, version)) fail(404, 'BLOG_REFERENCE_NOT_FOUND', '引用的题解版本不存在或不可访问')
    const problem = version.Solution.Problem
    const accessMode = version.visibilityPolicy === 'PUBLIC' && publicProblem(problem)
      ? BlogVisibility.PUBLIC
      : problem.organizationId && version.visibilityPolicy === 'PUBLIC'
        ? BlogVisibility.ORGANIZATION
        : BlogVisibility.PRIVATE
    return {
      ...shared,
      referenceType: input.type,
      referenceId: version.Solution.id,
      referenceVersionId: version.id,
      solutionVersionId: version.id,
      accessMode,
      snapshotData: {
        kind: 'solution', solutionId: version.Solution.id, versionId: version.id,
        version: version.version, title: version.title, status: version.status, visibilityPolicy: version.visibilityPolicy,
        problem: { id: problem.id, platform: problem.platform, problemId: problem.problemId, title: problem.title, organizationId: problem.organizationId },
      },
    }
  }
  if (input.type === 'CONTEST_STANDING') {
    const snapshot = await db.contestStandingSnapshot.findUnique({
      where: { id: input.standingSnapshotId! },
      include: { Contest: true, Entries: { where: { userId: user.userId }, take: 1 } },
    })
    if (!snapshot || !snapshot.Entries[0] || !['FINALIZED', 'SUPERSEDED'].includes(snapshot.status)) {
      fail(404, 'BLOG_REFERENCE_NOT_FOUND', '只能引用自己参加过的已结算比赛榜单')
    }
    const contest = snapshot.Contest
    let accessMode: BlogVisibility = BlogVisibility.PRIVATE
    if (contest.scope === 'platform') accessMode = BlogVisibility.PUBLIC
    else if (contest.organizationId && await activeOrganizationMember(db, user.userId, contest.organizationId)) accessMode = BlogVisibility.ORGANIZATION
    else if (contest.teamId) {
      const member = await db.teamMember.findFirst({ where: { teamId: contest.teamId, userId: user.userId, status: 'active' }, select: { id: true } })
      if (!member) fail(404, 'BLOG_REFERENCE_NOT_FOUND', '引用的比赛不可访问')
    } else fail(404, 'BLOG_REFERENCE_NOT_FOUND', '引用的比赛不可访问')
    const entry = snapshot.Entries[0]
    return {
      ...shared,
      referenceType: input.type,
      referenceId: contest.id,
      referenceVersionId: snapshot.id,
      contestId: String(contest.publicId),
      standingSnapshotId: snapshot.id,
      accessMode,
      snapshotData: {
        kind: 'contest-standing', contestId: contest.publicId, title: contest.title,
        organizationId: contest.organizationId,
        format: contest.format, standingRevision: snapshot.revision, scoringMode: snapshot.scoringMode,
        rank: entry.rank, score: entry.totalScore === null ? null : Number(entry.totalScore),
        solvedCount: entry.solvedCount, penaltySeconds: entry.penaltySeconds, fullScoreCount: entry.fullScoreCount,
      },
    }
  }
  if (input.type === 'SUBMISSION_SNAPSHOT') {
    const snapshot = await db.blogSubmissionSnapshot.findFirst({
      where: { id: input.submissionSnapshotId!, ownerUserId: user.userId },
    })
    if (!snapshot) fail(404, 'BLOG_REFERENCE_NOT_FOUND', '只能引用自己创建的提交安全快照')
    return {
      ...shared,
      referenceType: input.type,
      referenceId: snapshot.id,
      referenceVersionId: snapshot.contentHash,
      submissionSnapshotId: snapshot.id,
      accessMode: snapshot.visibility,
      snapshotData: {
        kind: 'submission-snapshot', id: snapshot.id,
        sourcePlatform: snapshot.sourcePlatform, sourceProblemId: snapshot.sourceProblemId,
        problemTitle: snapshot.problemTitle, result: snapshot.result, score: snapshot.score,
        timeUsed: snapshot.timeUsed, memoryUsed: snapshot.memoryUsed,
        language: snapshot.language,
        io: {
          input: snapshot.inputFilename ? { type: 'file', filename: snapshot.inputFilename } : { type: 'stdin' },
          output: snapshot.outputFilename ? { type: 'file', filename: snapshot.outputFilename } : { type: 'stdout' },
        },
        submittedAt: snapshot.submittedAt,
        ...(snapshot.includeCode ? { code: snapshot.code } : {}),
      },
    }
  }
  const change = await db.ratingChange.findUnique({
    where: { id: input.ratingChangeId! },
    include: { Batch: { include: { Pool: true, Contest: true } } },
  })
  if (!change || change.userId !== user.userId || !['APPLIED', 'SUPERSEDED'].includes(change.Batch.status)) {
    fail(404, 'BLOG_REFERENCE_NOT_FOUND', '只能引用自己的已应用 Rating 变化')
  }
  const pool = change.Batch.Pool
  const contest = change.Batch.Contest
  const accessMode = pool.scopeType === 'GLOBAL' ? BlogVisibility.PUBLIC : BlogVisibility.ORGANIZATION
  if (pool.scopeType === 'ORGANIZATION' && (!pool.organizationId || !await activeOrganizationMember(db, user.userId, pool.organizationId))) {
    fail(404, 'BLOG_REFERENCE_NOT_FOUND', '引用的组织 Rating 变化不可访问')
  }
  return {
    ...shared,
    referenceType: input.type,
    referenceId: change.id,
    referenceVersionId: change.batchId,
    ratingChangeId: change.id,
    contestId: contest.publicId,
    accessMode,
    snapshotData: {
      kind: 'rating-change', ratingChangeId: change.id, batchId: change.batchId,
      scope: pool.scopeType, organizationId: pool.organizationId, track: pool.track,
      ratingBefore: change.ratingBefore, appliedDelta: change.appliedDelta, ratingAfter: change.ratingAfter,
      rank: change.rank, fieldSize: change.fieldSize,
      contest: { id: contest.publicId, contestId: String(contest.id), title: contest.title },
    },
  }
}

function assertVisibilityAllowed(visibility: BlogVisibility, organizationId: string | null, refs: ResolvedReference[]) {
  if (visibility === 'ORGANIZATION' && !organizationId) fail(422, 'BLOG_ORGANIZATION_REQUIRED', '组织可见博客必须选择组织')
  const unsafe = refs.filter(ref => {
    if (visibility === 'PRIVATE') return false
    if (visibility === 'ORGANIZATION') {
      if (ref.accessMode === 'PRIVATE') return true
      const snapshot = ref.snapshotData as Record<string, any>
      const referencedOrganization = snapshot.organizationId || snapshot.problem?.organizationId
      return Boolean(referencedOrganization && referencedOrganization !== organizationId)
    }
    if (visibility === 'PLATFORM' || visibility === 'UNLISTED') {
      return !['PUBLIC', 'PLATFORM'].includes(ref.accessMode)
    }
    return ref.accessMode !== 'PUBLIC'
  })
  if (unsafe.length) {
    fail(422, 'BLOG_REFERENCE_VISIBILITY_CONFLICT', '文章可见范围超过引用资源允许的范围', {
      maximumVisibility: unsafe.some(ref => ref.accessMode === 'PRIVATE') ? 'PRIVATE' : 'ORGANIZATION',
      references: unsafe.map(ref => ({ type: ref.referenceType, id: ref.referenceId, accessMode: ref.accessMode })),
    })
  }
}

type ResolvedClassification = {
  series: { id: string; title: string; visibility: BlogVisibility; organizationId: string | null } | null
  tags: Array<{ id: string; name: string; kind: BlogTagKind }>
}

function assertSeriesVisibility(series: ResolvedClassification['series'], postVisibility: BlogVisibility, postOrganizationId: string | null) {
  if (!series) return
  if (series.organizationId !== postOrganizationId) {
    fail(422, 'BLOG_SERIES_SCOPE_CONFLICT', '文章与系列必须属于同一账号或同一组织范围')
  }
  if (series.visibility !== postVisibility) {
    fail(422, 'BLOG_SERIES_VISIBILITY_CONFLICT', '文章与系列必须使用相同可见范围，避免系列目录泄露文章身份')
  }
}

async function resolveClassification(db: Db, user: JwtPayload, post: { id: string; organizationId: string | null }, value: unknown, visibility: BlogVisibility): Promise<ResolvedClassification> {
  const input = normalizeClassification(value)
  const series = input.seriesId ? await db.blogSeries.findFirst({
    where: { id: input.seriesId, ownerUserId: user.userId, archivedAt: null },
    select: { id: true, title: true, visibility: true, organizationId: true },
  }) : null
  if (input.seriesId && !series) fail(404, 'BLOG_SERIES_NOT_FOUND', '系列不存在或不可管理')
  assertSeriesVisibility(series, visibility, post.organizationId)

  const explicitTags = input.tagIds.length ? await db.blogTag.findMany({
    where: { id: { in: input.tagIds }, OR: [{ kind: 'SYSTEM' }, { kind: 'USER', ownerUserId: user.userId }] },
    select: { id: true, name: true, normalizedKey: true, kind: true },
  }) : []
  if (explicitTags.length !== input.tagIds.length) fail(404, 'BLOG_TAG_NOT_FOUND', '标签不存在或不可使用')

  const authorNames = input.authorTags.map(name => normalizedName(name, 'authorTag', 30))
  const systemTags = authorNames.length ? await db.blogTag.findMany({
    where: { kind: 'SYSTEM', normalizedKey: { in: authorNames.map(item => item.key) } },
    select: { id: true, name: true, normalizedKey: true, kind: true },
  }) : []
  const systemByKey = new Map(systemTags.map(tag => [tag.normalizedKey, tag]))
  const createdUserTags = []
  for (const tag of authorNames) {
    if (systemByKey.has(tag.key)) continue
    createdUserTags.push(await db.blogTag.upsert({
      where: { scopeKey_normalizedKey: { scopeKey: `user:${user.userId}`, normalizedKey: tag.key } },
      create: {
        id: crypto.randomUUID(), kind: 'USER', scopeKey: `user:${user.userId}`,
        ownerUserId: user.userId, name: tag.name, normalizedKey: tag.key,
      },
      update: {},
      select: { id: true, name: true, normalizedKey: true, kind: true },
    }))
  }
  const tagsByKey = new Map<string, { id: string; name: string; normalizedKey: string; kind: BlogTagKind }>()
  for (const tag of [...systemTags, ...explicitTags, ...createdUserTags]) if (!tagsByKey.has(tag.normalizedKey)) tagsByKey.set(tag.normalizedKey, tag)
  if (tagsByKey.size > MAX_TAGS) fail(422, 'BLOG_TAGS_LIMIT', `每篇文章最多使用 ${MAX_TAGS} 个标签`)
  return {
    series,
    tags: [...tagsByKey.values()].map(({ id, name, kind }) => ({ id, name, kind })),
  }
}

async function synchronizeClassification(db: Db, userId: string, postId: string, classification: ResolvedClassification) {
  await db.blogPostTag.deleteMany({ where: { postId } })
  if (classification.tags.length) {
    await db.blogPostTag.createMany({ data: classification.tags.map(tag => ({ postId, tagId: tag.id, addedByUserId: userId })) })
  }
  const previous = await db.blogSeriesEntry.findMany({ where: { postId }, select: { seriesId: true } })
  const affectedSeries = new Set(previous.map(item => item.seriesId))
  if (classification.series) affectedSeries.add(classification.series.id)
  for (const seriesId of [...affectedSeries].sort()) {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blog-series:${seriesId}`}, 0)) IS NULL AS locked`
  }
  if (!classification.series) {
    const deleted = await db.blogSeriesEntry.deleteMany({ where: { postId } })
    if (deleted.count) for (const seriesId of affectedSeries) await db.blogSeries.update({ where: { id: seriesId }, data: { revision: { increment: 1 } } })
    return
  }
  await db.blogSeriesEntry.deleteMany({ where: { postId, seriesId: { not: classification.series.id } } })
  const existing = await db.blogSeriesEntry.findUnique({ where: { seriesId_postId: { seriesId: classification.series.id, postId } } })
  if (!existing) {
    const maximum = await db.blogSeriesEntry.aggregate({ where: { seriesId: classification.series.id }, _max: { orderIndex: true } })
    await db.blogSeriesEntry.create({ data: { seriesId: classification.series.id, postId, orderIndex: (maximum._max.orderIndex ?? -1) + 1 } })
  }
  const changedSeries = new Set(previous.filter(item => item.seriesId !== classification.series!.id).map(item => item.seriesId))
  if (!existing) changedSeries.add(classification.series.id)
  for (const seriesId of changedSeries) await db.blogSeries.update({ where: { id: seriesId }, data: { revision: { increment: 1 } } })
}

function draftDto(post: any) {
  return post.Draft ? {
    revision: post.Draft.revision,
    title: post.Draft.title,
    summary: post.Draft.summary,
    contentMarkdown: post.Draft.contentMarkdown,
    references: post.Draft.references,
    classification: post.Draft.classification,
    baseVersionId: post.Draft.baseVersionId,
    updatedAt: post.Draft.updatedAt,
  } : null
}

function referenceStatus(reference: any) {
  if (reference.referenceType === 'PROBLEM_REVISION' && reference.Problem?.latestTestSetRevisionId !== reference.problemRevisionId) return 'SUPERSEDED'
  if (reference.referenceType === 'SOLUTION_VERSION' && reference.SolutionVersion?.status === 'SUPERSEDED') return 'SUPERSEDED'
  if (reference.referenceType === 'CONTEST_STANDING' && reference.StandingSnapshot?.status === 'SUPERSEDED') return 'SUPERSEDED'
  if (reference.referenceType === 'RATING_CHANGE' && reference.RatingChange?.Batch?.status === 'SUPERSEDED') return 'SUPERSEDED'
  return reference.status
}

function referenceDto(reference: any) {
  return {
    id: reference.id,
    ordinal: reference.ordinal,
    type: reference.referenceType,
    relationType: reference.relationType,
    displayMode: reference.displayMode,
    positionKey: reference.positionKey,
    referenceId: reference.referenceId,
    referenceVersionId: reference.referenceVersionId,
    accessMode: reference.accessMode,
    status: referenceStatus(reference),
    snapshot: reference.snapshotData,
  }
}

const referenceInclude = {
  Problem: { select: { latestTestSetRevisionId: true } },
  SolutionVersion: { select: { status: true } },
  StandingSnapshot: { select: { status: true } },
  RatingChange: { select: { Batch: { select: { status: true } } } },
} satisfies Prisma.BlogReferenceInclude

async function canReadPost(user: JwtPayload | undefined, post: any, direct: boolean) {
  if (user && post.authorUserId === user.userId) return true
  if (post.status !== 'PUBLISHED' || !post.currentVersionId) return false
  if (post.visibility === 'PUBLIC') return true
  if (post.visibility === 'PLATFORM') return Boolean(user)
  if (post.visibility === 'UNLISTED') return Boolean(user) && direct
  if (post.visibility !== 'ORGANIZATION' || !post.organizationId) return false
  if (!user) return false
  return prisma.$transaction(tx => activeOrganizationMember(tx, user.userId, post.organizationId))
}

async function canReadVersion(user: JwtPayload | undefined, post: { authorUserId: string; status: string }, version: { visibility: BlogVisibility; organizationIdSnapshot: string | null }, direct: boolean) {
  if (user && post.authorUserId === user.userId) return true
  if (post.status !== 'PUBLISHED') return false
  if (version.visibility === 'PUBLIC') return true
  if (version.visibility === 'PLATFORM') return Boolean(user)
  if (version.visibility === 'UNLISTED') return Boolean(user) && direct
  if (version.visibility !== 'ORGANIZATION' || !version.organizationIdSnapshot) return false
  if (!user) return false
  return prisma.$transaction(tx => activeOrganizationMember(tx, user.userId, version.organizationIdSnapshot!))
}

function postDto(post: any, includeDraft: boolean) {
  const version = post.CurrentVersion
  return {
    id: post.id,
    slug: post.slug,
    type: post.type,
    status: post.status,
    visibility: post.visibility,
    organizationId: post.organizationId,
    author: post.Author,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    currentVersion: version ? {
      id: version.id,
      version: version.version,
      title: version.title,
      summary: version.summary,
      contentMarkdown: version.contentMarkdown,
      contentHash: version.contentHash,
      publishedAt: version.publishedAt,
      visibility: version.visibility,
      classification: version.classificationSnapshot,
      references: version.References.map(referenceDto),
    } : null,
    ...(includeDraft ? { draft: draftDto(post) } : {}),
    renderingContract: SAFE_RENDERING_CONTRACT,
  }
}

const postInclude = {
  Author: { select: { id: true, username: true, avatar: true } },
  Draft: true,
  CurrentVersion: { include: { References: { orderBy: { ordinal: 'asc' }, include: referenceInclude } } },
} satisfies Prisma.BlogPostInclude

export async function createBlogPost(user: JwtPayload, body: any) {
  const id = crypto.randomUUID()
  const title = text(body?.title, 160)
  validateTitle(title)
  const contentMarkdown = typeof body?.contentMarkdown === 'string' ? body.contentMarkdown : ''
  assertMarkdown(contentMarkdown)
  const references = normalizeDraftReferences(body?.references ?? [])
  const classification = normalizeClassification(body?.classification)
  const type = parseEnum(body?.type, Object.values(BlogPostType), 'type', 'ARTICLE')
  const organizationId = nullableText(body?.organizationId, 100)
  if (organizationId && !await prisma.$transaction(tx => activeOrganizationMember(tx, user.userId, organizationId))) {
    fail(403, 'BLOG_ORGANIZATION_ACCESS_DENIED', '只能为自己所属的有效组织创建文章')
  }
  try {
    return await prisma.$transaction(async tx => {
      const post = await tx.blogPost.create({ data: {
        id,
        authorUserId: user.userId,
        organizationId,
        type,
        slug: body?.slug ? slug(body.slug) : `post-${id.slice(0, 8)}`,
      } })
      await tx.blogPostDraft.create({ data: {
        postId: post.id,
        title,
        summary: nullableText(body?.summary, 1000),
        contentMarkdown,
        references: references as unknown as Prisma.InputJsonValue,
        classification: classification as unknown as Prisma.InputJsonValue,
      } })
      return tx.blogPost.findUniqueOrThrow({ where: { id: post.id }, include: postInclude })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(post => postDto(post, true))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, 'BLOG_SLUG_CONFLICT', '你已经使用过这个 slug')
    throw error
  }
}

export async function updateBlogDraft(user: JwtPayload, postId: string, body: any) {
  if (!Number.isInteger(body?.expectedRevision) || body.expectedRevision < 1) fail(422, 'BLOG_DRAFT_REVISION_REQUIRED', '必须提供有效的 expectedRevision')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blog:${postId}`}, 0)) IS NULL AS locked`
    const post = await tx.blogPost.findUnique({ where: { id: postId }, include: { Draft: true } })
    if (!post || post.authorUserId !== user.userId) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
    if (!post.Draft || post.Draft.revision !== body.expectedRevision) fail(409, 'BLOG_DRAFT_STALE', '博客草稿已被其他编辑更新，请重新加载', { currentRevision: post.Draft?.revision })
    if (['ARCHIVED', 'REMOVED', 'MODERATION_HOLD'].includes(post.status)) fail(409, 'BLOG_EDIT_FROZEN', '当前博客状态不允许编辑')
    const title = body.title === undefined ? post.Draft.title : text(body.title, 160)
    validateTitle(title)
    const contentMarkdown = body.contentMarkdown === undefined ? post.Draft.contentMarkdown : String(body.contentMarkdown)
    assertMarkdown(contentMarkdown)
    const references = body.references === undefined ? normalizeDraftReferences(post.Draft.references) : normalizeDraftReferences(body.references)
    const classification = body.classification === undefined ? normalizeClassification(post.Draft.classification) : normalizeClassification(body.classification)
    const updated = await tx.blogPostDraft.update({ where: { postId }, data: {
      revision: { increment: 1 },
      title,
      summary: body.summary === undefined ? post.Draft.summary : nullableText(body.summary, 1000),
      contentMarkdown,
      references: references as unknown as Prisma.InputJsonValue,
      classification: classification as unknown as Prisma.InputJsonValue,
    } })
    return { revision: updated.revision, title: updated.title, summary: updated.summary, contentMarkdown: updated.contentMarkdown, references: updated.references, classification: updated.classification, baseVersionId: updated.baseVersionId, updatedAt: updated.updatedAt }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function publishBlogPost(user: JwtPayload, postId: string, body: any) {
  if (!Number.isInteger(body?.expectedDraftRevision) || body.expectedDraftRevision < 1) fail(422, 'BLOG_DRAFT_REVISION_REQUIRED', '必须提供有效的 expectedDraftRevision')
  const visibility = parseEnum(body?.visibility, Object.values(BlogVisibility), 'visibility')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blog:${postId}`}, 0)) IS NULL AS locked`
    const post = await tx.blogPost.findUnique({ where: { id: postId }, include: { Draft: true, CurrentVersion: true } })
    if (!post || post.authorUserId !== user.userId) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
    if (!post.Draft || post.Draft.revision !== body.expectedDraftRevision) fail(409, 'BLOG_DRAFT_STALE', '发布使用的草稿已过期', { currentRevision: post.Draft?.revision })
    if (['ARCHIVED', 'REMOVED', 'MODERATION_HOLD'].includes(post.status)) fail(409, 'BLOG_PUBLISH_FROZEN', '当前博客状态不允许发布')
    validateTitle(post.Draft.title, true)
    assertMarkdown(post.Draft.contentMarkdown, true)
    if (visibility === 'ORGANIZATION') {
      if (!post.organizationId || !await activeOrganizationMember(tx, user.userId, post.organizationId)) fail(403, 'BLOG_ORGANIZATION_ACCESS_DENIED', '组织可见博客需要有效的组织成员身份')
    }
    const draftReferences = normalizeDraftReferences(post.Draft.references)
    const resolved: ResolvedReference[] = []
    for (const input of draftReferences) resolved.push(await resolveReference(tx, user, input))
    assertVisibilityAllowed(visibility, post.organizationId, resolved)
    const classification = await resolveClassification(tx, user, post, post.Draft.classification, visibility)
    const maximum = await tx.blogPostVersion.aggregate({ where: { postId }, _max: { version: true } })
    const versionNumber = (maximum._max.version || 0) + 1
    const versionId = crypto.randomUUID()
    const contentHash = crypto.createHash('sha256').update(JSON.stringify({
      title: post.Draft.title,
      summary: post.Draft.summary,
      contentMarkdown: post.Draft.contentMarkdown,
      references: resolved.map(item => ({ type: item.referenceType, id: item.referenceId, version: item.referenceVersionId, relation: item.relationType, display: item.displayMode, position: item.positionKey })),
      classification,
    })).digest('hex')
    if (post.CurrentVersion?.contentHash === contentHash && post.visibility === visibility) {
      fail(409, 'BLOG_NO_CHANGES', '草稿与当前发布版本相同')
    }
    if (post.currentVersionId) await tx.blogPostVersion.update({ where: { id: post.currentVersionId }, data: { status: 'SUPERSEDED' } })
    const version = await tx.blogPostVersion.create({ data: {
      id: versionId,
      postId,
      version: versionNumber,
      title: post.Draft.title,
      summary: post.Draft.summary,
      contentMarkdown: post.Draft.contentMarkdown,
      contentHash,
      sourceVersionId: post.currentVersionId,
      visibility,
      organizationIdSnapshot: visibility === 'ORGANIZATION' ? post.organizationId : null,
      classificationSnapshot: classification as unknown as Prisma.InputJsonValue,
      createdByUserId: user.userId,
    } })
    if (resolved.length) await tx.blogReference.createMany({ data: resolved.map((reference, ordinal) => ({ id: crypto.randomUUID(), postVersionId: version.id, ordinal, ...reference })) })
    await synchronizeClassification(tx, user.userId, postId, classification)
    const publishedAt = post.publishedAt || version.publishedAt
    await tx.blogPost.update({ where: { id: postId }, data: {
      currentVersionId: version.id,
      visibility,
      status: 'PUBLISHED',
      publishedAt,
      archivedAt: null,
    } })
    await tx.blogPostDraft.update({ where: { postId }, data: { baseVersionId: version.id, revision: { increment: 1 } } })
    return tx.blogPost.findUniqueOrThrow({ where: { id: postId }, include: postInclude })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(post => postDto(post, true))
}

export async function archiveBlogPost(user: JwtPayload, postId: string) {
  const post = await prisma.blogPost.findUnique({ where: { id: postId } })
  if (!post || post.authorUserId !== user.userId) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
  if (post.status === 'ARCHIVED') return post
  if (post.status === 'REMOVED') fail(409, 'BLOG_ARCHIVE_INVALID', '已移除博客不能归档')
  return prisma.blogPost.update({ where: { id: postId }, data: { status: 'ARCHIVED', archivedAt: new Date() } })
}

export async function getBlogPost(user: JwtPayload, postId: string) {
  const post = await prisma.blogPost.findUnique({ where: { id: postId }, include: postInclude })
  if (!post || !await canReadPost(user, post, true)) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
  return postDto(post, post.authorUserId === user.userId)
}

export async function getPublicBlogPost(user: JwtPayload | undefined, postId: string) {
  const post = await prisma.blogPost.findFirst({
    where: { OR: [{ id: postId }, { slug: postId }] },
    include: postInclude,
  })
  if (!post || !await canReadPost(user, post, true)) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
  const dto = postDto(post, false)
  const classification = post.CurrentVersion?.classificationSnapshot as any
  const seriesId = typeof classification?.series?.id === 'string'
    ? classification.series.id
    : typeof classification?.seriesId === 'string' ? classification.seriesId : null
  if (!seriesId) return dto
  const series = await prisma.blogSeries.findUnique({ where: { id: seriesId }, include: {
    Entries: { orderBy: { orderIndex: 'asc' }, include: { Post: { include: postInclude } } },
  } })
  if (!series || series.archivedAt) return dto
  const readable: Array<{ post: any; orderIndex: number }> = []
  for (const entry of series.Entries) {
    if (entry.Post.status === 'PUBLISHED' && await canReadPost(user, entry.Post, false)) readable.push({ post: entry.Post, orderIndex: entry.orderIndex })
  }
  const index = readable.findIndex(entry => entry.post.id === post.id)
  if (index < 0) return dto
  const navigationItem = (entry?: { post: any }) => entry?.post.CurrentVersion ? ({ id: entry.post.id, slug: entry.post.slug, title: entry.post.CurrentVersion.title }) : undefined
  return { ...dto, seriesNavigation: {
    seriesId: series.id,
    title: series.title,
    index: index + 1,
    total: readable.length,
    previous: navigationItem(readable[index - 1]),
    next: navigationItem(readable[index + 1]),
  } }
}

export async function listPublicBlogs(user: JwtPayload | undefined, query: any) {
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 50 })
  const q = text(query?.q, 120)
  const type = query?.type ? parseEnum(query.type, Object.values(BlogPostType), 'type') : undefined
  const tagId = nullableText(query?.tagId, 100)
  const featured = String(query?.featured || '').toLowerCase()
  if (featured && featured !== 'true' && featured !== 'false') fail(422, 'BLOG_FIELD_INVALID', 'featured 无效', { field: 'featured' })
  const visible: BlogVisibility[] = user ? [BlogVisibility.PUBLIC, BlogVisibility.PLATFORM] : [BlogVisibility.PUBLIC]
  const where: Prisma.BlogPostWhereInput = {
    status: BlogPostStatus.PUBLISHED,
    currentVersionId: { not: null },
    visibility: { in: visible },
    ...(type ? { type } : {}),
    ...(q ? { OR: [
      { CurrentVersion: { is: { title: { contains: q, mode: 'insensitive' } } } },
      { CurrentVersion: { is: { summary: { contains: q, mode: 'insensitive' } } } },
      { Author: { username: { contains: q, mode: 'insensitive' } } },
    ] } : {}),
    ...(tagId ? { Tags: { some: { tagId } } } : {}),
    ...(featured === 'true' ? { Features: { some: { status: 'active' } } } : {}),
    ...(featured === 'false' ? { Features: { none: { status: 'active' } } } : {}),
  }
  const [items, total] = await Promise.all([
    prisma.blogPost.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], skip, take: pageSize, include: postInclude }),
    prisma.blogPost.count({ where }),
  ])
  const rows = items.map(post => postDto(post, false))
  return { ...paginatedResponse(rows, total, page, pageSize), items: rows }
}

async function readablePublishedPost(user: JwtPayload | undefined, postId: string) {
  const post = await prisma.blogPost.findUnique({ where: { id: postId }, include: postInclude })
  if (!post || post.status !== 'PUBLISHED' || !await canReadPost(user, post, true)) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
  return post
}

const BLOG_REACTIONS = ['LIKE', 'HELPFUL'] as const

function blogReaction(value: unknown) {
  const reaction = String(value || '').toUpperCase()
  if (!BLOG_REACTIONS.includes(reaction as typeof BLOG_REACTIONS[number])) fail(422, 'BLOG_REACTION_INVALID', '互动类型无效')
  return reaction
}

export async function getBlogCommunity(user: JwtPayload, postId: string) {
  await readablePublishedPost(user, postId)
  const [groups, mine, bookmark, commentCount, featured] = await Promise.all([
    prisma.blogReaction.groupBy({ by: ['type'], where: { postId }, _count: { _all: true } }),
    prisma.blogReaction.findMany({ where: { postId, userId: user.userId }, select: { type: true } }),
    prisma.blogBookmark.findUnique({ where: { postId_userId: { postId, userId: user.userId } }, select: { postId: true } }),
    prisma.blogComment.count({ where: { postId, status: 'visible' } }),
    prisma.blogFeature.findFirst({ where: { postId, status: 'active' }, select: { id: true, reason: true, createdAt: true } }),
  ])
  return {
    reactions: Object.fromEntries(BLOG_REACTIONS.map(type => [type, groups.find(item => item.type === type)?._count._all || 0])),
    myReactions: mine.map(item => item.type), bookmarked: Boolean(bookmark), commentCount, featured,
  }
}

export async function getPublicBlogCommunity(user: JwtPayload | undefined, postId: string) {
  await readablePublishedPost(user, postId)
  const [groups, mine, bookmark, commentCount, featured] = await Promise.all([
    prisma.blogReaction.groupBy({ by: ['type'], where: { postId }, _count: { _all: true } }),
    user ? prisma.blogReaction.findMany({ where: { postId, userId: user.userId }, select: { type: true } }) : Promise.resolve([]),
    user ? prisma.blogBookmark.findUnique({ where: { postId_userId: { postId, userId: user.userId } }, select: { postId: true } }) : Promise.resolve(null),
    prisma.blogComment.count({ where: { postId, status: 'visible' } }),
    prisma.blogFeature.findFirst({ where: { postId, status: 'active' }, select: { id: true, reason: true, createdAt: true } }),
  ])
  return {
    reactions: Object.fromEntries(BLOG_REACTIONS.map(type => [type, groups.find(item => item.type === type)?._count._all || 0])),
    myReactions: mine.map(item => item.type),
    bookmarked: Boolean(bookmark),
    commentCount,
    featured,
    authenticated: Boolean(user),
  }
}

export async function listBlogComments(user: JwtPayload | undefined, postId: string, query: any) {
  await readablePublishedPost(user, postId)
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 30, maxPageSize: 100 })
  const where = { postId, parentId: null, status: { in: ['visible', 'removed'] } }
  const [items, total] = await Promise.all([
    prisma.blogComment.findMany({
      where, orderBy: { createdAt: 'asc' }, skip, take: pageSize,
      include: {
        Author: { select: { id: true, username: true, avatar: true } },
        Replies: { where: { status: { in: ['visible', 'removed'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5, include: { Author: { select: { id: true, username: true, avatar: true } } } },
        _count: { select: { Replies: { where: { status: { in: ['visible', 'removed'] } } } } },
      },
    }),
    prisma.blogComment.count({ where }),
  ])
  const dto = (item: any) => ({
    id: item.id, parentId: item.parentId, author: item.Author,
    content: item.status === 'visible' ? item.content : '该评论已由作者删除',
    status: item.status, editedAt: item.editedAt, createdAt: item.createdAt,
    canDelete: Boolean(user && item.authorUserId === user.userId),
  })
  return paginatedResponse(items.map(item => ({ ...dto(item), replies: item.Replies.map(dto), replyCount: item._count.Replies })), total, page, pageSize)
}

export async function listBlogCommentReplies(user: JwtPayload | undefined, postId: string, commentId: string, query: any) {
  await readablePublishedPost(user, postId)
  const parent = await prisma.blogComment.findFirst({ where: { id: commentId, postId, parentId: null }, select: { id: true } })
  if (!parent) fail(404, 'BLOG_COMMENT_NOT_FOUND', '评论不存在')
  const pageSize = Math.min(50, Math.max(1, Number(query?.pageSize) || 20))
  const cursor = typeof query?.cursor === 'string' && query.cursor ? query.cursor : null
  if (cursor) {
    const cursorReply = await prisma.blogComment.findFirst({ where: { id: cursor, postId, parentId: commentId }, select: { id: true } })
    if (!cursorReply) fail(422, 'BLOG_COMMENT_CURSOR_INVALID', '回复游标无效')
  }
  const rows = await prisma.blogComment.findMany({
    where: { postId, parentId: commentId, status: { in: ['visible', 'removed'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: pageSize + 1,
    include: { Author: { select: { id: true, username: true, avatar: true } } },
  })
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(item => ({
    id: item.id,
    parentId: item.parentId,
    author: item.Author,
    content: item.status === 'visible' ? item.content : '该评论已由作者删除',
    status: item.status,
    editedAt: item.editedAt,
    createdAt: item.createdAt,
    canDelete: Boolean(user && item.authorUserId === user.userId),
  }))
  return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id ?? null : null }
}

export async function createBlogComment(user: JwtPayload, postId: string, body: any) {
  await readablePublishedPost(user, postId)
  const content = text(body?.content, 5000)
  if (!content) fail(422, 'BLOG_COMMENT_REQUIRED', '评论内容不能为空')
  const parentId = nullableText(body?.parentId, 100)
  if (parentId) {
    const parent = await prisma.blogComment.findFirst({ where: { id: parentId, postId, status: 'visible' }, select: { parentId: true } })
    if (!parent) fail(404, 'BLOG_COMMENT_PARENT_NOT_FOUND', '回复的评论不存在')
    if (parent.parentId) fail(422, 'BLOG_COMMENT_DEPTH_LIMIT', '评论最多支持一层回复')
  }
  return prisma.blogComment.create({
    data: { id: crypto.randomUUID(), postId, authorUserId: user.userId, parentId, content },
    include: { Author: { select: { id: true, username: true, avatar: true } } },
  })
}

export async function removeBlogComment(user: JwtPayload, postId: string, commentId: string) {
  await readablePublishedPost(user, postId)
  const comment = await prisma.blogComment.findFirst({ where: { id: commentId, postId } })
  if (!comment || comment.authorUserId !== user.userId) fail(404, 'BLOG_COMMENT_NOT_FOUND', '评论不存在')
  if (comment.status === 'removed') return { id: comment.id, status: comment.status }
  const updated = await prisma.blogComment.update({ where: { id: commentId }, data: { status: 'removed', content: '' } })
  return { id: updated.id, status: updated.status }
}

export async function setBlogReaction(user: JwtPayload, postId: string, type: unknown, active: boolean) {
  await readablePublishedPost(user, postId)
  const normalized = blogReaction(type)
  if (active) await prisma.blogReaction.upsert({ where: { postId_userId_type: { postId, userId: user.userId, type: normalized } }, create: { postId, userId: user.userId, type: normalized }, update: {} })
  else await prisma.blogReaction.deleteMany({ where: { postId, userId: user.userId, type: normalized } })
  return getBlogCommunity(user, postId)
}

export async function setBlogBookmark(user: JwtPayload, postId: string, active: boolean) {
  await readablePublishedPost(user, postId)
  if (active) await prisma.blogBookmark.upsert({ where: { postId_userId: { postId, userId: user.userId } }, create: { postId, userId: user.userId }, update: {} })
  else await prisma.blogBookmark.deleteMany({ where: { postId, userId: user.userId } })
  return getBlogCommunity(user, postId)
}

export async function reportBlogContent(user: JwtPayload, postId: string, body: any) {
  const post = await readablePublishedPost(user, postId)
  const reason = text(body?.reason, 120)
  const details = nullableText(body?.details, 5000)
  if (!reason) fail(422, 'BLOG_REPORT_REASON_REQUIRED', '请选择举报原因')
  const commentId = nullableText(body?.commentId, 100)
  const comment = commentId ? await prisma.blogComment.findFirst({ where: { id: commentId, postId } }) : null
  if (commentId && !comment) fail(404, 'BLOG_COMMENT_NOT_FOUND', '评论不存在')
  const existing = await prisma.blogReport.findFirst({ where: { postId, commentId, reporterUserId: user.userId, status: 'pending' }, select: { id: true } })
  if (existing) fail(409, 'BLOG_REPORT_PENDING', '你已经举报过该内容，平台正在处理')
  return prisma.blogReport.create({ data: {
    id: crypto.randomUUID(), postId, commentId, reporterUserId: user.userId, reason, details,
    evidenceSnapshot: {
      postVersionId: post.currentVersionId, title: post.CurrentVersion?.title,
      contentHash: post.CurrentVersion?.contentHash,
      ...(comment ? { comment: { id: comment.id, authorUserId: comment.authorUserId, content: comment.content, createdAt: comment.createdAt } } : {}),
    },
  } })
}

function requireBlogModerator(user: JwtPayload) {
  if (!['platform_admin', 'super_admin'].includes(user.accountRole)) fail(403, 'BLOG_MODERATION_FORBIDDEN', '只有平台管理员可以执行博客治理')
}

export async function listBlogReports(user: JwtPayload, query: any) {
  requireBlogModerator(user)
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 100 })
  const status = query?.status ? text(query.status, 30).toLowerCase() : undefined
  const where = status ? { status } : {}
  const [items, total] = await Promise.all([
    prisma.blogReport.findMany({ where, orderBy: { createdAt: 'asc' }, skip, take: pageSize, select: {
      id: true, postId: true, commentId: true, reason: true, status: true, createdAt: true, reviewedAt: true,
      Reporter: { select: { id: true, username: true } },
      Post: { select: { id: true, slug: true, Author: { select: { id: true, username: true } }, CurrentVersion: { select: { title: true } } } },
    } }),
    prisma.blogReport.count({ where }),
  ])
  return paginatedResponse(items, total, page, pageSize)
}

export async function getBlogReport(user: JwtPayload, reportId: string, query: any) {
  requireBlogModerator(user)
  const accessReason = text(query?.reason, 500)
  if (accessReason.length < 5) fail(422, 'BLOG_REPORT_ACCESS_REASON_REQUIRED', '查看举报证据必须填写至少 5 个字符的原因')
  return prisma.$transaction(async tx => {
    const report = await tx.blogReport.findUnique({
      where: { id: reportId },
      include: {
        Reporter: { select: { id: true, username: true } },
        Comment: { select: { id: true, authorUserId: true, content: true, status: true, createdAt: true } },
        Post: { select: {
          id: true, slug: true, status: true,
          Author: { select: { id: true, username: true } },
          CurrentVersion: { select: { title: true } },
          Features: { where: { status: 'active' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, reason: true, createdAt: true } },
        } },
      },
    })
    if (!report) fail(404, 'BLOG_REPORT_NOT_FOUND', '举报不存在')
    await tx.platformAuditLog.create({ data: {
      id: crypto.randomUUID(), actorUserId: user.userId, action: 'blog_report_evidence_viewed',
      targetType: 'blog_report', targetId: reportId, metadata: { accessReason, postId: report.postId, commentId: report.commentId },
    } })
    return report
  })
}

export async function moderateBlogReport(user: JwtPayload, reportId: string, body: any) {
  requireBlogModerator(user)
  const decision = String(body?.decision || '').toLowerCase()
  if (!['resolved', 'dismissed'].includes(decision)) fail(422, 'BLOG_REPORT_DECISION_INVALID', '审核结论无效')
  const resolutionNote = text(body?.resolutionNote, 5000)
  if (resolutionNote.length < 5) fail(422, 'BLOG_REPORT_NOTE_REQUIRED', '处理意见至少需要 5 个字符')
  const action = String(body?.action || 'none').toLowerCase()
  if (!['none', 'hide_comment', 'hold_post', 'remove_post'].includes(action)) fail(422, 'BLOG_MODERATION_ACTION_INVALID', '治理动作无效')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blog-report:${reportId}`}, 0)) IS NULL AS locked`
    const report = await tx.blogReport.findUnique({ where: { id: reportId } })
    if (!report) fail(404, 'BLOG_REPORT_NOT_FOUND', '举报不存在')
    if (report.status !== 'pending') fail(409, 'BLOG_REPORT_ALREADY_PROCESSED', '举报已经处理')
    if (action === 'hide_comment' && report.commentId) await tx.blogComment.update({ where: { id: report.commentId }, data: { status: 'hidden' } })
    if (action === 'hide_comment' && !report.commentId) fail(422, 'BLOG_MODERATION_COMMENT_REQUIRED', '该举报不是评论举报，不能执行隐藏评论')
    if (action === 'hold_post') await tx.blogPost.update({ where: { id: report.postId }, data: { status: 'MODERATION_HOLD' } })
    if (action === 'remove_post') await tx.blogPost.update({ where: { id: report.postId }, data: { status: 'REMOVED' } })
    const updated = await tx.blogReport.update({ where: { id: reportId }, data: { status: decision, reviewedByUserId: user.userId, reviewedAt: new Date(), resolutionNote } })
    await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId: user.userId, action: `blog_report_${decision}`, targetType: 'blog_report', targetId: reportId, metadata: { action, postId: report.postId, commentId: report.commentId } } })
    return updated
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function setBlogFeatured(user: JwtPayload, postId: string, body: any) {
  requireBlogModerator(user)
  const active = body?.active !== false
  const reason = nullableText(body?.reason, 1000)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blog-feature:${postId}`}, 0)) IS NULL AS locked`
    const post = await tx.blogPost.findUnique({ where: { id: postId }, select: { id: true, status: true } })
    if (!post || post.status !== 'PUBLISHED') fail(404, 'BLOG_NOT_FOUND', '只能精选已发布博客')
    const current = await tx.blogFeature.findFirst({ where: { postId, status: 'active' }, orderBy: { createdAt: 'desc' } })
    if (active && !current) {
      await tx.blogFeature.create({ data: { id: crypto.randomUUID(), postId, createdByUserId: user.userId, reason } })
    } else if (!active && current) {
      await tx.blogFeature.update({ where: { id: current.id }, data: { status: 'retired', retiredAt: new Date() } })
    }
    await tx.platformAuditLog.create({ data: {
      id: crypto.randomUUID(), actorUserId: user.userId,
      action: active ? 'blog_featured' : 'blog_feature_retired', targetType: 'blog_post', targetId: postId,
      metadata: { reason },
    } })
    return { featured: active }
  })
}

export async function listMyBlogPosts(user: JwtPayload, query: any) {
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 100 })
  const status = query?.status === undefined || query.status === ''
    ? undefined
    : parseEnum(query.status, ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'MODERATION_HOLD', 'REMOVED'] as const, 'status')
  const where: Prisma.BlogPostWhereInput = {
    authorUserId: user.userId,
    ...(status ? { status } : {}),
  }
  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: pageSize, include: postInclude }),
    prisma.blogPost.count({ where }),
  ])
  return {
    items: posts.map(post => postDto(post, true)),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  }
}

export async function listBlogVersions(user: JwtPayload, postId: string) {
  const post = await prisma.blogPost.findUnique({ where: { id: postId } })
  if (!post) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
  const versions = await prisma.blogPostVersion.findMany({
    where: { postId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, title: true, summary: true, contentHash: true, sourceVersionId: true, status: true, visibility: true, organizationIdSnapshot: true, classificationSnapshot: true, publishedAt: true },
  })
  const visible = []
  for (const version of versions) {
    if (await canReadVersion(user, post, version, false)) {
      const { organizationIdSnapshot: _privateOrganizationId, ...item } = version
      visible.push(item)
    }
  }
  if (post.authorUserId !== user.userId && visible.length === 0 && !await canReadPost(user, post, true)) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
  return visible
}

export async function getBlogVersion(user: JwtPayload, postId: string, versionId: string) {
  const post = await prisma.blogPost.findUnique({ where: { id: postId } })
  if (!post) fail(404, 'BLOG_NOT_FOUND', '博客不存在')
  const version = await prisma.blogPostVersion.findFirst({
    where: { id: versionId, postId },
    include: { References: { orderBy: { ordinal: 'asc' }, include: referenceInclude } },
  })
  if (!version || !await canReadVersion(user, post, version, true)) fail(404, 'BLOG_VERSION_NOT_FOUND', '博客版本不存在')
  return {
    id: version.id,
    version: version.version,
    title: version.title,
    summary: version.summary,
    contentMarkdown: version.contentMarkdown,
    contentHash: version.contentHash,
    sourceVersionId: version.sourceVersionId,
    status: version.status,
    visibility: version.visibility,
    classification: version.classificationSnapshot,
    publishedAt: version.publishedAt,
    references: version.References.map(referenceDto),
    renderingContract: SAFE_RENDERING_CONTRACT,
  }
}

export async function getBlogReferences(user: JwtPayload, postId: string) {
  const post = await getBlogPost(user, postId)
  return post.currentVersion?.references || []
}

async function discoveryRows(user: JwtPayload, where: Prisma.BlogReferenceWhereInput, query: any) {
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 100 })
  const references = await prisma.blogReference.findMany({
    where: {
      ...where,
      PostVersion: { Post: { status: 'PUBLISHED', visibility: { in: ['PUBLIC', 'PLATFORM', 'ORGANIZATION'] } } },
    },
    orderBy: { createdAt: 'desc' },
    include: { PostVersion: { include: { Post: { include: postInclude } } } },
  })
  const unique = new Map<string, any>()
  for (const reference of references) {
    const post = reference.PostVersion.Post
    if (post.currentVersionId !== reference.postVersionId || unique.has(post.id)) continue
    if (await canReadPost(user, post, false)) unique.set(post.id, post)
  }
  const rows = [...unique.values()]
  const pagination = paginatedResponse([], rows.length, page, pageSize)
  return {
    items: rows.slice(skip, skip + pageSize).map(post => postDto(post, false)),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total: pagination.total,
    totalPages: pagination.totalPages,
  }
}

export function listProblemBlogs(user: JwtPayload, problemId: string, query: any) {
  return discoveryRows(user, { problemId }, query)
}

export function listContestBlogs(user: JwtPayload, contestId: string | number, query: any) {
  return discoveryRows(user, { contestId: String(contestId) }, query)
}

export async function listSolutionBlogs(user: JwtPayload, solutionId: string, query: any) {
  const versions = await prisma.problemSolutionVersion.findMany({ where: { solutionId }, select: { id: true } })
  return discoveryRows(user, { solutionVersionId: { in: versions.map(item => item.id) } }, query)
}

export async function listUserBlogs(user: JwtPayload, authorUserId: string, query: any) {
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 100 })
  const candidates = await prisma.blogPost.findMany({
    where: {
      authorUserId,
      status: 'PUBLISHED',
      currentVersionId: { not: null },
      visibility: { in: ['PUBLIC', 'PLATFORM', 'ORGANIZATION'] },
    },
    orderBy: { publishedAt: 'desc' },
    include: postInclude,
  })
  const visible: any[] = []
  for (const post of candidates) if (await canReadPost(user, post, false)) visible.push(post)
  const pagination = paginatedResponse([], visible.length, page, pageSize)
  return {
    items: visible.slice(skip, skip + pageSize).map(post => postDto(post, false)),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total: pagination.total,
    totalPages: pagination.totalPages,
  }
}

function seriesDto(series: any, entries?: any[]) {
  return {
    id: series.id,
    title: series.title,
    description: series.description,
    visibility: series.visibility,
    organizationId: series.organizationId,
    revision: series.revision,
    archivedAt: series.archivedAt,
    updatedAt: series.updatedAt,
    owner: series.Owner,
    entryCount: series._count?.Entries ?? entries?.length ?? 0,
    ...(entries ? { entries } : {}),
  }
}

async function canReadSeries(user: JwtPayload, series: { ownerUserId: string; archivedAt: Date | null; visibility: BlogVisibility; organizationId: string | null }, direct: boolean) {
  if (series.ownerUserId === user.userId) return true
  if (series.archivedAt) return false
  if (series.visibility === 'PUBLIC') return true
  if (series.visibility === 'PLATFORM') return true
  if (series.visibility === 'UNLISTED') return direct
  if (series.visibility !== 'ORGANIZATION' || !series.organizationId) return false
  return prisma.$transaction(tx => activeOrganizationMember(tx, user.userId, series.organizationId!))
}

function parseSeriesVisibility(value: unknown, organizationId: string | null, fallback: BlogVisibility = BlogVisibility.PRIVATE) {
  const visibility = parseEnum(value, Object.values(BlogVisibility), 'visibility', fallback)
  if (visibility === 'ORGANIZATION' && !organizationId) fail(422, 'BLOG_ORGANIZATION_REQUIRED', '组织可见系列必须选择组织')
  if (organizationId && !['PRIVATE', 'ORGANIZATION'].includes(visibility)) {
    fail(422, 'BLOG_SERIES_VISIBILITY_INVALID', '组织系列首版只支持仅自己或组织可见')
  }
  return visibility
}

export async function createBlogSeries(user: JwtPayload, body: any) {
  const title = normalizedName(body?.title, 'title', 120)
  const organizationId = nullableText(body?.organizationId, 100)
  if (organizationId && !await prisma.$transaction(tx => activeOrganizationMember(tx, user.userId, organizationId))) {
    fail(403, 'BLOG_ORGANIZATION_ACCESS_DENIED', '只能在自己所属的有效组织创建系列')
  }
  const visibility = parseSeriesVisibility(body?.visibility, organizationId)
  const scopeKey = organizationId ? `organization:${organizationId}` : `user:${user.userId}`
  try {
    const series = await prisma.blogSeries.create({ data: {
      id: crypto.randomUUID(), ownerUserId: user.userId, organizationId, scopeKey,
      normalizedKey: title.key, title: title.name, description: nullableText(body?.description, 1000), visibility,
    }, include: { Owner: { select: { id: true, username: true, avatar: true } }, _count: { select: { Entries: true } } } })
    return seriesDto(series)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, 'BLOG_SERIES_NAME_CONFLICT', '该范围内已经存在同名系列')
    throw error
  }
}

export async function listMyBlogSeries(user: JwtPayload, query: any) {
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 50, maxPageSize: 100 })
  const includeArchived = String(query?.includeArchived || '') === 'true'
  const where: Prisma.BlogSeriesWhereInput = { ownerUserId: user.userId, ...(includeArchived ? {} : { archivedAt: null }) }
  const [rows, total] = await Promise.all([
    prisma.blogSeries.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: pageSize, include: { Owner: { select: { id: true, username: true, avatar: true } }, _count: { select: { Entries: true } } } }),
    prisma.blogSeries.count({ where }),
  ])
  return { items: rows.map(row => seriesDto(row)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
}

export async function getBlogSeries(user: JwtPayload, seriesId: string) {
  const series = await prisma.blogSeries.findUnique({
    where: { id: seriesId },
    include: {
      Owner: { select: { id: true, username: true, avatar: true } },
      Entries: { orderBy: { orderIndex: 'asc' }, include: { Post: { include: postInclude } } },
    },
  })
  if (!series || !await canReadSeries(user, series, true)) fail(404, 'BLOG_SERIES_NOT_FOUND', '系列不存在')
  const entries = []
  for (const entry of series.Entries) {
    if (await canReadPost(user, entry.Post, true)) entries.push({ orderIndex: entry.orderIndex, post: postDto(entry.Post, entry.Post.authorUserId === user.userId) })
  }
  return seriesDto(series, entries)
}

export async function updateBlogSeries(user: JwtPayload, seriesId: string, body: any) {
  if (!Number.isInteger(body?.expectedRevision) || body.expectedRevision < 1) fail(422, 'BLOG_SERIES_REVISION_REQUIRED', '必须提供有效的 expectedRevision')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blog-series:${seriesId}`}, 0)) IS NULL AS locked`
    const series = await tx.blogSeries.findUnique({ where: { id: seriesId }, include: { Entries: { include: { Post: true } } } })
    if (!series || series.ownerUserId !== user.userId) fail(404, 'BLOG_SERIES_NOT_FOUND', '系列不存在')
    if (series.revision !== body.expectedRevision) fail(409, 'BLOG_SERIES_STALE', '系列已被其他编辑更新', { currentRevision: series.revision })
    if (series.archivedAt) fail(409, 'BLOG_SERIES_ARCHIVED', '已归档系列不能编辑')
    const title = body.title === undefined ? { name: series.title, key: series.normalizedKey } : normalizedName(body.title, 'title', 120)
    const visibility = body.visibility === undefined ? series.visibility : parseSeriesVisibility(body.visibility, series.organizationId, series.visibility)
    if (visibility !== series.visibility && series.Entries.some(entry => entry.Post.status === 'PUBLISHED' && entry.Post.visibility !== visibility)) {
      fail(422, 'BLOG_SERIES_VISIBILITY_CONFLICT', '系列中存在不同可见范围的已发布文章，请先发布匹配范围的新文章版本')
    }
    try {
      const updated = await tx.blogSeries.update({ where: { id: seriesId }, data: {
        title: title.name, normalizedKey: title.key,
        description: body.description === undefined ? series.description : nullableText(body.description, 1000),
        visibility, revision: { increment: 1 },
      }, include: { Owner: { select: { id: true, username: true, avatar: true } }, _count: { select: { Entries: true } } } })
      return seriesDto(updated)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, 'BLOG_SERIES_NAME_CONFLICT', '该范围内已经存在同名系列')
      throw error
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function reorderBlogSeries(user: JwtPayload, seriesId: string, body: any) {
  if (!Number.isInteger(body?.expectedRevision) || body.expectedRevision < 1) fail(422, 'BLOG_SERIES_REVISION_REQUIRED', '必须提供有效的 expectedRevision')
  if (!Array.isArray(body?.postIds)) fail(422, 'BLOG_SERIES_ENTRIES_INVALID', 'postIds 必须是数组')
  const postIds = body.postIds.map((value: unknown) => text(value, 100))
  if (postIds.some((id: string) => !id) || new Set(postIds).size !== postIds.length) fail(422, 'BLOG_SERIES_ENTRIES_INVALID', '系列文章列表包含空值或重复项')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blog-series:${seriesId}`}, 0)) IS NULL AS locked`
    const series = await tx.blogSeries.findUnique({ where: { id: seriesId }, include: { Entries: { orderBy: { orderIndex: 'asc' } } } })
    if (!series || series.ownerUserId !== user.userId) fail(404, 'BLOG_SERIES_NOT_FOUND', '系列不存在')
    if (series.revision !== body.expectedRevision) fail(409, 'BLOG_SERIES_STALE', '系列已被其他编辑更新', { currentRevision: series.revision })
    const currentIds = series.Entries.map(entry => entry.postId).sort()
    const requestedIds = [...postIds].sort()
    if (currentIds.length !== requestedIds.length || currentIds.some((id, index) => id !== requestedIds[index])) {
      fail(422, 'BLOG_SERIES_ENTRIES_INVALID', '重排必须且只能包含系列中的全部文章')
    }
    if (postIds.length) {
      const offset = postIds.length + 1000
      await tx.blogSeriesEntry.updateMany({ where: { seriesId }, data: { orderIndex: { increment: offset } } })
      for (const [orderIndex, postId] of postIds.entries()) await tx.blogSeriesEntry.update({ where: { seriesId_postId: { seriesId, postId } }, data: { orderIndex } })
    }
    const updated = await tx.blogSeries.update({ where: { id: seriesId }, data: { revision: { increment: 1 } }, include: { Owner: { select: { id: true, username: true, avatar: true } }, _count: { select: { Entries: true } } } })
    return seriesDto(updated)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function listBlogTags(user: JwtPayload, query: any) {
  const q = text(query?.q, 30)
  const tags = await prisma.blogTag.findMany({
    where: {
      OR: [{ kind: 'SYSTEM' }, { kind: 'USER', ownerUserId: user.userId }],
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    take: 100,
    select: { id: true, kind: true, name: true },
  })
  return { items: tags, maxPerPost: MAX_TAGS }
}

export async function createBlogTag(user: JwtPayload, body: any, system = false) {
  if (system && !['super_admin', 'platform_admin'].includes(user.accountRole)) fail(403, 'BLOG_TAG_ADMIN_REQUIRED', '只有平台管理员可以创建系统标签')
  const tag = normalizedName(body?.name, 'name', 30)
  const kind: BlogTagKind = system ? 'SYSTEM' : 'USER'
  const scopeKey = system ? 'system' : `user:${user.userId}`
  const ownerUserId = system ? null : user.userId
  return prisma.blogTag.upsert({
    where: { scopeKey_normalizedKey: { scopeKey, normalizedKey: tag.key } },
    create: { id: crypto.randomUUID(), kind, scopeKey, ownerUserId, name: tag.name, normalizedKey: tag.key },
    update: {},
    select: { id: true, kind: true, name: true },
  })
}

export async function listTagBlogs(user: JwtPayload, tagId: string, query: any) {
  const tag = await prisma.blogTag.findUnique({ where: { id: tagId }, select: { id: true, name: true, kind: true } })
  if (!tag) fail(404, 'BLOG_TAG_NOT_FOUND', '标签不存在')
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 20, maxPageSize: 100 })
  const links = await prisma.blogPostTag.findMany({ where: { tagId }, orderBy: { createdAt: 'desc' }, include: { Post: { include: postInclude } } })
  const visible = []
  for (const link of links) if (await canReadPost(user, link.Post, false)) visible.push(link.Post)
  return { tag, items: visible.slice(skip, skip + pageSize).map(post => postDto(post, false)), page, pageSize, total: visible.length, totalPages: Math.ceil(visible.length / pageSize) }
}

export async function createBlogFromContest(user: JwtPayload, contestId: number) {
  const resolved = await findContestForBlogReview(contestId)
  const training = resolved?.activity
  if (!training?.finalizedStandingId) fail(409, 'BLOG_CONTEST_NOT_FINALIZED', '比赛尚未生成固定榜单，不能创建复盘')
  await prisma.$transaction(tx => resolveReference(tx, user, {
    type: 'CONTEST_STANDING',
    standingSnapshotId: training.finalizedStandingId!,
    relationType: 'PRIMARY_SUBJECT',
    displayMode: 'CARD',
    positionKey: 'contest-result',
  }))
  return createBlogPost(user, {
    type: 'CONTEST_REVIEW',
    title: `${training.title} 复盘`,
    contentMarkdown: '## 比赛思路\n\n## 出现的问题\n\n## 后续改进\n',
    references: [{ type: 'CONTEST_STANDING', standingSnapshotId: training.finalizedStandingId, relationType: 'PRIMARY_SUBJECT', displayMode: 'CARD', positionKey: 'contest-result' }],
  })
}

export async function createBlogFromSolution(user: JwtPayload, solutionVersionId: string) {
  const version = await prisma.problemSolutionVersion.findUnique({ where: { id: solutionVersionId }, select: { id: true, title: true } })
  if (!version) fail(404, 'BLOG_REFERENCE_NOT_FOUND', '题解版本不存在')
  // Publication performs the final access check; creating the draft also
  // resolves the reference once so an inaccessible solution fails now.
  await prisma.$transaction(tx => resolveReference(tx, user, { type: 'SOLUTION_VERSION', solutionVersionId, relationType: 'SOURCE', displayMode: 'CARD', positionKey: 'source-solution' }))
  return createBlogPost(user, {
    type: 'SOLUTION_NOTE',
    title: `${version.title} 学习笔记`,
    contentMarkdown: '## 为什么这样思考\n\n## 容易出错的地方\n\n## 另一种理解\n',
    references: [{ type: 'SOLUTION_VERSION', solutionVersionId, relationType: 'SOURCE', displayMode: 'CARD', positionKey: 'source-solution' }],
  })
}

export async function convertBlogVersionToSolutionContribution(user: JwtPayload, postId: string, versionId: string, body: any) {
  const post = await prisma.blogPost.findUnique({ where: { id: postId }, include: { Versions: { where: { id: versionId }, include: { References: true } } } })
  if (!post || post.authorUserId !== user.userId || !post.Versions[0]) fail(404, 'BLOG_VERSION_NOT_FOUND', '只能将自己的固定博客版本投稿为题解')
  const version = post.Versions[0]
  const requestedProblemId = nullableText(body?.problemId, 100)
  const problemReferences = version.References.filter(reference => ['PROBLEM', 'PROBLEM_REVISION'].includes(reference.referenceType))
  const problemReference = requestedProblemId
    ? problemReferences.find(reference => reference.problemId === requestedProblemId)
    : problemReferences.find(reference => reference.relationType === 'PRIMARY_SUBJECT') || (problemReferences.length === 1 ? problemReferences[0] : null)
  if (!problemReference?.problemId) fail(422, 'BLOG_SOLUTION_PROBLEM_REQUIRED', '博客必须结构化引用一个目标题目，或明确提供已引用的 problemId')
  try {
    return await createSolutionContribution(user, problemReference.problemId, {
      ...body,
      type: body?.type || 'COMMUNITY_EDITORIAL',
      title: body?.title || version.title,
      summary: body?.summary === undefined ? version.summary : body.summary,
      contentMarkdown: version.contentMarkdown,
      sourceType: body?.sourceType || 'ORIGINAL',
      testSetRevisionId: body?.testSetRevisionId || problemReference.problemRevisionId || undefined,
    })
  } catch (error) {
    if (error instanceof SolutionDomainError) throw new BlogDomainError(error.statusCode, error.code, error.message)
    throw error
  }
}

export const BLOG_RENDERING_CONTRACT = SAFE_RENDERING_CONTRACT
