import crypto from 'crypto'
import { prisma } from '../../../prisma'
import { checkProblemListOptimisticLock, getProblemListPermission, getSectionProblemListId } from './problem-list-access.service'
import { ProblemListApplicationError } from './problem-list-crud.service'

type AuthUser = NonNullable<Express.Request['user']>

function fail(statusCode: number, message: string, code?: string): never {
  throw new ProblemListApplicationError(statusCode, message, code)
}

async function requireEditable(user: AuthUser, listId: string, message: string) {
  const permission = await getProblemListPermission(listId, user)
  if (permission !== 'admin' && permission !== 'edit') fail(403, message)
}

export async function addProblemListSection(user: AuthUser, listId: string, body: any) {
  await requireEditable(user, listId, '无权限添加章节')
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) fail(400, '章节标题不能为空')
  const maxSection = await prisma.problemListSection.findFirst({
    where: { problemListId: listId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
  })
  return prisma.problemListSection.create({
    data: { id: crypto.randomUUID(), problemListId: listId, title, sortOrder: (maxSection?.sortOrder ?? -1) + 1 },
  })
}

export async function updateProblemListSection(user: AuthUser, sectionId: string, body: any) {
  const listId = await getSectionProblemListId(sectionId)
  if (!listId) fail(404, '章节不存在')
  await requireEditable(user, listId, '无权限编辑')
  if (body.expectedUpdatedAt) {
    const currentList = await prisma.problemList.findUnique({ where: { id: listId }, select: { updatedAt: true } })
    if (!currentList || !checkProblemListOptimisticLock(body.expectedUpdatedAt, currentList.updatedAt)) {
      fail(409, '题单已被其他人修改，请刷新后重试', 'CONFLICT')
    }
  }
  const data: any = {}
  if (body.title !== undefined) data.title = String(body.title).trim()
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder
  return prisma.problemListSection.update({ where: { id: sectionId }, data })
}

export async function deleteProblemListSection(user: AuthUser, sectionId: string) {
  const listId = await getSectionProblemListId(sectionId)
  if (!listId) fail(404, '章节不存在')
  await requireEditable(user, listId, '无权限删除')
  const count = await prisma.problemListSection.count({ where: { problemListId: listId } })
  if (count <= 1) fail(400, '至少保留一个章节')
  await prisma.problemListSection.delete({ where: { id: sectionId } })
}

export async function reorderProblemListSections(user: AuthUser, listId: string, sectionIds: unknown) {
  await requireEditable(user, listId, '无权限排序')
  if (!Array.isArray(sectionIds) || sectionIds.some(id => typeof id !== 'string')) fail(400, '参数错误')
  const uniqueIds = [...new Set(sectionIds)]
  if (uniqueIds.length !== sectionIds.length) fail(400, '参数错误')
  const owned = await prisma.problemListSection.findMany({
    where: { problemListId: listId, id: { in: uniqueIds } }, select: { id: true },
  })
  if (owned.length !== uniqueIds.length) fail(400, '章节不属于该题单')
  await prisma.$transaction(uniqueIds.map((id, index) =>
    prisma.problemListSection.update({ where: { id }, data: { sortOrder: index } })))
}
