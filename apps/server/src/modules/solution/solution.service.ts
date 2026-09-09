import crypto from 'node:crypto'
import yaml from 'js-yaml'
import type { JwtPayload } from '@oi-manager/shared'
import {
  Prisma,
  SolutionContributionStatus,
  SolutionReviewDecision,
  SolutionReviewType,
  SolutionSourceType,
  SolutionType,
  SolutionVisibilityPolicy,
} from '@prisma/client'
import { prisma } from '../../prisma'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo } from '../judge/domain/submission-io'
import { canModifyProblem, canViewProblem } from '../problem/problem.access'
import { resolveContributionOrganization } from '../contribution/application/contribution.service'

const MAX_MARKDOWN_BYTES = 1024 * 1024
const MAX_CODE_BYTES = 512 * 1024
const FULL_TYPES: SolutionType[] = ['OFFICIAL_EDITORIAL', 'COMMUNITY_EDITORIAL', 'ALTERNATIVE_SOLUTION']
const EDITABLE_STATUSES: SolutionContributionStatus[] = ['DRAFT', 'NEEDS_REVISION']
const LICENSE_VERSION = 1
const RULE_CODE = 'solution_reward'
const RULE_VERSION = 1

export class SolutionDomainError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new SolutionDomainError(statusCode, code, message)
}

function text(value: unknown, max = 10_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function optionalText(value: unknown, max = 10_000) {
  const result = text(value, max)
  return result || null
}

function parseEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  const result = String(value || '').toUpperCase() as T
  if (!values.includes(result)) fail(422, 'SOLUTION_FIELD_INVALID', `${field} 无效`)
  return result
}

function parseTags(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) fail(422, 'SOLUTION_TAGS_INVALID', 'algorithmTags 必须是数组')
  const tags = [...new Set(value.map(item => text(item, 40)).filter(Boolean))]
  if (tags.length > 20) fail(422, 'SOLUTION_TAGS_INVALID', '算法标签不能超过 20 个')
  return tags as Prisma.InputJsonValue
}

function assertSafeMarkdown(markdown: string) {
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) fail(413, 'SOLUTION_CONTENT_TOO_LARGE', '题解 Markdown 不能超过 1MB')
  if (/<\s*(script|iframe|object|embed|style|link|meta)\b/i.test(markdown) || /(?:javascript|vbscript)\s*:/i.test(markdown)) {
    fail(422, 'SOLUTION_CONTENT_UNSAFE', '题解包含不允许的 HTML 或危险链接')
  }
}

