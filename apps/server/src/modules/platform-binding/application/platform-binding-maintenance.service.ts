import { prisma } from '../../../prisma'

export async function getCodeforcesArchiveCredentials(userId: string) {
  const binding = await prisma.userPlatformBinding.findUnique({
    where: { userId_platform: { userId, platform: 'codeforces' } },
    select: { bindingStatus: true, bindingData: true },
  })
  if (!binding || binding.bindingStatus !== 'bound' || !binding.bindingData) return null
  try {
    const parsed = JSON.parse(binding.bindingData)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      handle: typeof parsed.handle === 'string' ? parsed.handle : null,
      jsessionid: typeof parsed.jsessionid === 'string' ? parsed.jsessionid : null,
    }
  } catch {
    return null
  }
}

export async function deduplicateRemoteSubmissions() {
  const duplicates = await prisma.$queryRaw<{ ojRemoteId: string; count: bigint }[]>`
    SELECT "ojRemoteId", COUNT(*) as count
    FROM "Submission"
    WHERE "ojRemoteId" IS NOT NULL
    GROUP BY "ojRemoteId"
    HAVING COUNT(*) > 1
  `
  let deleted = 0
  for (const duplicate of duplicates) {
    const submissions = await prisma.submission.findMany({
      where: { ojRemoteId: duplicate.ojRemoteId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })
    const redundantIds = submissions.slice(1).map(submission => submission.id)
    if (!redundantIds.length) continue
    deleted += (await prisma.submission.deleteMany({ where: { id: { in: redundantIds } } })).count
  }
  return deleted
}

export async function normalizeArchivedSubmissionLanguages() {
  const [legacy, swift] = await prisma.$transaction([
    prisma.submission.updateMany({ where: { language: 'luogu_lang_27' }, data: { language: 'cpp20' } }),
    prisma.submission.updateMany({ where: { language: 'swift' }, data: { language: 'cpp20' } }),
  ])
  return legacy.count + swift.count
}

export async function normalizeArchivedSubmissionResults() {
  const mappings = [
    ['unaccepted', 'wa'], ['wrong_answer', 'wa'], ['compilation_error', 'ce'],
    ['compile_error', 'ce'], ['waiting', 'queuing'],
  ] as const
  const updates = await prisma.$transaction(mappings.map(([from, to]) =>
    prisma.submission.updateMany({ where: { result: from }, data: { result: to } })))
  return updates.reduce((sum, update) => sum + update.count, 0)
}

export async function repairArchivedSubmissionProblemLinks() {
  const submissions = await prisma.submission.findMany({
    where: { problemInternalId: null }, select: { id: true, oj: true, problemId: true },
  })
  let fixed = 0
  for (const submission of submissions) {
    const problem = await prisma.problem.findFirst({
      where: { libraryScope: 'platform', platform: submission.oj, problemId: submission.problemId },
      select: { id: true },
    })
    if (!problem) continue
    const updated = await prisma.submission.updateMany({
      where: { id: submission.id, problemInternalId: null }, data: { problemInternalId: problem.id },
    })
    fixed += updated.count
  }
  return fixed
}

export async function cleanLegacyCaritsTestRecords() {
  return prisma.$transaction(async tx => {
    const orphaned = await tx.submission.deleteMany({ where: { oj: 'carits', problemInternalId: null } })
    const testProblems = await tx.problem.findMany({
      where: {
        libraryScope: 'platform', platform: 'carits',
        OR: [{ title: { contains: '测试' } }, { title: { contains: '兼容' } }],
      },
      select: { id: true },
    })
    const ids = testProblems.map(problem => problem.id)
    let linkedSubmissions = 0
    if (ids.length) {
      linkedSubmissions = (await tx.submission.deleteMany({
        where: { oj: 'carits', problemInternalId: { in: ids } },
      })).count
      await tx.trainingProblem.deleteMany({ where: { problemId: { in: ids } } })
      await tx.problemListEntry.deleteMany({ where: { problemId: { in: ids } } })
      await tx.problemNote.deleteMany({ where: { problemId: { in: ids } } })
      await tx.problemStatement.deleteMany({ where: { problemId: { in: ids } } })
      await tx.testdataFile.deleteMany({ where: { problemId: { in: ids } } })
      await tx.problemAttachment.deleteMany({ where: { problemId: { in: ids } } })
    }
    const deletedProblems = await tx.problem.deleteMany({ where: { id: { in: ids } } })
    return {
      orphanedSubmissions: orphaned.count + linkedSubmissions,
      testProblems: deletedProblems.count,
    }
  })
}

export type CleanupAction = 'deduplicate' | 'fix-language' | 'fix-result' | 'fix-internal-ids' | 'clean-orphaned' | 'all'

export async function cleanupArchivedSubmissions(action: CleanupAction) {
  const results: {
    deduplicated?: number
    fixedLanguage?: number
    fixedResult?: number
    fixedInternalIds?: number
    orphanedSubmissions?: number
    testProblems?: number
  } = {}
  if (action === 'deduplicate' || action === 'all') results.deduplicated = await deduplicateRemoteSubmissions()
  if (action === 'fix-language' || action === 'all') results.fixedLanguage = await normalizeArchivedSubmissionLanguages()
  if (action === 'fix-result' || action === 'all') results.fixedResult = await normalizeArchivedSubmissionResults()
  if (action === 'fix-internal-ids' || action === 'all') results.fixedInternalIds = await repairArchivedSubmissionProblemLinks()
  if (action === 'clean-orphaned' || action === 'all') Object.assign(results, await cleanLegacyCaritsTestRecords())
  return results
}
