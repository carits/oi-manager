import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../../prisma'
import { fileService } from '../../lib/storage'
import { problemLibraryKey } from './problem.access'

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

function fileIdFromUrl(url?: string | null): string | null {
  if (!url) return null
  return url.match(/^\/api\/files\/([^/]+)\/(?:public|download)$/)?.[1] || null
}

async function findManagedFile(url: string | null) {
  if (!url) return null
  const fileId = fileIdFromUrl(url)
  if (fileId) return fileService.getFile(fileId)
  const uploaded = url.match(/^\/uploads\/(.+)\/([^/]+)$/)
  if (!uploaded) return null
  return prisma.file.findFirst({
    where: {
      relativePath: decodeURIComponent(uploaded[1]),
      fileName: decodeURIComponent(uploaded[2]),
      status: 'active',
    },
  })
}

async function cloneManagedFile(
  url: string | null,
  ownerId: string,
  fallbackCategory: 'pdf' | 'attachment' | 'image',
  cache: Map<string, { fileId: string; url: string; result: any }>,
) {
  if (!url) return null
  const cached = cache.get(url)
  if (cached) return cached
  const sourceFile = await findManagedFile(url)
  if (!sourceFile || sourceFile.category === 'testdata') return null
  const category = ['pdf', 'attachment', 'image'].includes(sourceFile.category)
    ? sourceFile.category as 'pdf' | 'attachment' | 'image'
    : fallbackCategory
  const fileId = sourceFile.id
  const source = await fileService.download(fileId)
  const cloned = await fileService.upload(source.buffer, {
    category,
    ownerType: 'problem',
    ownerId,
    originalName: source.originalName,
    mimeType: source.mimeType,
    isPublic: false,
  })
  const result = { fileId: cloned.id, url: `/api/files/${cloned.id}/download`, result: cloned }
  cache.set(url, result)
  return result
}

async function cloneContentAssets(
  content: string | null,
  ownerId: string,
  cache: Map<string, { fileId: string; url: string; result: any }>,
) {
  if (!content) return content
  const urls = new Set<string>()
  const pattern = /\/api\/files\/[^\s)'"<>]+\/(?:public|download)|\/uploads\/[^\s)'"<>]+/g
  for (const match of content.matchAll(pattern)) urls.add(match[0])
  let rewritten = content
  for (const url of urls) {
    const cloned = await cloneManagedFile(url, ownerId, 'image', cache)
    if (cloned) rewritten = rewritten.split(url).join(cloned.url)
  }
  return rewritten
}

export async function copyPlatformProblemToSchool(sourceId: string, userId: string, schoolId: string) {
  const source = await prisma.problem.findUnique({
    where: { id: sourceId },
    include: {
      ProblemStatement: true,
      ProblemAttachment: true,
      TestdataFile: true,
    },
  })
  if (!source || source.libraryScope !== 'platform' || source.status !== 'published') return null

  const libraryKey = problemLibraryKey('school', schoolId)
  const existing = await prisma.problem.findUnique({
    where: { libraryKey_platform_problemId: { libraryKey, platform: source.platform, problemId: source.problemId } },
  })
  if (existing) return { existing, created: null, skippedFiles: [] as string[] }

  const targetId = crypto.randomUUID()
  const target = await prisma.problem.create({
    data: {
      id: targetId,
      platform: source.platform,
      problemId: source.problemId,
      title: source.title,
      description: source.description,
      statementType: source.statementType,
      solutionType: source.solutionType,
      solutionMarkdown: source.solutionMarkdown,
      solutionVisible: false,
      difficulty: source.difficulty,
      timeLimit: source.timeLimit,
      memoryLimit: source.memoryLimit,
      judgeConfig: source.judgeConfig,
      problemType: source.problemType,
      visibility: 'private',
      ownerType: 'teacher',
      ownerId: userId,
      libraryScope: 'school',
      libraryKey,
      schoolId,
      sourceProblemId: source.id,
      status: 'draft',
      allowedLanguages: source.allowedLanguages,
      ojBindings: source.ojBindings,
    },
  })

  const skippedFiles: string[] = []
  const clonedFiles = new Map<string, { fileId: string; url: string; result: any }>()
  try {
    for (const statement of source.ProblemStatement) {
      const clonedFile = statement.fileUrl
        ? await cloneManagedFile(statement.fileUrl, targetId, 'pdf', clonedFiles)
        : null
      if (statement.fileUrl && !clonedFile) skippedFiles.push(statement.fileUrl)
      await prisma.problemStatement.create({
        data: {
          id: crypto.randomUUID(),
          problemId: targetId,
          type: statement.type,
          format: statement.format,
          language: statement.language,
          content: await cloneContentAssets(statement.content, targetId, clonedFiles),
          fileUrl: clonedFile?.url || null,
          isVisible: statement.isVisible,
        },
      })
    }

    for (const attachment of source.ProblemAttachment) {
      const clonedFile = await cloneManagedFile(attachment.fileUrl, targetId, 'attachment', clonedFiles)
      if (!clonedFile) {
        skippedFiles.push(attachment.fileUrl)
        continue
      }
      await prisma.problemAttachment.create({
        data: {
          id: crypto.randomUUID(),
          problemId: targetId,
          fileName: attachment.fileName,
          fileSize: clonedFile.result.fileSize,
          fileUrl: clonedFile.url,
          description: attachment.description,
        },
      })
    }

    const statementPdf = source.statementPdfUrl
      ? await cloneManagedFile(source.statementPdfUrl, targetId, 'pdf', clonedFiles)
      : null
    const solutionPdf = source.solutionPdfUrl
      ? await cloneManagedFile(source.solutionPdfUrl, targetId, 'pdf', clonedFiles)
      : null
    if (source.statementPdfUrl && !statementPdf) skippedFiles.push(source.statementPdfUrl)
    if (source.solutionPdfUrl && !solutionPdf) skippedFiles.push(source.solutionPdfUrl)
    await prisma.problem.update({
      where: { id: targetId },
      data: {
        description: await cloneContentAssets(source.description, targetId, clonedFiles),
        solutionMarkdown: await cloneContentAssets(source.solutionMarkdown, targetId, clonedFiles),
        statementPdfUrl: statementPdf?.url || null,
        solutionPdfUrl: solutionPdf?.url || null,
      },
    })

    if (source.TestdataFile.length > 0) {
      const sourceDir = path.join(TESTDATA_ROOT, source.id)
      const targetDir = path.join(TESTDATA_ROOT, targetId)
      fs.mkdirSync(targetDir, { recursive: true })
      for (const file of source.TestdataFile) {
        const sourcePath = path.join(sourceDir, file.filename)
        if (!fs.existsSync(sourcePath)) {
          skippedFiles.push(`testdata:${file.filename}`)
          continue
        }
        fs.copyFileSync(sourcePath, path.join(targetDir, file.filename))
        await prisma.testdataFile.create({
          data: {
            id: crypto.randomUUID(),
            problemId: targetId,
            filename: file.filename,
            size: file.size,
            md5: file.md5,
          },
        })
      }
    }

    return {
      existing: null,
      created: await prisma.problem.findUnique({ where: { id: targetId } }),
      skippedFiles,
    }
  } catch (error) {
    await prisma.problem.update({ where: { id: targetId }, data: { status: 'archived' } }).catch(() => {})
    throw error
  }
}