function assertDraftFields(input: DraftFields) {
  if (input.title.length < 3) fail(422, 'SOLUTION_TITLE_REQUIRED', '标题至少需要 3 个字符')
  if (!input.contentMarkdown) fail(422, 'SOLUTION_CONTENT_REQUIRED', '题解内容不能为空')
  assertSafeMarkdown(input.contentMarkdown)
  if (input.referenceCode && Buffer.byteLength(input.referenceCode, 'utf8') > MAX_CODE_BYTES) {
    fail(413, 'SOLUTION_CODE_TOO_LARGE', '参考代码不能超过 512KB')
  }
  if (input.approachKey && !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(input.approachKey)) {
    fail(422, 'SOLUTION_APPROACH_KEY_INVALID', 'approachKey 只能使用小写字母、数字、下划线或连字符')
  }
  if (input.sourceType !== 'ORIGINAL' && !input.sourceUrl && !input.citation) {
    fail(422, 'SOLUTION_SOURCE_REQUIRED', '派生、翻译或授权内容必须提供来源链接或引用说明')
  }
  if (input.sourceUrl) {
    try {
      const url = new URL(input.sourceUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    } catch {
      fail(422, 'SOLUTION_SOURCE_URL_INVALID', '来源链接必须是有效的 HTTP(S) URL')
    }
  }
}

function assertSubmissionComplete(input: DraftFields) {
  assertDraftFields(input)
  if (FULL_TYPES.includes(input.type)) {
    if (input.contentMarkdown.length < 80) fail(422, 'SOLUTION_INCOMPLETE', '完整题解内容过短')
    if (!input.complexityTime || !input.complexityMemory) fail(422, 'SOLUTION_COMPLEXITY_REQUIRED', '完整题解必须声明时间和空间复杂度')
    if (!input.referenceCode || !input.language) fail(422, 'SOLUTION_REFERENCE_CODE_REQUIRED', '完整题解必须提供参考代码和语言')
  }
  if (input.type === 'CORRECTION' && !input.baseSolutionId) fail(422, 'SOLUTION_BASE_REQUIRED', '纠错投稿必须关联目标题解')
  if (input.type === 'TRANSLATION' && !input.baseVersionId) fail(422, 'SOLUTION_BASE_VERSION_REQUIRED', '翻译投稿必须关联来源版本')
}

interface DraftFields {
  type: SolutionType
  baseSolutionId: string | null
  baseVersionId: string | null
  title: string
  summary: string | null
  contentMarkdown: string
  algorithmTags?: Prisma.InputJsonValue
  approachKey: string | null
  complexityTime: string | null
  complexityMemory: string | null
  language: string | null
  referenceCode: string | null
  sourceType: SolutionSourceType
  sourceUrl: string | null
  citation: string | null
}

function draftFields(body: any, current?: DraftFields): DraftFields {
  const types = Object.values(SolutionType)
  const sources = Object.values(SolutionSourceType)
  return {
    type: body.type === undefined && current ? current.type : parseEnum(body.type, types, 'type'),
    baseSolutionId: body.baseSolutionId === undefined && current ? current.baseSolutionId : optionalText(body.baseSolutionId, 100),
    baseVersionId: body.baseVersionId === undefined && current ? current.baseVersionId : optionalText(body.baseVersionId, 100),
    title: body.title === undefined && current ? current.title : text(body.title, 160),
    summary: body.summary === undefined && current ? current.summary : optionalText(body.summary, 1000),
    contentMarkdown: body.contentMarkdown === undefined && current ? current.contentMarkdown : (typeof body.contentMarkdown === 'string' ? body.contentMarkdown : ''),
    algorithmTags: body.algorithmTags === undefined && current ? current.algorithmTags : parseTags(body.algorithmTags),
    approachKey: body.approachKey === undefined && current ? current.approachKey : optionalText(body.approachKey, 80)?.toLowerCase() || null,
    complexityTime: body.complexityTime === undefined && current ? current.complexityTime : optionalText(body.complexityTime, 120),
    complexityMemory: body.complexityMemory === undefined && current ? current.complexityMemory : optionalText(body.complexityMemory, 120),
    language: body.language === undefined && current ? current.language : optionalText(body.language, 40),
    referenceCode: body.referenceCode === undefined && current ? current.referenceCode : (typeof body.referenceCode === 'string' ? body.referenceCode : null),
    sourceType: body.sourceType === undefined && current ? current.sourceType : parseEnum(body.sourceType, sources, 'sourceType'),
    sourceUrl: body.sourceUrl === undefined && current ? current.sourceUrl : optionalText(body.sourceUrl, 2000),
    citation: body.citation === undefined && current ? current.citation : optionalText(body.citation, 4000),
  }
}

async function statementSnapshot(problemId: string) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    select: {
      title: true, description: true, statementType: true, statementPdfUrl: true,
      ProblemStatement: { orderBy: [{ type: 'asc' }, { format: 'asc' }, { language: 'asc' }], select: { type: true, format: true, language: true, content: true, fileUrl: true, isVisible: true } },
    },
  })
  if (!problem) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  const value = problem as unknown as Prisma.InputJsonValue
  return { value, hash: crypto.createHash('sha256').update(JSON.stringify(problem)).digest('hex') }
}

function snapshotHash(fields: DraftFields, statementHash: string, revisionId: string) {
  return crypto.createHash('sha256').update(JSON.stringify({ ...fields, statementHash, revisionId })).digest('hex')
}

async function requireProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canViewProblem(user, problem)) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  return problem
}

async function resolveTargetRevision(problemId: string, value: unknown) {
  const id = optionalText(value, 100)
  const revision = id
    ? await prisma.problemTestSetRevision.findFirst({ where: { id, problemId } })
    : await prisma.problemTestSetRevision.findFirst({ where: { problemId }, orderBy: { revisionNumber: 'desc' } })
  if (!revision) fail(409, 'SOLUTION_TEST_SET_REVISION_REQUIRED', '题目没有可用于验证的正式测试版本')
  return revision
}

async function assertBase(problemId: string, fields: DraftFields) {
  if (fields.baseSolutionId) {
    const solution = await prisma.problemSolution.findFirst({ where: { id: fields.baseSolutionId, problemId } })
    if (!solution) fail(422, 'SOLUTION_BASE_INVALID', '关联题解不属于当前题目')
  }
  if (fields.baseVersionId) {
    const version = await prisma.problemSolutionVersion.findFirst({ where: { id: fields.baseVersionId, Solution: { problemId } } })
    if (!version) fail(422, 'SOLUTION_BASE_VERSION_INVALID', '关联版本不属于当前题目')
    if (fields.baseSolutionId && version.solutionId !== fields.baseSolutionId) fail(422, 'SOLUTION_BASE_VERSION_INVALID', '关联版本与题解不一致')
  }
}

export async function createSolutionContribution(user: JwtPayload, problemId: string, body: any) {
  const problem = await requireProblem(user, problemId)
  if (body?.licenseAccepted !== true) fail(422, 'SOLUTION_LICENSE_REQUIRED', '必须确认原创或授权声明')
  const fields = draftFields(body)
  assertDraftFields(fields)
  await assertBase(problem.id, fields)
  const targetRevision = await resolveTargetRevision(problem.id, body?.testSetRevisionId)
  const organizationId = await resolveContributionOrganization(user.userId, body?.organizationId)
  const statement = await statementSnapshot(problem.id)
  return prisma.solutionContribution.create({ data: {
    id: crypto.randomUUID(), problemId: problem.id, authorUserId: user.userId, organizationId,
    ...fields, algorithmTags: fields.algorithmTags ?? Prisma.JsonNull,
    licenseDeclarationVersion: LICENSE_VERSION, licenseAcceptedAt: new Date(),
    targetTestSetRevisionId: targetRevision.id, statementSnapshotHash: statement.hash,
  } })
}

