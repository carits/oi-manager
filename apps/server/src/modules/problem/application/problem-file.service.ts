import crypto from 'crypto'
import fs from 'fs/promises'
import { fileService } from '../../../lib/storage'
import logger from '../../../lib/logger'
import { prisma } from '../../../prisma'
import { canModifyProblem, canViewProblem } from '../problem.access'

type AuthUser = NonNullable<Express.Request['user']>
type StatementKind = 'statement' | 'solution'

export class ProblemFileApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
  }
}

function fail(statusCode: number, message: string): never {
  throw new ProblemFileApplicationError(statusCode, message)
}

async function discardUpload(file: Express.Multer.File | undefined) {
  if (file?.path) await fs.rm(file.path, { force: true }).catch(() => undefined)
}

function managedFileId(url: string | null | undefined) {
  return url?.match(/\/api\/files\/([^/]+)\/download/)?.[1] || null
}

async function retireManagedFile(url: string | null | undefined) {
  const fileId = managedFileId(url)
  if (!fileId) return
  try {
    await fileService.softDelete(fileId)
  } catch (error) {
    logger.warn('problem_file_retire_failed', { fileId, error: error instanceof Error ? error.message : String(error) })
  }
}

async function modifiableProblem(user: AuthUser, id: string, file?: Express.Multer.File) {
  const problem = await prisma.problem.findUnique({ where: { id } })
  if (!problem || !canViewProblem(user, problem)) {
    await discardUpload(file)
    fail(404, '题目不存在')
  }
  if (!canModifyProblem(user, problem)) {
    await discardUpload(file)
    fail(403, '没有权限')
  }
  return problem
}

async function storePdf(id: string, file: Express.Multer.File) {
  return fileService.uploadFromMulter(file, { category: 'pdf', ownerType: 'problem', ownerId: id, isPublic: false })
}

export async function uploadLegacyProblemPdf(
  user: AuthUser,
  id: string,
  file: Express.Multer.File | undefined,
  kind: StatementKind,
) {
  if (!file) fail(400, '请上传 PDF 文件')
  const problem = await modifiableProblem(user, id, file)
  const result = await storePdf(id, file)
  const fileUrl = `/api/files/${result.id}/download`
  try {
    await prisma.problem.update({
      where: { id },
      data: kind === 'statement'
        ? { statementPdfUrl: fileUrl, statementType: 'pdf' }
        : { solutionPdfUrl: fileUrl, solutionType: 'pdf' },
    })
  } catch (error) {
    await fileService.softDelete(result.id).catch(() => undefined)
    throw error
  }
  await retireManagedFile(kind === 'statement' ? problem.statementPdfUrl : problem.solutionPdfUrl)
  logger.audit(`${kind}_pdf_uploaded`, {
    userId: user.userId,
    action: `upload_${kind}_pdf`,
    target: id,
    metadata: { fileId: result.id, originalName: result.originalName },
  })
  return { pdfUrl: fileUrl, fileId: result.id }
}

export async function listProblemAttachments(user: AuthUser, id: string) {
  const problem = await prisma.problem.findUnique({ where: { id } })
  if (!problem || !canViewProblem(user, problem)) fail(404, '题目不存在')
  return prisma.problemAttachment.findMany({ where: { problemId: id }, orderBy: { uploadedAt: 'desc' } })
}

export async function uploadProblemAttachment(
  user: AuthUser,
  id: string,
  file: Express.Multer.File | undefined,
  description: unknown,
) {
  if (!file) fail(400, '请上传文件')
  await modifiableProblem(user, id, file)
  const result = await fileService.uploadFromMulter(file, {
    category: 'attachment', ownerType: 'problem', ownerId: id, isPublic: false,
  })
  const fileUrl = `/api/files/${result.id}/download`
  try {
    const attachment = await prisma.problemAttachment.create({
      data: {
        id: crypto.randomUUID(), problemId: id, fileName: result.originalName,
        fileSize: result.fileSize, fileUrl,
        description: typeof description === 'string' && description ? description : null,
      },
    })
    logger.audit('attachment_uploaded', {
      userId: user.userId, action: 'upload_attachment', target: id,
      metadata: { fileId: result.id, attachmentId: attachment.id, originalName: result.originalName },
    })
    return { ...attachment, fileId: result.id }
  } catch (error) {
    await fileService.softDelete(result.id).catch(() => undefined)
    throw error
  }
}

export async function deleteProblemAttachment(user: AuthUser, id: string, attachmentId: string) {
  await modifiableProblem(user, id)
  const attachment = await prisma.problemAttachment.findFirst({ where: { id: attachmentId, problemId: id } })
  if (!attachment) fail(404, '附件不存在')
  await prisma.problemAttachment.delete({ where: { id: attachmentId } })
  await retireManagedFile(attachment.fileUrl)
}

export async function uploadProblemStatementPdf(
  user: AuthUser,
  id: string,
  file: Express.Multer.File | undefined,
  type: unknown,
) {
  if (type !== 'statement' && type !== 'solution') {
    await discardUpload(file)
    fail(400, 'type 必须是 statement 或 solution')
  }
  if (!file) fail(400, '请上传 PDF 文件')
  await modifiableProblem(user, id, file)
  const existing = await prisma.problemStatement.findFirst({ where: { problemId: id, type, format: 'pdf' } })
  const result = await storePdf(id, file)
  const fileUrl = `/api/files/${result.id}/download`
  try {
    const statement = await prisma.$transaction(async tx => {
      const saved = existing
        ? await tx.problemStatement.update({ where: { id: existing.id }, data: { fileUrl } })
        : await tx.problemStatement.create({
            data: { id: crypto.randomUUID(), problemId: id, type, format: 'pdf', language: null, fileUrl, isVisible: true },
          })
      await tx.problem.update({
        where: { id },
        data: type === 'statement'
          ? { statementPdfUrl: fileUrl, statementType: 'pdf' }
          : { solutionPdfUrl: fileUrl, solutionType: 'pdf' },
      })
      return saved
    })
    await retireManagedFile(existing?.fileUrl)
    logger.audit('statement_pdf_uploaded', {
      userId: user.userId, action: 'upload_statement_pdf', target: id,
      metadata: { type, fileId: result.id, originalName: result.originalName },
    })
    return { id: statement.id, fileUrl, fileId: result.id }
  } catch (error) {
    await fileService.softDelete(result.id).catch(() => undefined)
    throw error
  }
}

export async function updateProblemStatementVisibility(
  user: AuthUser,
  id: string,
  statementId: string,
  isVisible: unknown,
) {
  await modifiableProblem(user, id)
  if (typeof isVisible !== 'boolean') fail(400, 'isVisible 必须是布尔值')
  const statement = await prisma.problemStatement.findFirst({ where: { id: statementId, problemId: id } })
  if (!statement) fail(404, '记录不存在')
  const updated = await prisma.problemStatement.update({ where: { id: statementId }, data: { isVisible } })
  logger.audit('statement_visibility_updated', {
    userId: user.userId, action: 'update_statement_visibility', target: id, metadata: { statementId, isVisible },
  })
  return updated
}

export async function deleteProblemStatement(user: AuthUser, id: string, statementId: string) {
  await modifiableProblem(user, id)
  const statement = await prisma.problemStatement.findFirst({ where: { id: statementId, problemId: id } })
  if (!statement) fail(404, '记录不存在')
  await prisma.problemStatement.delete({ where: { id: statementId } })
  await retireManagedFile(statement.fileUrl)
  logger.audit('statement_deleted', {
    userId: user.userId, action: 'delete_statement', target: id,
    metadata: { statementId, type: statement.type, format: statement.format },
  })
}
