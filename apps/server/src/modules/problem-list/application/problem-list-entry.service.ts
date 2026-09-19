import crypto from 'crypto'
import { prisma } from '../../../prisma'
import { findAccessibleProblem, findUsableProblemByExternalId } from '../../problem/problem.access'
import {
  checkProblemListOptimisticLock,
  getEntryProblemListId,
  getProblemListPermission,
  getSectionProblemListId,
} from './problem-list-access.service'
import { ProblemListApplicationError } from './problem-list-crud.service'

type AuthUser = NonNullable<Express.Request['user']>

function fail(statusCode: number, message: string, code?: string, data?: unknown): never {
  throw new ProblemListApplicationError(statusCode, message, code, data)
}

async function requireEditable(user: AuthUser, listId: string, message: string) {
  const permission = await getProblemListPermission(listId, user)
  if (permission !== 'admin' && permission !== 'edit') fail(403, message)
}

async function resolveProblem(user: AuthUser, ojName: string, problemCode: string, directProblemId?: string) {
  if (directProblemId) {
    const problem = await findAccessibleProblem(user, directProblemId, 'use')
    if (!problem) fail(404, '题目不存在')
    return { id: problem.id, title: problem.title }
  }
  const problem = await findUsableProblemByExternalId(user, ojName, problemCode)
  if (!problem) {
    fail(404, ojName === 'carits' ? '题库中未找到该题目，或无权访问' : '题库中未找到该题目')
  }
  return { id: problem.id, title: problem.title }
}

async function ensureProblemFitsList(problemId: string, listId: string) {
  const [problem, list] = await Promise.all([
    prisma.problem.findUnique({ where: { id: problemId }, select: { libraryScope: true, organizationId: true } }),
    prisma.problemList.findUnique({ where: { id: listId }, select: { scope: true, organizationId: true } }),
  ])
  if (!problem || !list || (problem.libraryScope === 'school'
    && (list.scope !== 'campus' || list.organizationId !== problem.organizationId))) fail(404, '题目不存在')
}

export async function addProblemListEntry(user: AuthUser, sectionId: string, body: any) {
  const listId = await getSectionProblemListId(sectionId)
  if (!listId) fail(404, '章节不存在')
  await requireEditable(user, listId, '无权限添加题目')
  const ojName = typeof body.ojName === 'string' ? body.ojName : ''
  const problemCode = typeof body.problemCode === 'string' ? body.problemCode : ''
  if (!ojName || !problemCode) fail(400, 'OJ 平台和题号不能为空')
  const problem = await resolveProblem(user, ojName, problemCode, typeof body.problemId === 'string' ? body.problemId : undefined)
  await ensureProblemFitsList(problem.id, listId)
  const existing = await prisma.problemListEntry.findUnique({
    where: { sectionId_problemId: { sectionId, problemId: problem.id } },
  })
  if (existing) {
    fail(409, '该题目已在此章节中', undefined, {
      entryId: existing.id, problemId: problem.id, title: problem.title, found: true,
    })
  }
  const maximum = await prisma.problemListEntry.findFirst({
    where: { sectionId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
  })
  const entry = await prisma.problemListEntry.create({
    data: {
      id: crypto.randomUUID(), sectionId, problemId: problem.id,
      alias: typeof body.alias === 'string' ? body.alias.trim() || null : null,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      ojName, sortOrder: (maximum?.sortOrder ?? -1) + 1,
    },
    include: {
      Problem: { select: { id: true, platform: true, problemId: true, title: true, difficulty: true, ojBindings: true } },
    },
  })
  return { entry, found: true, created: false }
}

export async function updateProblemListEntry(user: AuthUser, entryId: string, body: any) {
  const listId = await getEntryProblemListId(entryId)
  if (!listId) fail(404, '条目不存在')
  await requireEditable(user, listId, '无权限编辑')
  if (body.expectedUpdatedAt) {
    const list = await prisma.problemList.findUnique({ where: { id: listId }, select: { updatedAt: true } })
    if (!list || !checkProblemListOptimisticLock(body.expectedUpdatedAt, list.updatedAt)) {
      fail(409, '题单已被其他人修改，请刷新后重试', 'CONFLICT')
    }
  }
  const data: any = {}
  if (body.alias !== undefined) data.alias = typeof body.alias === 'string' ? body.alias.trim() || null : null
  if (body.notes !== undefined) data.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder
  return prisma.problemListEntry.update({
    where: { id: entryId }, data,
    include: { Problem: { select: { id: true, platform: true, problemId: true, title: true, difficulty: true, ojBindings: true } } },
  })
}

export async function deleteProblemListEntry(user: AuthUser, entryId: string) {
  const listId = await getEntryProblemListId(entryId)
  if (!listId) fail(404, '条目不存在')
  await requireEditable(user, listId, '无权限删除')
  await prisma.problemListEntry.delete({ where: { id: entryId } })
}

export async function reorderProblemListEntries(user: AuthUser, sectionId: string, entryIds: unknown) {
  const listId = await getSectionProblemListId(sectionId)
  if (!listId) fail(404, '章节不存在')
  await requireEditable(user, listId, '无权限排序')
  if (!Array.isArray(entryIds) || entryIds.some(id => typeof id !== 'string')) fail(400, '参数错误')
  const uniqueIds = [...new Set(entryIds)]
  if (uniqueIds.length !== entryIds.length) fail(400, '参数错误')
  const owned = await prisma.problemListEntry.findMany({ where: { sectionId, id: { in: uniqueIds } }, select: { id: true } })
  if (owned.length !== uniqueIds.length) fail(400, '条目不属于该章节')
  await prisma.$transaction(uniqueIds.map((id, index) =>
    prisma.problemListEntry.update({ where: { id }, data: { sortOrder: index } })))
}