export async function updateSolutionContribution(user: JwtPayload, id: string, body: any) {
  const contribution = await prisma.solutionContribution.findUnique({ where: { id } })
  if (!contribution || contribution.authorUserId !== user.userId) fail(404, 'SOLUTION_CONTRIBUTION_NOT_FOUND', '投稿不存在')
  if (!EDITABLE_STATUSES.includes(contribution.status)) fail(409, 'SOLUTION_CONTRIBUTION_FROZEN', '已送审内容不能修改，请等待审核结果')
  const fields = draftFields(body, contribution as DraftFields)
  assertDraftFields(fields)
  await assertBase(contribution.problemId, fields)
  let targetRevisionId = contribution.targetTestSetRevisionId
  if (body?.testSetRevisionId !== undefined) targetRevisionId = (await resolveTargetRevision(contribution.problemId, body.testSetRevisionId)).id
  const organizationId = body?.organizationId === undefined ? contribution.organizationId : await resolveContributionOrganization(user.userId, body.organizationId)
  return prisma.solutionContribution.update({ where: { id }, data: {
    ...fields, algorithmTags: fields.algorithmTags ?? Prisma.JsonNull,
    organizationId, targetTestSetRevisionId: targetRevisionId,
    statementSnapshotHash: (await statementSnapshot(contribution.problemId)).hash,
  } })
}

async function assertSubmissionEligibility(user: JwtPayload, contribution: { problemId: string; targetTestSetRevisionId: string; type: SolutionType }) {
  if (!FULL_TYPES.includes(contribution.type) || ['teacher', 'school_principal', 'platform_admin', 'super_admin'].includes(user.role)) return
  const solved = await prisma.submission.findFirst({ where: {
    userId: user.userId, problemInternalId: contribution.problemId, testSetRevisionId: contribution.targetTestSetRevisionId,
    OR: [
      { CurrentJudgeRun: { is: { status: 'FINALIZED', result: 'accepted', score: { gte: 100 } } } },
      { CurrentJudgeRun: { is: null }, result: 'accepted', score: { gte: 100 } },
    ],
  }, select: { id: true } })
  if (!solved) fail(403, 'SOLUTION_AUTHOR_NOT_QUALIFIED', '完整题解投稿者需要先在指定测试版本上 AC，或由教师/题目管理员投稿')
}

async function createSnapshot(user: JwtPayload, contributionId: string, resubmit: boolean) {
  const contribution = await prisma.solutionContribution.findUnique({ where: { id: contributionId } })
  if (!contribution || contribution.authorUserId !== user.userId) fail(404, 'SOLUTION_CONTRIBUTION_NOT_FOUND', '投稿不存在')
  const expected = resubmit ? 'NEEDS_REVISION' : 'DRAFT'
  if (contribution.status !== expected) fail(409, 'SOLUTION_STATUS_INVALID', resubmit ? '只有待修改投稿可以重新送审' : '只有草稿可以送审')
  const fields = contribution as DraftFields
  assertSubmissionComplete(fields)
  await assertSubmissionEligibility(user, contribution)
  const statement = await statementSnapshot(contribution.problemId)
  const revisionNumber = contribution.currentRevision + 1
  const revisionId = crypto.randomUUID()
  const now = new Date()
  return prisma.$transaction(async tx => {
    const changed = await tx.solutionContribution.updateMany({
      where: { id: contribution.id, authorUserId: user.userId, status: expected, currentRevision: contribution.currentRevision },
      data: { status: 'SUBMITTED', currentRevision: revisionNumber, submittedAt: now, statementSnapshotHash: statement.hash },
    })
    if (!changed.count) fail(409, 'SOLUTION_SUBMISSION_STALE', '投稿已被其他请求更新')
    return tx.solutionContributionRevision.create({ data: {
      id: revisionId, contributionId: contribution.id, revision: revisionNumber,
      title: fields.title, summary: fields.summary, contentMarkdown: fields.contentMarkdown,
      algorithmTags: fields.algorithmTags ?? Prisma.JsonNull, approachKey: fields.approachKey,
      complexityTime: fields.complexityTime, complexityMemory: fields.complexityMemory,
      language: fields.language, referenceCode: fields.referenceCode, sourceType: fields.sourceType,
      sourceUrl: fields.sourceUrl, citation: fields.citation,
      licenseDeclarationVersion: contribution.licenseDeclarationVersion,
      licenseAcceptedAt: contribution.licenseAcceptedAt, statementSnapshot: statement.value, statementSnapshotHash: statement.hash,
      targetTestSetRevisionId: contribution.targetTestSetRevisionId,
      contentHash: snapshotHash(fields, statement.hash, contribution.targetTestSetRevisionId), submittedAt: now,
    } })
  })
}

