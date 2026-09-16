import yaml from 'js-yaml'
import { prisma } from '../../../prisma'
import { legacySubmissionIoSuggestion } from '../../judge/domain/submission-io'

type Candidate = Awaited<ReturnType<typeof loadCandidates>>[number]

async function loadCandidates() {
  return prisma.submission.findMany({
    where: { problemInternalId: { not: null }, ioAdapterVersion: 0 },
    select: {
      id: true,
      problemInternalId: true,
      testSetRevisionId: true,
      TestSetRevision: { select: { judgeConfig: true } },
    },
    orderBy: { id: 'asc' },
  })
}

async function resolveCandidate(candidate: Candidate, problemConfigs: Map<string, string | null>) {
  const configText = candidate.TestSetRevision?.judgeConfig
    || problemConfigs.get(candidate.problemInternalId!)
    || ''
  try {
    const config = yaml.load(configText || '{}') as any
    const suggestion = legacySubmissionIoSuggestion(config)
    return {
      ok: true as const,
      inputFilename: suggestion?.inputFilename || null,
      outputFilename: suggestion?.outputFilename || null,
      source: candidate.TestSetRevision ? 'revision' : 'problem',
    }
  } catch (error: any) {
    return { ok: false as const, message: error.message || 'Judge Config 无法解析' }
  }
}

export async function inspectSubmissionIoMigration() {
  const candidates = await loadCandidates()
  const problemIds = [...new Set(candidates.map(item => item.problemInternalId!).filter(Boolean))]
  const problems = await prisma.problem.findMany({ where: { id: { in: problemIds } }, select: { id: true, judgeConfig: true } })
  const problemConfigs = new Map(problems.map(item => [item.id, item.judgeConfig]))
  const resolvable: Array<{ submissionId: number; inputFilename: string | null; outputFilename: string | null; source: string }> = []
  const unresolved: Array<{ submissionId: number; message: string }> = []
  for (const candidate of candidates) {
    const resolved = await resolveCandidate(candidate, problemConfigs)
    if (resolved.ok) resolvable.push({ submissionId: candidate.id, inputFilename: resolved.inputFilename, outputFilename: resolved.outputFilename, source: resolved.source })
    else unresolved.push({ submissionId: candidate.id, message: resolved.message })
  }
  return {
    pending: candidates.length,
    resolvable: resolvable.length,
    fileIo: resolvable.filter(item => item.inputFilename || item.outputFilename).length,
    standardIo: resolvable.filter(item => !item.inputFilename && !item.outputFilename).length,
    unresolved,
    preview: resolvable.slice(0, 100),
  }
}

export async function applySubmissionIoMigration() {
  const candidates = await loadCandidates()
  const problemIds = [...new Set(candidates.map(item => item.problemInternalId!).filter(Boolean))]
  const problems = await prisma.problem.findMany({ where: { id: { in: problemIds } }, select: { id: true, judgeConfig: true } })
  const problemConfigs = new Map(problems.map(item => [item.id, item.judgeConfig]))
  let migrated = 0
  const unresolved: Array<{ submissionId: number; message: string }> = []
  for (const candidate of candidates) {
    const resolved = await resolveCandidate(candidate, problemConfigs)
    if (!resolved.ok) {
      unresolved.push({ submissionId: candidate.id, message: resolved.message })
      continue
    }
    const changed = await prisma.$transaction(async tx => {
      const updated = await tx.submission.updateMany({
        where: { id: candidate.id, ioAdapterVersion: 0 },
        data: { inputFilename: resolved.inputFilename, outputFilename: resolved.outputFilename, ioAdapterVersion: 1 },
      })
      if (updated.count !== 1) return false
      await tx.judgeRun.updateMany({
        where: { submissionId: candidate.id, ioAdapterVersion: 0 },
        data: { inputFilename: resolved.inputFilename, outputFilename: resolved.outputFilename, ioAdapterVersion: 1 },
      })
      return true
    })
    if (changed) migrated++
  }
  return { migrated, unresolved, remaining: await prisma.submission.count({ where: { problemInternalId: { not: null }, ioAdapterVersion: 0 } }) }
}
