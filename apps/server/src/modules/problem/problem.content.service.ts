import { prisma } from '../../prisma'
import { fileService } from '../../lib/storage'

export type ContentKind = 'statement' | 'solution'
export type ContentSource = 'canonical' | 'user' | 'training' | 'none'

export interface ContentOption {
  key: string
  kind: ContentKind
  sourceType: ContentSource
  sourceId: string | null
  sourceRevision: number | null
  title: string | null
  format: string
  language: string | null
  content: string | null
  fileId: string | null
  fileName: string | null
  authorUserId: string | null
  authorUsername: string | null
  shareKeys: string[]
}

const managedFileId = (url: string | null | undefined) =>
  url?.match(/\/api\/files\/([^/?#]+)\/(?:download|public)/)?.[1] || null

async function fileName(fileId: string | null) {
  if (!fileId) return null
  return (await prisma.file.findUnique({ where: { id: fileId }, select: { originalName: true } }))?.originalName || null
}

export async function activityOrganizationId(training: {
  organizationId: string | null
  Team?: { organizationId: string | null } | null
}) {
  return training.organizationId || training.Team?.organizationId || null
}

export async function listContentOptions(
  problemId: string,
  managerUserId: string,
  organizationId: string | null,
): Promise<{ statement: ContentOption[]; solution: ContentOption[] }> {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: {
      ProblemStatement: { orderBy: { createdAt: 'asc' } },
      UserProblemContent: {
        where: {
          deletedAt: null,
          OR: [
            { userId: managerUserId },
            { visibility: 'public' },
          ],
        },
        include: { User: { select: { username: true } } },
        orderBy: { updatedAt: 'desc' },
      },
    },
  })
  if (!problem) throw new Error('题目不存在')

  const canonical = async (kind: ContentKind) => {
    const records = problem.ProblemStatement
      .filter(item => item.type === kind && (kind === 'solution' || item.isVisible))
      .sort((a, b) => {
        const rank = (item: typeof a) => item.format === 'markdown' && item.language === 'zh' ? 0 : item.format === 'markdown' ? 1 : item.format === 'pdf' ? 2 : 3
        return rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime()
      })
    const result: ContentOption[] = []
    for (const item of records) {
      const id = managedFileId(item.fileUrl)
      result.push({
        key: `canonical:${item.id}`,
        kind,
        sourceType: 'canonical',
        sourceId: item.id,
        sourceRevision: null,
        title: kind === 'statement' ? problem.title : null,
        format: item.format,
        language: item.language,
        content: item.content,
        fileId: id,
        fileName: await fileName(id),
        authorUserId: null,
        authorUsername: null,
        shareKeys: [],
      })
    }
    return result
  }

  const statements = await canonical('statement')
  const solutions = await canonical('solution')

  if (problem.description && !statements.some(option => option.content === problem.description)) {
    statements.push({
      key: 'canonical:description', kind: 'statement', sourceType: 'canonical', sourceId: null,
      sourceRevision: null, title: problem.title, format: 'markdown', language: 'zh', content: problem.description,
      fileId: null, fileName: null, authorUserId: null, authorUsername: null, shareKeys: [],
    })
  }
  if (problem.statementPdfUrl && !statements.some(option => option.fileId === managedFileId(problem.statementPdfUrl))) {
    const id = managedFileId(problem.statementPdfUrl)
    if (id) statements.push({
      key: 'canonical:statement-pdf', kind: 'statement', sourceType: 'canonical', sourceId: null,
      sourceRevision: null, title: problem.title, format: 'pdf', language: null, content: null,
      fileId: id, fileName: await fileName(id), authorUserId: null, authorUsername: null, shareKeys: [],
    })
  }
  if (problem.solutionMarkdown && !solutions.some(option => option.content === problem.solutionMarkdown)) {
    solutions.push({
      key: 'canonical:solution-markdown', kind: 'solution', sourceType: 'canonical', sourceId: null,
      sourceRevision: null, title: null, format: 'markdown', language: 'zh', content: problem.solutionMarkdown,
      fileId: null, fileName: null, authorUserId: null, authorUsername: null, shareKeys: [],
    })
  }
  if (problem.solutionPdfUrl && !solutions.some(option => option.fileId === managedFileId(problem.solutionPdfUrl))) {
    const id = managedFileId(problem.solutionPdfUrl)
    if (id) solutions.push({
      key: 'canonical:solution-pdf', kind: 'solution', sourceType: 'canonical', sourceId: null,
      sourceRevision: null, title: null, format: 'pdf', language: null, content: null,
      fileId: id, fileName: await fileName(id), authorUserId: null, authorUsername: null, shareKeys: [],
    })
  }

  for (const item of problem.UserProblemContent) {
    const option: ContentOption = {
      key: `user:${item.id}`,
      kind: item.kind as ContentKind,
      sourceType: 'user',
      sourceId: item.id,
      sourceRevision: item.revision,
      title: item.kind === 'statement' ? (item.name || item.title) : item.title,
      format: item.format,
      language: item.language,
      content: item.content,
      fileId: item.fileId,
      fileName: await fileName(item.fileId),
      authorUserId: item.userId,
      authorUsername: item.User.username,
      shareKeys: item.visibility === 'public' ? ['platform'] : [],
    }
    if (item.kind === 'statement') statements.push(option)
    else if (item.kind === 'solution') solutions.push(option)
  }

  solutions.push({
    key: 'none', kind: 'solution', sourceType: 'none', sourceId: null, sourceRevision: null,
    title: null, format: 'none', language: null, content: null, fileId: null, fileName: null,
    authorUserId: null, authorUsername: null, shareKeys: [],
  })
  if (statements.length === 0) statements.push({
    key: 'none', kind: 'statement', sourceType: 'none', sourceId: null, sourceRevision: null,
    title: problem.title, format: 'none', language: null, content: null, fileId: null, fileName: null,
    authorUserId: null, authorUsername: null, shareKeys: [],
  })
  return { statement: statements, solution: solutions }
}

export function publicOption(option: ContentOption) {
  return {
    key: option.key,
    kind: option.kind,
    sourceType: option.sourceType,
    title: option.title,
    format: option.format,
    language: option.language,
    authorUsername: option.authorUsername,
    shareKeys: option.shareKeys,
    fileName: option.fileName,
    previewText: option.content?.slice(0, 240) || null,
  }
}