async function queueVerification(revisionId: string) {
  const revision = await prisma.solutionContributionRevision.findUniqueOrThrow({
    where: { id: revisionId }, include: { Contribution: { include: { Problem: true } }, TargetTestSetRevision: true },
  })
  // Explanations without executable code can skip the Judge. Corrections,
  // translations and other contribution types that carry (or inherit) a
  // reference implementation must be revalidated against their pinned
  // TestSet Revision; the contribution label must never become a bypass.
  if (!revision.referenceCode || !revision.language) {
    await prisma.$transaction([
      prisma.solutionVerification.create({ data: {
        id: crypto.randomUUID(), contributionRevisionId: revision.id,
        verifiedTestSetRevisionId: revision.targetTestSetRevisionId, status: 'SKIPPED', completedAt: new Date(),
      } }),
      prisma.solutionContribution.update({ where: { id: revision.contributionId }, data: { status: 'TECHNICALLY_VALID' } }),
    ])
    return
  }
  try {
    const config = yaml.load(revision.TargetTestSetRevision.judgeConfig || '{}') as any
    const io = normalizeSubmissionIo({ problemType: config?.type })
    await createQueuedSubmissionWithRun({
      userId: revision.Contribution.authorUserId,
      workspaceScope: revision.Contribution.organizationId ? 'campus' : 'personal',
      organizationId: revision.Contribution.organizationId,
      oj: revision.Contribution.Problem.platform,
      problemId: revision.Contribution.Problem.problemId,
      problemInternalId: revision.Contribution.problemId,
      language: revision.language!, code: revision.referenceCode!,
      codeLength: Buffer.byteLength(revision.referenceCode!, 'utf8'), result: 'queuing',
      submitMethod: 'local', submitScope: 'solution_verification', isGlobalVisible: false,
      sourceId: revision.id, submitSource: 'solution_contribution',
      testSetRevisionId: revision.targetTestSetRevisionId,
      judgeConfigHash: revision.TargetTestSetRevision.judgeConfigHash,
      judgeConfigSnapshot: revision.TargetTestSetRevision.judgeConfig,
      ...io,
    }, {
      requestedBy: revision.Contribution.authorUserId,
      afterSubmissionCreated: async (tx, submission) => {
        await tx.solutionVerification.create({ data: {
          id: crypto.randomUUID(), contributionRevisionId: revision.id, submissionId: submission.id,
          verifiedTestSetRevisionId: revision.targetTestSetRevisionId, status: 'QUEUED',
        } })
        await tx.solutionContribution.update({ where: { id: revision.contributionId }, data: { status: 'AUTO_CHECKING' } })
      },
    })
  } catch (error) {
    await prisma.$transaction([
      prisma.solutionVerification.create({ data: {
        id: crypto.randomUUID(), contributionRevisionId: revision.id,
        verifiedTestSetRevisionId: revision.targetTestSetRevisionId, status: 'INFRA_ERROR',
        errorMessage: String((error as Error).message).slice(0, 2000), completedAt: new Date(),
      } }),
      prisma.solutionContribution.update({ where: { id: revision.contributionId }, data: { status: 'NEEDS_REVISION' } }),
    ])
  }
}

export async function submitSolutionContribution(user: JwtPayload, id: string, resubmit = false) {
  const revision = await createSnapshot(user, id, resubmit)
  await queueVerification(revision.id)
  return getSolutionContribution(user, id)
}

async function synchronizeVerificationRecord(contributionId: string, verification: any) {
  if (!verification.submissionId || verification.status === 'SKIPPED') return verification
  const run = verification.Submission?.CurrentJudgeRun
  if (!run) fail(409, 'SOLUTION_VERIFICATION_EVIDENCE_MISSING', '验证提交缺少 JudgeRun')
  if (run.status === 'QUEUED' || run.status === 'RUNNING') {
    return prisma.solutionVerification.update({ where: { id: verification.id }, data: { status: run.status, startedAt: run.startedAt } })
  }
  const infra = run.status === 'CANCELLED' || ['system_error', 'judge_failed', 'unknown_error', 'remote_unavailable', 'submit_failed'].includes(run.result || '')
  const passed = run.status === 'FINALIZED' && run.result === 'accepted' && (run.score ?? 100) >= 100
  const status = infra ? 'INFRA_ERROR' : passed ? 'PASSED' : 'FAILED'
  const contributionStatus = infra ? 'AUTO_CHECKING' : passed ? 'TECHNICALLY_VALID' : 'NEEDS_REVISION'
  const [, updated] = await prisma.$transaction([
    prisma.solutionContribution.update({ where: { id: contributionId }, data: { status: contributionStatus } }),
    prisma.solutionVerification.update({ where: { id: verification.id }, data: {
      status, compilePassed: ['compile_error', 'compilation_error'].includes(run.result || '') ? false : true,
      officialVerdict: run.result, officialScore: run.score,
      errorMessage: run.errorMessage, startedAt: run.startedAt, completedAt: run.finalizedAt || new Date(),
    } }),
  ])
  return updated
}

export async function syncSolutionVerificationSubmission(submissionId: number) {
  const verification = await prisma.solutionVerification.findUnique({
    where: { submissionId },
    include: {
      ContributionRevision: { select: { contributionId: true } },
      Submission: { include: { CurrentJudgeRun: true } },
    },
  })
  if (!verification) return null
  return synchronizeVerificationRecord(verification.ContributionRevision.contributionId, verification)
}

