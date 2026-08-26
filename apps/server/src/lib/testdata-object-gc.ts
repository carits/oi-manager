import fs from 'fs'
import path from 'path'
import { prisma } from '../prisma'
import { acquireProblemMutationLock } from '../modules/problem/problem.testset-revision.service'

const TESTDATA_ROOT = path.resolve(process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata'))

const unreferenced = {
  AcmInputs: { none: {} },
  AcmOutputs: { none: {} },
  GroupInputs: { none: {} },
  GroupOutputs: { none: {} },
}

export async function collectOrphanTestdataObjects(options: { olderThanMs?: number; limit?: number } = {}) {
  const olderThanMs = options.olderThanMs ?? 24 * 60 * 60 * 1000
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2_000)
  const candidates = await prisma.testdataObject.findMany({
    where: { createdAt: { lt: new Date(Date.now() - olderThanMs) }, ...unreferenced },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  let deleted = 0
  let fileErrors = 0
  for (const candidate of candidates) {
    const removed = await prisma.$transaction(async tx => {
      await acquireProblemMutationLock(tx, candidate.problemId)
      const current = await tx.testdataObject.findFirst({ where: { id: candidate.id, ...unreferenced } })
      if (!current) return false
      await tx.testdataObject.delete({ where: { id: current.id } })
      return true
    })
    if (!removed) continue
    deleted++
    const problemRoot = path.resolve(TESTDATA_ROOT, candidate.problemId)
    const target = path.resolve(problemRoot, candidate.storageKey)
    if (target === problemRoot || !target.startsWith(`${problemRoot}${path.sep}`)) {
      fileErrors++
      continue
    }
    await fs.promises.rm(target, { force: true }).catch(() => { fileErrors++ })
  }
  return { scanned: candidates.length, deleted, fileErrors }
}
