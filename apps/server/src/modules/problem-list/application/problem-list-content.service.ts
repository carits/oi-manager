import { fileService } from '../../../lib/storage'
import { prisma } from '../../../prisma'
import {
  collectManagedProblemFileIds,
  extractManagedProblemFileId,
  getProblemListPermission,
  problemListFileUrl,
  rewriteProblemListFileUrls,
} from './problem-list-access.service'
import { ProblemListApplicationError } from './problem-list-crud.service'

type AuthUser = NonNullable<Express.Request['user']>

function hidden(): never {
  throw new ProblemListApplicationError(404, '资源不存在')
}

async function requireAccessibleEntry(user: AuthUser, listId: string, entryId: string) {
  if (!await getProblemListPermission(listId, user)) hidden()
  const entry = await prisma.problemListEntry.findFirst({
    where: { id: entryId, ProblemListSection: { problemListId: listId } },
    include: {
      ProblemListSection: { select: { ProblemList: { select: { scope: true, organizationId: true } } } },
      Problem: {
        include: {
          ProblemStatement: {
            where: { type: 'statement', isVisible: true },
            orderBy: [{ format: 'asc' as const }, { language: 'asc' as const }],
          },
          ProblemAttachment: { orderBy: { uploadedAt: 'asc' as const } },
        },
      },
    },
  })
  if (!entry || entry.Problem.status !== 'published') hidden()
  const list = entry.ProblemListSection.ProblemList
  if (entry.Problem.libraryScope === 'school' &&
      (list.scope !== 'campus' || !list.organizationId || list.organizationId !== entry.Problem.organizationId)) hidden()
  return entry
}

export async function getProblemListEntryStatement(user: AuthUser, listId: string, entryId: string) {
  const entry = await requireAccessibleEntry(user, listId, entryId)
  const problem = entry.Problem
  return {
    id: entry.id,
    title: entry.alias || problem.title,
    difficulty: problem.difficulty,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
    description: rewriteProblemListFileUrls(listId, entry.id, problem.description),
    statementType: problem.statementType,
    statementPdfUrl: problemListFileUrl(listId, entry.id, problem.statementPdfUrl),
    statements: problem.ProblemStatement.map(statement => ({
      id: statement.id,
      format: statement.format,
      language: statement.language,
      content: rewriteProblemListFileUrls(listId, entry.id, statement.content),
      fileUrl: problemListFileUrl(listId, entry.id, statement.fileUrl),
    })),
    attachments: problem.ProblemAttachment.map(attachment => ({
      id: attachment.id,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      description: attachment.description,
      fileUrl: problemListFileUrl(listId, entry.id, attachment.fileUrl),
    })),
  }
}

export async function downloadProblemListEntryFile(
  user: AuthUser,
  listId: string,
  entryId: string,
  fileId: string,
) {
  const entry = await requireAccessibleEntry(user, listId, entryId)
  const file = await fileService.getFile(fileId)
  if (!file || file.status !== 'active' || file.ownerType !== 'problem' ||
      file.ownerId !== entry.Problem.id || file.category === 'testdata') hidden()

  const allowedIds = new Set<string>()
  const allowUrl = (url: string | null | undefined) => {
    const id = extractManagedProblemFileId(url)
    if (id) allowedIds.add(id)
  }
  const allowContent = (content: string | null | undefined) => {
    for (const id of collectManagedProblemFileIds(content)) allowedIds.add(id)
  }
  allowContent(entry.Problem.description)
  allowUrl(entry.Problem.statementPdfUrl)
  for (const statement of entry.Problem.ProblemStatement) {
    allowContent(statement.content)
    allowUrl(statement.fileUrl)
  }
  for (const attachment of entry.Problem.ProblemAttachment) allowUrl(attachment.fileUrl)
  if (!allowedIds.has(fileId)) hidden()

  const download = await fileService.download(file.id)
  return {
    ...download,
    disposition: file.category === 'attachment' ? 'attachment' : 'inline',
  }
}
