import crypto from 'crypto'
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

async function prepareSnapshot(trainingProblemId: string, option: ContentOption) {
  const snapshotId = crypto.randomUUID()
  let snapshotFileId: string | null = null
  let snapshotFileName: string | null = option.fileName
  if (option.format === 'pdf') {
    if (!option.fileId) throw new Error('所选 PDF 文件不存在')
    const source = await fileService.download(option.fileId)
    const copied = await fileService.upload(source.buffer, {
      category: 'pdf', ownerType: 'training_content', ownerId: snapshotId,
      originalName: source.originalName, mimeType: source.mimeType, isPublic: false,
    })
    snapshotFileId = copied.id
    snapshotFileName = copied.originalName
  }
  return { snapshotId, snapshotFileId, snapshotFileName, option, trainingProblemId }
}

export async function selectTrainingProblemContent(input: {
  trainingProblemId: string
  problemId: string
  selectedBy: string
  organizationId: string | null
  statementOptionKey: string
  solutionOptionKey: string
}) {
  const options = await listContentOptions(input.problemId, input.selectedBy, input.organizationId)
  const statement = options.statement.find(option => option.key === input.statementOptionKey)
  const solution = options.solution.find(option => option.key === input.solutionOptionKey)
  if (!statement || !solution) throw new Error('所选题面或题解不可用')
  if (statement.kind !== 'statement' || solution.kind !== 'solution') throw new Error('内容类型不匹配')

  const prepared = await Promise.all([
    prepareSnapshot(input.trainingProblemId, statement),
    prepareSnapshot(input.trainingProblemId, solution),
  ])
  return prisma.$transaction(async tx => {
    const created = []
    for (const item of prepared) {
      const latest = await tx.trainingProblemContentSnapshot.aggregate({
        where: { trainingProblemId: input.trainingProblemId, kind: item.option.kind },
        _max: { revision: true },
      })
      created.push(await tx.trainingProblemContentSnapshot.create({
        data: {
          id: item.snapshotId,
          trainingProblemId: input.trainingProblemId,
          kind: item.option.kind,
          revision: (latest._max.revision || 0) + 1,
          sourceType: item.option.sourceType,
          sourceContentId: item.option.sourceId,
          sourceRevision: item.option.sourceRevision,
          format: item.option.format,
          language: item.option.language,
          title: item.option.title,
          content: item.option.content,
          snapshotFileId: item.snapshotFileId,
          fileName: item.snapshotFileName,
          authorUserId: item.option.authorUserId,
          authorUsernameSnapshot: item.option.authorUsername,
          selectedBy: input.selectedBy,
        },
      }))
    }
    return created
  })
}

export async function createInitialContentSnapshots(input: {
  trainingProblemId: string
  problemId: string
  selectedBy: string
  organizationId: string | null
  statementOptionKey?: string
  solutionOptionKey?: string
}) {
  const [existing, statementSetCount] = await Promise.all([
    prisma.trainingProblemContentSnapshot.count({ where: { trainingProblemId: input.trainingProblemId } }),
    prisma.trainingProblemStatementSet.count({ where: { trainingProblemId: input.trainingProblemId } }),
  ])
  if (existing > 0 && statementSetCount > 0) return
  const options = await listContentOptions(input.problemId, input.selectedBy, input.organizationId)
  const statement = input.statementOptionKey && options.statement.some(option => option.key === input.statementOptionKey)
    ? input.statementOptionKey : options.statement[0].key
  const solution = input.solutionOptionKey && options.solution.some(option => option.key === input.solutionOptionKey)
    ? input.solutionOptionKey : (options.solution.find(option => option.key !== 'none')?.key || 'none')
  if (existing === 0) await selectTrainingProblemContent({ ...input, statementOptionKey: statement, solutionOptionKey: solution })
  if (statementSetCount === 0) {
    const selected = options.statement.find(option => option.key === statement)!
    const prepared = await prepareSnapshot(input.trainingProblemId, selected)
    await prisma.trainingProblemStatementSet.create({ data: {
      id: crypto.randomUUID(), trainingProblemId: input.trainingProblemId, revision: 1, selectedBy: input.selectedBy,
      Snapshot: { create: {
        id: crypto.randomUUID(), sourceType: selected.sourceType, sourceContentId: selected.sourceId,
        name: selected.title || selected.fileName || '官方题面', title: selected.title,
        language: selected.language, format: selected.format, content: selected.content,
        snapshotFileId: prepared.snapshotFileId, fileName: prepared.snapshotFileName,
        authorUserId: selected.authorUserId, authorUsernameSnapshot: selected.authorUsername,
        isDefault: true, orderIndex: 0,
      } },
    } })
  }
}

export async function latestContentSnapshot(trainingProblemId: string, kind: ContentKind) {
  return prisma.trainingProblemContentSnapshot.findFirst({
    where: { trainingProblemId, kind },
    orderBy: [{ revision: 'desc' }, { selectedAt: 'desc' }],
  })
}
