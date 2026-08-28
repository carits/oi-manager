import { v4 as uuidv4 } from 'uuid'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { getResourceScope } from '../../../middleware/auth'
import { paginatedResponse } from '../../../lib/pagination'
import { findAccessibleProblem } from '../problem.access'
import { getOwnerInfo } from '../problem.helpers'
import {
  inspectLegacyTestGraph,
  loadTestGraphWorkspace,
  migrateLegacyTestGraph,
  registerOfficialTestcases,
  replaceTestGraph,
} from '../problem.test-graph.service'
import { ensureInitialTestSetRevision, loadRevisionSpec } from '../problem.testset-revision.service'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'

export async function listOwnProblemSubmissions(
  user: JwtPayload,
  problemId: string,
  pagination: { page: number; pageSize: number; skip: number },
) {
  const problem = await findAccessibleProblem(user, problemId, 'view')
  if (!problem) return null
  const where = {
    oj: problem.platform,
    problemId: problem.problemId,
    userId: user.userId,
    workspaceScope: getResourceScope(user),
    organizationId: user.organizationId || null,
    submitScope: 'problem',
  }
  const [total, submissions] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      include: {
        User: { select: { username: true } },
        CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.pageSize,
    }),
  ])
  const formatted = submissions.map(rawSubmission => {
    const submission = projectSubmissionJudgeResult(rawSubmission)
    return ({
    id: submission.id,
    username: submission.User.username,
    oj: submission.oj,
    problemId: submission.problemId,
    result: submission.result,
    submitMethod: submission.submitMethod,
    timeUsed: submission.timeUsed,
    memoryUsed: submission.memoryUsed,
    codeLength: submission.codeLength,
    language: submission.language,
    submittedAt: submission.createdAt.toISOString(),
    })
  })
  return { problem, where, submissions: formatted, pagination: paginatedResponse(formatted, total, pagination.page, pagination.pageSize) }
}

async function noteIdentity(user: JwtPayload, problemId: string) {
  const problem = await findAccessibleProblem(user, problemId, 'view')
  if (!problem) return { error: 'not_found' as const }
  const owner = await getOwnerInfo(user.userId, user.role)
  if (!owner) return { error: 'owner_missing' as const }
  return { ownerId: owner.ownerId, userType: user.role === 'student' ? 'student' : 'teacher' }
}

export async function getProblemNote(user: JwtPayload, problemId: string) {
  const identity = await noteIdentity(user, problemId)
  if ('error' in identity) return identity
  const note = await prisma.problemNote.findUnique({
    where: { problemId_userId_userType: { problemId, userId: identity.ownerId, userType: identity.userType } },
  })
  return { note: note || {
    id: '', problemId, userId: identity.ownerId, userType: identity.userType,
    content: '', createdAt: new Date(), updatedAt: new Date(),
  } }
}

export async function saveProblemNote(user: JwtPayload, problemId: string, content: unknown) {
  const identity = await noteIdentity(user, problemId)
  if ('error' in identity) return identity
  const note = await prisma.problemNote.upsert({
    where: { problemId_userId_userType: { problemId, userId: identity.ownerId, userType: identity.userType } },
    update: { content: typeof content === 'string' ? content : '' },
    create: {
      id: uuidv4(), problemId, userId: identity.ownerId, userType: identity.userType,
      content: typeof content === 'string' ? content : '',
    },
  })
  return { note }
}

export function findManageableProblem(user: JwtPayload, problemId: string) {
  return findAccessibleProblem(user, problemId, 'edit')
}

export async function getProblemTestSetRevision(problemId: string, revisionId: string) {
  const revision = await prisma.problemTestSetRevision.findFirst({ where: { id: revisionId, problemId } })
  return revision ? { ...revision, spec: await loadRevisionSpec(revision.id) } : null
}

export async function getTestGraphWorkspace(problemId: string) {
  const [graph, inspection] = await Promise.all([loadTestGraphWorkspace(problemId), inspectLegacyTestGraph(problemId)])
  return { ...graph, migrationIssues: inspection.issues, canMigrate: inspection.ok && !inspection.alreadyMigrated }
}

export async function migrateProblemTestGraph(problemId: string, userId: string) {
  const inspection = await inspectLegacyTestGraph(problemId)
  if (!inspection.ok) return { ok: false as const, code: 'TEST_GRAPH_MIGRATION_BLOCKED', issues: inspection.issues }
  if (!inspection.alreadyMigrated) {
    const migrated = await migrateLegacyTestGraph(problemId)
    if (!migrated.ok) return { ok: false as const, code: 'TEST_GRAPH_MIGRATION_BLOCKED', issues: migrated.issues }
  }
  await ensureInitialTestSetRevision(problemId, userId)
  const current = await prisma.problem.findUnique({ where: { id: problemId }, select: { testGraphRevision: true } })
  if (current?.testGraphRevision) {
    await prisma.trainingProblem.updateMany({
      where: { problemId, testGraphRevisionSnapshot: null },
      data: { testGraphRevisionSnapshot: current.testGraphRevision },
    })
  }
  return { ok: true as const, alreadyMigrated: inspection.alreadyMigrated, workspace: await loadTestGraphWorkspace(problemId) }
}

export async function registerProblemTestcases(problemId: string, pairs: unknown) {
  const result = await registerOfficialTestcases(problemId, Array.isArray(pairs) ? pairs : [])
  return result.ok ? { ...result, workspace: await loadTestGraphWorkspace(problemId) } : result
}

export function saveProblemTestGraph(problemId: string, body: any, userId: string) {
  return replaceTestGraph(problemId, { ...body, updatedBy: userId })
}