export async function refreshSolutionVerification(user: JwtPayload, contributionId: string) {
  const contribution = await prisma.solutionContribution.findUnique({
    where: { id: contributionId }, include: { Problem: true, Revisions: { orderBy: { revision: 'desc' }, take: 1, include: { Verification: { include: { Submission: { include: { CurrentJudgeRun: true } } } } } } },
  })
  if (!contribution || (contribution.authorUserId !== user.userId && !canModifyProblem(user, contribution.Problem))) {
    fail(404, 'SOLUTION_CONTRIBUTION_NOT_FOUND', '投稿不存在')
  }
  const verification = contribution.Revisions[0]?.Verification
  if (!verification) fail(409, 'SOLUTION_VERIFICATION_NOT_FOUND', '当前投稿版本没有验证记录')
  return synchronizeVerificationRecord(contribution.id, verification)
}

async function requireReviewer(user: JwtPayload, contributionId: string) {
  const contribution = await prisma.solutionContribution.findUnique({ where: { id: contributionId }, include: { Problem: true } })
  if (!contribution || !canModifyProblem(user, contribution.Problem)) fail(403, 'SOLUTION_REVIEW_FORBIDDEN', '只有题目管理员可以审核该投稿')
  if (contribution.authorUserId === user.userId) fail(403, 'SOLUTION_SELF_REVIEW_FORBIDDEN', '投稿作者不能审核自己的投稿')
  return contribution
}

export async function recordSolutionReview(user: JwtPayload, contributionId: string, body: any) {
  const contribution = await requireReviewer(user, contributionId)
  if (!['TECHNICALLY_VALID', 'UNDER_REVIEW'].includes(contribution.status)) fail(409, 'SOLUTION_REVIEW_STATUS_INVALID', '当前状态不能审核')
  const reviewType = parseEnum(body?.reviewType || 'CONTENT', Object.values(SolutionReviewType), 'reviewType')
  const decision = parseEnum(body?.decision, Object.values(SolutionReviewDecision), 'decision')
  const comment = optionalText(body?.comment, 10_000)
  if (decision !== 'APPROVE' && (!comment || comment.length < 10)) fail(422, 'SOLUTION_REVIEW_COMMENT_REQUIRED', '请求修改或拒绝时至少需要 10 个字符的说明')
  const status = decision === 'APPROVE' ? 'UNDER_REVIEW' : decision === 'REQUEST_CHANGES' ? 'NEEDS_REVISION' : 'REJECTED'
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`solution-review:${contributionId}`}, 0)) IS NULL AS locked`
    const revision = await tx.solutionContributionRevision.findUnique({ where: { contributionId_revision: { contributionId, revision: contribution.currentRevision } } })
    if (!revision) fail(409, 'SOLUTION_REVISION_NOT_FOUND', '当前送审版本不存在')
    const review = await tx.solutionReview.create({ data: {
      id: crypto.randomUUID(), contributionId, contributionRevisionId: revision.id,
      reviewerUserId: user.userId, reviewType, decision,
      checklist: body?.checklist && typeof body.checklist === 'object' ? body.checklist : Prisma.JsonNull,
      comment,
    } })
    const changed = await tx.solutionContribution.updateMany({
      where: { id: contributionId, status: contribution.status, currentRevision: contribution.currentRevision },
      data: { status },
    })
    if (changed.count !== 1) fail(409, 'SOLUTION_REVIEW_CONFLICT', '投稿已被其他审核操作更新，请刷新后重试')
    return review
  })
}

export async function acceptSolutionContribution(user: JwtPayload, contributionId: string) {
  const contribution = await requireReviewer(user, contributionId)
  if (contribution.status !== 'UNDER_REVIEW') fail(409, 'SOLUTION_ACCEPT_STATUS_INVALID', '投稿尚未完成通过审核')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`solution-review:${contributionId}`}, 0)) IS NULL AS locked`
    const revision = await tx.solutionContributionRevision.findUnique({ where: { contributionId_revision: { contributionId, revision: contribution.currentRevision } }, include: { Verification: true } })
    if (!revision || !revision.Verification || !['PASSED', 'SKIPPED'].includes(revision.Verification.status)) fail(409, 'SOLUTION_VERIFICATION_REQUIRED', '技术验证未通过')
    const approval = await tx.solutionReview.findFirst({ where: { contributionRevisionId: revision.id, decision: 'APPROVE' }, orderBy: { createdAt: 'desc' } })
    if (!approval) fail(409, 'SOLUTION_REVIEW_REQUIRED', '缺少当前版本的通过审核记录')
    const acceptedAt = new Date()
    const changed = await tx.solutionContribution.updateMany({
      where: { id: contributionId, status: 'UNDER_REVIEW', currentRevision: contribution.currentRevision },
      data: { status: 'ACCEPTED', acceptedAt },
    })
    if (changed.count !== 1) fail(409, 'SOLUTION_ACCEPT_CONFLICT', '投稿已被其他审核操作更新，请刷新后重试')
    return tx.solutionContribution.findUniqueOrThrow({ where: { id: contributionId } })
  })
}

