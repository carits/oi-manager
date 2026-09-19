import crypto from 'node:crypto'
import { BlogVisibility } from '@prisma/client'
import { prisma } from '../../../prisma'
import { SubmissionQueryError } from './submission-query.service'

const ALLOWED_VISIBILITY = new Set<BlogVisibility>([BlogVisibility.PRIVATE, BlogVisibility.PLATFORM, BlogVisibility.PUBLIC])

export async function createSubmissionBlogSnapshot(userId: string, submissionId: number, body: any) {
  const visibility = String(body?.visibility || 'PRIVATE').toUpperCase() as BlogVisibility
  if (!ALLOWED_VISIBILITY.has(visibility)) {
    throw new SubmissionQueryError(422, 'SUBMISSION_SNAPSHOT_VISIBILITY_INVALID', '提交快照只支持仅自己、平台用户或互联网公开')
  }
  const includeCode = body?.includeCode === true
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      CurrentJudgeRun: { select: { status: true, result: true, score: true, timeUsed: true, memoryUsed: true } },
    },
  })
  if (!submission || submission.userId !== userId) {
    throw new SubmissionQueryError(404, 'SUBMISSION_NOT_FOUND', '提交记录不存在')
  }
  const result = submission.CurrentJudgeRun?.result
  const finalized = submission.CurrentJudgeRun?.status === 'FINALIZED'
  if (!finalized || !result) throw new SubmissionQueryError(409, 'SUBMISSION_NOT_FINALIZED', '评测完成后才能创建博客引用快照')
  const problem = submission.problemInternalId ? await prisma.problem.findUnique({
    where: { id: submission.problemInternalId },
    select: { title: true, platform: true, problemId: true, libraryScope: true, status: true, visibility: true },
  }) : null
  if (visibility !== BlogVisibility.PRIVATE) {
    const publiclyReferenceable = submission.submitScope === 'problem'
      && submission.isGlobalVisible
      && problem?.libraryScope === 'platform'
      && problem.status === 'published'
      && problem.visibility === 'public'
    if (!publiclyReferenceable) {
      throw new SubmissionQueryError(422, 'SUBMISSION_SNAPSHOT_VISIBILITY_CONFLICT', '活动提交或非公开题提交只能创建仅自己可见的快照')
    }
  }
  const snapshot = {
    sourcePlatform: problem?.platform || submission.oj,
    sourceProblemId: problem?.problemId || submission.problemId,
    problemTitle: problem?.title || null,
    result,
    score: submission.CurrentJudgeRun?.score ?? null,
    timeUsed: submission.CurrentJudgeRun?.timeUsed ?? null,
    memoryUsed: submission.CurrentJudgeRun?.memoryUsed ?? null,
    language: submission.language,
    inputFilename: submission.inputFilename,
    outputFilename: submission.outputFilename,
    code: includeCode ? submission.code : null,
    submittedAt: submission.createdAt,
  }
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  return prisma.blogSubmissionSnapshot.create({
    data: { id: crypto.randomUUID(), submissionId, ownerUserId: userId, visibility, includeCode, ...snapshot, contentHash },
    select: {
      id: true, submissionId: true, visibility: true, includeCode: true,
      sourcePlatform: true, sourceProblemId: true, problemTitle: true,
      result: true, score: true, timeUsed: true, memoryUsed: true,
      language: true, inputFilename: true, outputFilename: true,
      submittedAt: true, contentHash: true, createdAt: true,
    },
  })
}
