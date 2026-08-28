import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { canModifyProblem, canViewProblem } from '../../problem/problem.access'
import type { FileCategory, OwnerType } from '../../../config/storage'

const UPLOAD_CATEGORIES = new Set<FileCategory>(['pdf', 'attachment', 'avatar', 'image', 'testdata'])
const OWNER_TYPES = new Set<OwnerType>(['problem', 'contest', 'user', 'team'])

export class FileRouteError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'FileRouteError'
  }
}

export function parseCategory(value: unknown): FileCategory {
  if (typeof value !== 'string' || !UPLOAD_CATEGORIES.has(value as FileCategory)) {
    throw new FileRouteError(400, 'INVALID_FILE_CATEGORY', '文件类别或业务归属类型无效')
  }
  return value as FileCategory
}

export function parseOwnerType(value: unknown): OwnerType {
  if (typeof value !== 'string' || !OWNER_TYPES.has(value as OwnerType)) {
    throw new FileRouteError(400, 'INVALID_OWNER_TYPE', '文件类别或业务归属类型无效')
  }
  return value as OwnerType
}

async function hasTeamPermission(user: JwtPayload, teamId: string, requireManager: boolean) {
  const expectedScope = user.organizationId ? 'campus' : 'personal'
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { scope: true, organizationId: true },
  })
  if (!team || team.scope !== expectedScope) return false
  if (expectedScope === 'campus' && team.organizationId !== user.organizationId) return false
  if (expectedScope === 'personal' && team.organizationId) return false
  const member = await prisma.teamMember.findFirst({
    where: {
      teamId,
      userId: user.userId,
      status: 'active',
      ...(requireManager ? { role: { in: ['owner', 'admin'] } } : {}),
    },
    select: { id: true },
  })
  return Boolean(member)
}

async function hasOwnerPermission(user: JwtPayload, ownerType: OwnerType, ownerId: string, action: 'view' | 'modify') {
  switch (ownerType) {
    case 'problem': {
      const problem = await prisma.problem.findUnique({ where: { id: ownerId } })
      return Boolean(problem && (action === 'view' ? canViewProblem(user, problem) : canModifyProblem(user, problem)))
    }
    case 'contest': {
      const contest = await prisma.contest.findUnique({ where: { id: ownerId }, select: { teamId: true } })
      return Boolean(contest?.teamId && await hasTeamPermission(user, contest.teamId, action === 'modify'))
    }
    case 'team':
      return hasTeamPermission(user, ownerId, action === 'modify')
    case 'user':
      return ownerId === user.userId
    default:
      return false
  }
}

export async function uploadOwnedFile(user: JwtPayload, file: Express.Multer.File, input: Record<string, unknown>) {
  if (!input.category || !input.ownerType || !input.ownerId) {
    throw new FileRouteError(400, 'FILE_FIELDS_REQUIRED', '缺少必要参数: category, ownerType, ownerId')
  }
  const category = parseCategory(input.category)
  const ownerType = parseOwnerType(input.ownerType)
  const ownerId = String(input.ownerId)
  if (!await hasOwnerPermission(user, ownerType, ownerId, 'modify')) {
    throw new FileRouteError(403, 'FILE_UPLOAD_FORBIDDEN', '无权上传文件到该业务对象')
  }
  const result = await fileService.uploadFromMulter(file, {
    category,
    ownerType,
    ownerId,
    isPublic: ownerType === 'problem' ? false : input.isPublic === 'true' || input.isPublic === true,
  })
  return { result, category, ownerType, ownerId }
}

export async function downloadAuthorizedFile(user: JwtPayload, fileId: string) {
  if (!await fileService.checkAccess(user, fileId)) {
    throw new FileRouteError(404, 'FILE_NOT_FOUND', '文件不存在')
  }
  return fileService.download(fileId)
}

export async function downloadPublicFile(fileId: string) {
  const file = await fileService.getFile(fileId)
  if (!file?.isPublic) throw new FileRouteError(404, 'FILE_NOT_FOUND', '文件不存在')
  if (file.status !== 'active') throw new FileRouteError(410, 'FILE_UNAVAILABLE', '文件已不可用')
  return fileService.download(fileId)
}

export async function getAuthorizedFile(user: JwtPayload, fileId: string) {
  const file = await fileService.getFile(fileId)
  if (!file || !await fileService.checkAccess(user, fileId)) {
    throw new FileRouteError(404, 'FILE_NOT_FOUND', '文件不存在')
  }
  return {
    id: file.id,
    originalName: file.originalName,
    fileSize: file.fileSize,
    mimeType: file.mimeType,
    category: file.category,
    isPublic: file.isPublic,
    createdAt: file.createdAt,
    url: fileService.getFileUrl(file),
  }
}

export async function deleteAuthorizedFile(user: JwtPayload, fileId: string) {
  const file = await fileService.getFile(fileId)
  if (!file) throw new FileRouteError(404, 'FILE_NOT_FOUND', '文件不存在')
  const ownerType = parseOwnerType(file.ownerType)
  if (!await hasOwnerPermission(user, ownerType, file.ownerId, 'modify')) {
    throw new FileRouteError(403, 'FILE_DELETE_FORBIDDEN', '无权删除该文件')
  }
  await fileService.softDelete(fileId)
  return file
}

export async function listOwnerFiles(user: JwtPayload, ownerTypeValue: string, ownerId: string, categoryValue?: unknown) {
  const ownerType = parseOwnerType(ownerTypeValue)
  const category = categoryValue === undefined ? undefined : parseCategory(categoryValue)
  if (!await hasOwnerPermission(user, ownerType, ownerId, 'view')) {
    throw new FileRouteError(403, 'FILE_LIST_FORBIDDEN', '无权查看该业务对象的文件')
  }
  const files = await fileService.getFilesByOwner(ownerType, ownerId, category)
  return files.map(file => ({ ...file, url: fileService.getFileUrl(file) }))
}