function rewardFor(type: SolutionType) {
  if (type === 'ALTERNATIVE_SOLUTION') return { score: 30, carits: 40n }
  if (type === 'COMMUNITY_EDITORIAL' || type === 'OFFICIAL_EDITORIAL') return { score: 20, carits: 20n }
  if (type === 'CORRECTION') return { score: 15, carits: 10n }
  if (type === 'TRANSLATION') return { score: 10, carits: 5n }
  return { score: 5, carits: 5n }
}

export async function publishSolutionContribution(user: JwtPayload, contributionId: string, body: any = {}) {
  const contribution = await requireReviewer(user, contributionId)
  if (contribution.status === 'PUBLISHED') {
    return prisma.problemSolutionVersion.findFirstOrThrow({ where: { SourceContributionRevision: { contributionId, revision: contribution.currentRevision } } })
  }
  if (contribution.status !== 'ACCEPTED') fail(409, 'SOLUTION_PUBLISH_STATUS_INVALID', '只有已采纳投稿可以发布')
  const visibility = body?.visibilityPolicy === undefined
    ? SolutionVisibilityPolicy.PUBLIC
    : parseEnum(body.visibilityPolicy, Object.values(SolutionVisibilityPolicy), 'visibilityPolicy')
  if (contribution.type === 'OFFICIAL_EDITORIAL' && !canModifyProblem(user, contribution.Problem)) fail(403, 'SOLUTION_OFFICIAL_FORBIDDEN', '只有题目管理员可以发布官方题解')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`solution-publication:${contributionId}`}, 0)) IS NULL AS locked`
    const current = await tx.solutionContribution.findUniqueOrThrow({ where: { id: contributionId } })
    if (current.baseSolutionId) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`solution-publication-target:${current.baseSolutionId}`}, 0)) IS NULL AS locked`
    }
    const revision = await tx.solutionContributionRevision.findUnique({
      where: { contributionId_revision: { contributionId, revision: current.currentRevision } }, include: { Verification: true },
    })
    if (!revision || !revision.Verification || !['PASSED', 'SKIPPED'].includes(revision.Verification.status)) fail(409, 'SOLUTION_VERIFICATION_REQUIRED', '技术验证未通过')
    const approval = await tx.solutionReview.findFirst({
      where: { contributionRevisionId: revision.id, decision: 'APPROVE' }, orderBy: { createdAt: 'desc' },
    })
    if (!approval) fail(409, 'SOLUTION_REVIEW_REQUIRED', '缺少当前版本的通过审核记录')
    const replay = await tx.problemSolutionVersion.findUnique({ where: { sourceContributionRevisionId: revision.id } })
    if (replay) return replay
    let solution = current.baseSolutionId ? await tx.problemSolution.findUnique({ where: { id: current.baseSolutionId } }) : null
    if (current.baseSolutionId && (!solution || solution.problemId !== current.problemId)) fail(409, 'SOLUTION_BASE_INVALID', '目标题解不存在')
    if (!solution) {
      solution = await tx.problemSolution.create({ data: {
        id: crypto.randomUUID(), problemId: current.problemId, type: current.type,
        authorUserId: current.authorUserId, organizationId: current.organizationId,
        approachKey: revision.approachKey, title: revision.title, visibilityPolicy: visibility,
        primary: current.type === 'OFFICIAL_EDITORIAL' && !await tx.problemSolution.count({ where: { problemId: current.problemId, primary: true, status: 'PUBLISHED' } }),
      } })
    }
    const max = await tx.problemSolutionVersion.aggregate({ where: { solutionId: solution.id }, _max: { version: true } })
    const versionNumber = (max._max.version || 0) + 1
    if (solution.currentVersionId) await tx.problemSolutionVersion.update({ where: { id: solution.currentVersionId }, data: { status: 'SUPERSEDED' } })
    const version = await tx.problemSolutionVersion.create({ data: {
      id: crypto.randomUUID(), solutionId: solution.id, version: versionNumber,
      title: revision.title, contentMarkdown: revision.contentMarkdown,
      algorithmTags: revision.algorithmTags ?? Prisma.JsonNull, approachKey: revision.approachKey,
      complexityTime: revision.complexityTime, complexityMemory: revision.complexityMemory,
      language: revision.language, referenceCode: revision.referenceCode, sourceType: revision.sourceType,
      sourceUrl: revision.sourceUrl, citation: revision.citation,
      licenseDeclarationVersion: revision.licenseDeclarationVersion,
      statementSnapshot: revision.statementSnapshot as Prisma.InputJsonValue,
      statementSnapshotHash: revision.statementSnapshotHash,
      verifiedTestSetRevisionId: revision.targetTestSetRevisionId,
      sourceContributionRevisionId: revision.id, verificationId: revision.Verification.id,
      contentHash: revision.contentHash, publishedByUserId: user.userId,
      visibilityPolicy: visibility,
    } })
    await tx.problemSolution.update({ where: { id: solution.id }, data: {
      currentVersionId: version.id, title: revision.title, approachKey: revision.approachKey,
      status: 'PUBLISHED', visibilityPolicy: visibility,
    } })
    await tx.solutionContribution.update({ where: { id: contributionId }, data: { status: 'PUBLISHED', publishedAt: new Date() } })
    const reward = rewardFor(current.type)
    const event = await tx.contributionEvent.create({ data: {
      id: crypto.randomUUID(), actorUserId: current.authorUserId, type: 'solution_published',
      sourceType: 'problem_solution_version', sourceId: version.id, score: reward.score,
      ruleCode: RULE_CODE, ruleVersion: RULE_VERSION,
      dedupeKey: `solution-contribution-revision:${revision.id}:published`, status: 'accepted',
      occurredAt: version.publishedAt, acceptedAt: version.publishedAt,
      evidence: {
        problemId: current.problemId, solutionId: solution.id, versionId: version.id,
        solutionType: current.type, verificationId: revision.Verification.id,
        verifiedTestSetRevisionId: revision.targetTestSetRevisionId,
        reviewerUserId: approval.reviewerUserId, publishedByUserId: user.userId,
        rewardCarits: reward.carits.toString(), organizationRewardCarits: '0',
      },
    } })
    await tx.contributionRewardDelivery.create({ data: {
      id: crypto.randomUUID(), contributionId: event.id, policyCode: RULE_CODE,
      policyVersion: RULE_VERSION, userCarits: reward.carits,
    } })
    if (current.organizationId) await tx.organizationContributionAttribution.create({ data: {
      id: crypto.randomUUID(), contributionId: event.id, organizationId: current.organizationId,
      reason: 'solution_contributor_selected_at_submission', evidence: { versionId: version.id },
    } })
    return version
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function getSolutionContribution(user: JwtPayload, id: string) {
  const item = await prisma.solutionContribution.findUnique({
    where: { id }, include: {
      Problem: true, Revisions: { orderBy: { revision: 'desc' }, include: { Verification: true } },
      Reviews: { orderBy: { createdAt: 'asc' }, include: { Reviewer: { select: { id: true, username: true } } } },
    },
  })
  if (!item || (item.authorUserId !== user.userId && !canModifyProblem(user, item.Problem))) fail(404, 'SOLUTION_CONTRIBUTION_NOT_FOUND', '投稿不存在')
  return item
}

