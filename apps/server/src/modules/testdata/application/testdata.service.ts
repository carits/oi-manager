import crypto from 'crypto'
import { canModifyProblem, canViewProblem } from '../../problem/problem.access'
import { prisma } from '../../../prisma'
import {
  autoDetectTestdataPairs,
  copyTestdataBackup,
  moveTestdataToBackup,
  naturalSortTestdata,
  promoteStagedTestdata,
  removeTestdataFile,
  restoreTestdataBackup,
  testdataFileExists,
  unmatchedTestdataFiles,
  type StagedTestdataFile,
} from '../testdata-storage'

type AuthUser = NonNullable<Express.Request['user']>

export class TestdataApplicationError extends Error {
  constructor(
    public readonly statusCode: number,
    message = 'Testdata operation failed',
    public readonly code?: string,
    public readonly data?: unknown,
  ) { super(message) }
}

function fail(statusCode: number, message = 'Testdata operation failed', code?: string, data?: unknown): never {
  throw new TestdataApplicationError(statusCode, message, code, data)
}

async function lockProblem(tx: any, problemId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${problemId}, 0)) IS NULL AS locked`
}

export async function authorizeTestdata(user: AuthUser, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canViewProblem(user, problem)) fail(404)
  if (!canModifyProblem(user, problem)) fail(403)
  return problem
}

export async function listTestdata(problemId: string) {
  const files = await prisma.testdataFile.findMany({ where: { problemId }, orderBy: { filename: 'asc' } })
  return {
    files: naturalSortTestdata(files).map(file => ({
      id: file.id, filename: file.filename, size: file.size, md5: file.md5,
      sha256: file.sha256, uploadedAt: file.uploadedAt,
    })),
    pairs: autoDetectTestdataPairs(files.map(file => file.filename)),
  }
}

export async function uploadTestdata(
  problemId: string,
  staged: StagedTestdataFile[],
  replace: boolean,
  stagingDir: string,
) {
  if (!staged.length) fail(400)
  const rollback: Array<{ promotedFilename: string; originalFilename: string; backup: string | null }> = []
  try {
    return await prisma.$transaction(async tx => {
      await lockProblem(tx, problemId)
      const existing = await tx.testdataFile.findMany({ where: { problemId } })
      const byName = new Map(existing.map(file => [file.filename.toLowerCase(), file]))
      const conflicts = staged.filter(file => byName.has(file.filename.toLowerCase())).map(file => file.filename)
      if (conflicts.length && !replace) {
        fail(409, 'Testdata filename conflict', 'TESTDATA_CONFLICT', {
          conflicts,
          files: staged.map(file => ({ filename: file.filename, size: file.size, sha256: file.sha256 })),
          pairs: autoDetectTestdataPairs(staged.map(file => file.filename)),
        })
      }
      const uploaded = []
      for (const file of staged) {
        const current = byName.get(file.filename.toLowerCase())
        const backup = current ? copyTestdataBackup(problemId, current.filename, stagingDir) : null
        rollback.push({
          promotedFilename: file.filename,
          originalFilename: current?.filename || file.filename,
          backup,
        })
        promoteStagedTestdata(problemId, file)
        if (current) {
          await tx.testdataFile.update({
            where: { id: current.id },
            data: { filename: file.filename, size: file.size, md5: null, sha256: file.sha256, uploadedAt: new Date() },
          })
          await Promise.all([
            tx.problemTestcase.updateMany({ where: { inputFileId: current.id }, data: { inputSha256: file.sha256 } }),
            tx.problemTestcase.updateMany({ where: { outputFileId: current.id }, data: { outputSha256: file.sha256 } }),
          ])
          uploaded.push({
            id: current.id, filename: file.filename, size: file.size, sha256: file.sha256, status: 'updated',
          })
        } else {
          const record = await tx.testdataFile.create({
            data: {
              id: crypto.randomUUID(), problemId, filename: file.filename,
              size: file.size, md5: null, sha256: file.sha256,
            },
          })
          uploaded.push({
            id: record.id, filename: file.filename, size: file.size, sha256: file.sha256, status: 'created',
          })
        }
      }
      return uploaded
    })
  } catch (error) {
    for (const item of rollback.reverse()) {
      removeTestdataFile(problemId, item.promotedFilename)
      if (item.backup) restoreTestdataBackup(problemId, item.originalFilename, item.backup)
    }
    throw error
  }
}

export async function deleteTestdata(problemId: string, fileId: string, stagingDir: string) {
  const rollback: { moved?: { filename: string; backup: string | null } } = {}
  try {
    return await prisma.$transaction(async tx => {
      await lockProblem(tx, problemId)
      const file = await tx.testdataFile.findUnique({ where: { id: fileId } })
      if (!file || file.problemId !== problemId) fail(404)
      const references = await tx.problemTestcase.findMany({
        where: { problemId, OR: [{ inputFileId: file.id }, { outputFileId: file.id }] },
        include: { GroupLinks: { include: { Group: { include: { Subtask: true } } } } },
      })
      const used = references.filter(reference => reference.GroupLinks.length > 0)
      if (used.length) {
        const locations = new Map(used.flatMap(reference => reference.GroupLinks.map(link => {
          const location = {
            testcaseId: reference.id, subtaskId: link.Group.Subtask.subtaskId,
            groupId: link.Group.id, groupName: link.Group.name, groupKind: link.Group.kind,
          }
          return [`${location.testcaseId}\0${location.groupId}`, location] as const
        })))
        fail(409, `${file.filename} 已被 Test Graph 引用，请先从对应 Official Group 移除测试点`, 'TESTDATA_IN_USE', {
          testcaseIds: used.map(reference => reference.id), references: [...locations.values()],
        })
      }
      rollback.moved = { filename: file.filename, backup: moveTestdataToBackup(problemId, file.filename, stagingDir) }
      if (references.length) {
        await tx.problemTestcase.deleteMany({ where: { id: { in: references.map(reference => reference.id) } } })
      }
      await tx.testdataFile.delete({ where: { id: file.id } })
      return { filename: file.filename }
    })
  } catch (error) {
    if (rollback.moved) restoreTestdataBackup(problemId, rollback.moved.filename, rollback.moved.backup)
    throw error
  }
}

export async function detectTestdataPairs(problemId: string) {
  const files = await prisma.testdataFile.findMany({ where: { problemId }, orderBy: { filename: 'asc' } })
  const filenames = files.map(file => file.filename)
  const pairs = autoDetectTestdataPairs(filenames)
  return { pairs, unmatched: unmatchedTestdataFiles(filenames, pairs) }
}

export async function getTestdataExport(problemId: string) {
  const files = naturalSortTestdata(await prisma.testdataFile.findMany({
    where: { problemId }, orderBy: { filename: 'asc' },
  }))
  return { files, pairs: autoDetectTestdataPairs(files.map(file => file.filename)) }
}

export async function resolveTestdataDownload(problemId: string, selector: { fileId?: string; filename?: string }) {
  const file = selector.fileId
    ? await prisma.testdataFile.findUnique({ where: { id: selector.fileId } })
    : await prisma.testdataFile.findUnique({
        where: { problemId_filename: { problemId, filename: selector.filename! } },
      })
  if (!file || file.problemId !== problemId || !testdataFileExists(problemId, file.filename)) fail(404)
  return file
}
