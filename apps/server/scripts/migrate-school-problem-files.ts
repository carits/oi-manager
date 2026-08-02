import fs from 'fs'
import path from 'path'
import { prisma } from '../src/prisma'
import { STORAGE_DIRS, STORAGE_ROOT } from '../src/config/storage'

const dryRun = process.argv.includes('--dry-run')

function privateDirectory(category: string) {
  if (category === 'image') return STORAGE_DIRS.private.problemImages
  if (category === 'pdf') return STORAGE_DIRS.private.problemPdfs
  return STORAGE_DIRS.private.problemAttachments
}

function replaceAll(value: string | null, replacements: Map<string, string>) {
  if (!value) return value
  let result = value
  for (const [from, to] of replacements) result = result.split(from).join(to)
  return result
}

function assertInsideStorage(filePath: string) {
  const root = path.resolve(STORAGE_ROOT)
  const resolved = path.resolve(filePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to access a path outside STORAGE_ROOT: ${resolved}`)
  }
}

async function migrateProblem(problemId: string) {
  const [problem, files, statements, attachments] = await Promise.all([
    prisma.problem.findUniqueOrThrow({ where: { id: problemId } }),
    prisma.file.findMany({ where: { ownerType: 'problem', ownerId: problemId } }),
    prisma.problemStatement.findMany({ where: { problemId } }),
    prisma.problemAttachment.findMany({ where: { problemId } }),
  ])
  const replacements = new Map<string, string>()
  let moved = 0

  for (const file of files) {
    if (file.category === 'testdata') continue
    const targetRelativePath = privateDirectory(file.category)
    const targetUrl = `/api/files/${file.id}/download`
    replacements.set(`/uploads/${file.relativePath}/${file.fileName}`, targetUrl)
    replacements.set(`/api/files/${file.id}/public`, targetUrl)
    replacements.set(`/api/files/${file.id}/download`, targetUrl)

    if (file.relativePath !== targetRelativePath) {
      const source = path.resolve(STORAGE_ROOT, file.relativePath, file.fileName)
      const target = path.resolve(STORAGE_ROOT, targetRelativePath, file.fileName)
      assertInsideStorage(source)
      assertInsideStorage(target)
      if (!dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        if (fs.existsSync(source)) {
          if (fs.existsSync(target)) throw new Error(`Target file already exists: ${target}`)
          fs.renameSync(source, target)
        } else if (!fs.existsSync(target)) {
          throw new Error(`Source file is missing: ${source}`)
        }
      }
      moved += 1
    }
  }

  if (dryRun) return { files: files.length, moved }

  await prisma.$transaction(async tx => {
    for (const file of files) {
      if (file.category === 'testdata') continue
      await tx.file.update({
        where: { id: file.id },
        data: {
          relativePath: privateDirectory(file.category),
          accessLevel: 'private',
          isPublic: false,
        },
      })
    }
    await tx.problem.update({
      where: { id: problemId },
      data: {
        description: replaceAll(problem.description, replacements),
        solutionMarkdown: replaceAll(problem.solutionMarkdown, replacements),
        statementPdfUrl: replaceAll(problem.statementPdfUrl, replacements),
        solutionPdfUrl: replaceAll(problem.solutionPdfUrl, replacements),
      },
    })
    for (const statement of statements) {
      await tx.problemStatement.update({
        where: { id: statement.id },
        data: {
          content: replaceAll(statement.content, replacements),
          fileUrl: replaceAll(statement.fileUrl, replacements),
        },
      })
    }
    for (const attachment of attachments) {
      await tx.problemAttachment.update({
        where: { id: attachment.id },
        data: { fileUrl: replaceAll(attachment.fileUrl, replacements) || attachment.fileUrl },
      })
    }
  })
  return { files: files.length, moved }
}

async function main() {
  const problems = await prisma.problem.findMany({
    where: { libraryScope: 'school' },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  let fileCount = 0
  let moveCount = 0
  for (const problem of problems) {
    const result = await migrateProblem(problem.id)
    fileCount += result.files
    moveCount += result.moved
  }
  console.log(JSON.stringify({ dryRun, problems: problems.length, files: fileCount, filesToMove: moveCount }))
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