export async function listMySolutionContributions(user: JwtPayload, problemId?: string) {
  return prisma.solutionContribution.findMany({
    where: { authorUserId: user.userId, ...(problemId ? { problemId } : {}) },
    orderBy: { updatedAt: 'desc' }, include: { Revisions: { orderBy: { revision: 'desc' }, take: 1, include: { Verification: true } } },
  })
}

export async function listSolutionReviewQueue(user: JwtPayload, status?: string) {
  // Express the same ownership policy as canModifyProblem in SQL. Loading the
  // complete problem catalogue merely to filter it in memory makes the review
  // queue grow with the whole platform and can expose a trivial DoS surface.
  const managedProblems: Prisma.ProblemWhereInput = ['platform_admin', 'super_admin'].includes(user.role)
    ? { libraryScope: 'platform' }
    : user.organizationId && user.role === 'school_principal'
      ? { libraryScope: 'school', organizationId: user.organizationId }
      : user.organizationId && user.role === 'teacher'
        ? { libraryScope: 'school', organizationId: user.organizationId, ownerId: user.userId }
        : { id: '__no_managed_problem__' }
  return prisma.solutionContribution.findMany({
    where: {
      Problem: managedProblems, authorUserId: { not: user.userId },
      status: status && Object.values(SolutionContributionStatus).includes(status as SolutionContributionStatus)
        ? status as SolutionContributionStatus : { in: ['TECHNICALLY_VALID', 'UNDER_REVIEW', 'ACCEPTED'] },
    },
    orderBy: { submittedAt: 'asc' }, include: {
      Author: { select: { id: true, username: true } }, Problem: { select: { id: true, problemId: true, title: true } },
      Revisions: { orderBy: { revision: 'desc' }, take: 1, include: { Verification: true } },
    },
  })
}

async function canReadSolution(user: JwtPayload, solution: { visibilityPolicy: SolutionVisibilityPolicy; problemId: string }, manager: boolean) {
  if (manager || solution.visibilityPolicy === 'PUBLIC') return true
  if (solution.visibilityPolicy === 'MANAGER_ONLY') return false
  return Boolean(await prisma.submission.findFirst({ where: {
    userId: user.userId, problemInternalId: solution.problemId,
    OR: [
      { CurrentJudgeRun: { is: { status: 'FINALIZED', result: 'accepted', score: { gte: 100 } } } },
      { CurrentJudgeRun: { is: null }, result: 'accepted', score: { gte: 100 } },
    ],
  }, select: { id: true } }))
}

function publishedVersionDto(version: any) {
  return {
    id: version.id, version: version.version, title: version.title,
    contentMarkdown: version.contentMarkdown, algorithmTags: version.algorithmTags,
    approachKey: version.approachKey, complexityTime: version.complexityTime,
    complexityMemory: version.complexityMemory, language: version.language,
    referenceCode: version.referenceCode, sourceType: version.sourceType,
    sourceUrl: version.sourceUrl, citation: version.citation,
    verifiedTestSetRevisionId: version.verifiedTestSetRevisionId,
    status: version.status, visibilityPolicy: version.visibilityPolicy,
    publishedAt: version.publishedAt,
  }
}

function publishedSolutionDto(solution: any, currentVersion: any, versions?: any[]) {
  return {
    id: solution.id, problemId: solution.problemId, type: solution.type,
    title: solution.title, approachKey: solution.approachKey, status: solution.status,
    visibilityPolicy: currentVersion.visibilityPolicy,
    primary: solution.primary, recommended: solution.recommended,
    createdAt: solution.createdAt,
    Author: solution.Author ? { username: solution.Author.username } : null,
    Problem: solution.Problem ? {
      id: solution.Problem.id, platform: solution.Problem.platform,
      problemId: solution.Problem.problemId, title: solution.Problem.title,
      sourceProblemId: solution.Problem.sourceProblemId,
    } : undefined,
    CurrentVersion: publishedVersionDto(currentVersion),
    ...(versions ? { Versions: versions.map(publishedVersionDto) } : {}),
  }
}

export async function listProblemSolutions(user: JwtPayload, problemId: string) {
  const problem = await requireProblem(user, problemId)
  const manager = canModifyProblem(user, problem)
  const rows = await prisma.problemSolution.findMany({
    where: { problemId, status: 'PUBLISHED', currentVersionId: { not: null } },
    orderBy: [{ primary: 'desc' }, { recommended: 'desc' }, { createdAt: 'asc' }],
    include: { CurrentVersion: true, Author: { select: { id: true, username: true } } },
  })
  const allowed = await Promise.all(rows.map(async row => await canReadSolution(user, { problemId: row.problemId, visibilityPolicy: row.CurrentVersion!.visibilityPolicy }, manager) ? row : null))
  return allowed.filter((row): row is NonNullable<typeof row> => Boolean(row)).map(row => publishedSolutionDto(row, row.CurrentVersion))
}

export async function getProblemSolution(user: JwtPayload, solutionId: string, versionId?: string) {
  const solution = await prisma.problemSolution.findUnique({ where: { id: solutionId }, include: { Problem: true, CurrentVersion: true, Versions: { orderBy: { version: 'desc' } }, Author: { select: { id: true, username: true } } } })
  if (!solution || !canViewProblem(user, solution.Problem)) fail(404, 'SOLUTION_NOT_FOUND', '题解不存在')
  const manager = canModifyProblem(user, solution.Problem)
  if (!versionId) {
    if (!solution.CurrentVersion || !await canReadSolution(user, { problemId: solution.problemId, visibilityPolicy: solution.CurrentVersion.visibilityPolicy }, manager)) fail(404, 'SOLUTION_NOT_FOUND', '题解不存在')
    const visibleVersions = (await Promise.all(solution.Versions.map(async version => await canReadSolution(user, { problemId: solution.problemId, visibilityPolicy: version.visibilityPolicy }, manager) ? version : null))).filter(Boolean)
    return publishedSolutionDto(solution, solution.CurrentVersion, visibleVersions)
  }
  const version = solution.Versions.find(item => item.id === versionId)
  if (!version || !await canReadSolution(user, { problemId: solution.problemId, visibilityPolicy: version.visibilityPolicy }, manager)) fail(404, 'SOLUTION_VERSION_NOT_FOUND', '题解版本不存在')
  return publishedSolutionDto(solution, version)
}

export async function createCorrectionContribution(user: JwtPayload, solutionId: string, body: any) {
  const solution = await prisma.problemSolution.findUnique({
    where: { id: solutionId },
    include: { Problem: true, CurrentVersion: true },
  })
  if (!solution || !solution.currentVersionId || !solution.CurrentVersion || !canViewProblem(user, solution.Problem)) fail(404, 'SOLUTION_NOT_FOUND', '题解不存在')
  const base = solution.CurrentVersion
  return createSolutionContribution(user, solution.problemId, {
    title: base.title,
    contentMarkdown: base.contentMarkdown,
    algorithmTags: base.algorithmTags,
    approachKey: base.approachKey,
    complexityTime: base.complexityTime,
    complexityMemory: base.complexityMemory,
    sourceType: base.sourceType,
    sourceUrl: base.sourceUrl,
    citation: base.citation,
    testSetRevisionId: base.verifiedTestSetRevisionId,
    ...body, type: 'CORRECTION', baseSolutionId: solution.id,
    baseVersionId: body?.baseVersionId || solution.currentVersionId,
    // A correction of a verified executable solution may replace its code,
    // but cannot silently turn the next published version into an unverified
    // prose-only asset by clearing these inherited fields.
    language: typeof body?.language === 'string' && body.language.trim() ? body.language : base.language,
    referenceCode: typeof body?.referenceCode === 'string' && body.referenceCode.trim() ? body.referenceCode : base.referenceCode,
  })
}
