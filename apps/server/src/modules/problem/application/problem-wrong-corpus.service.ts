import crypto from 'node:crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { canModifyProblem } from '../problem.access'
import { EVALUATION_LIMITS } from '../problem.evaluation-budget.service'
import { refreshAdmittedCandidateStages } from '../problem.contribution-readiness.service'
import { queueAwaitingCandidateEvaluations } from '../problem.candidate-evaluation.service'

const WRONG_RESULTS = ['Wrong Answer', 'Presentation Error', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Runtime Error', 'Output Limit Exceeded']
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex')
const normalizedSource = (value: string) => value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
function parseJson(value: string | null | undefined): any[] {
  if (!value) return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

function behaviorOf(item: { result: string | null; score: number | null; subtasks: string | null; cases: string | null; TestSetRevision: { Subtasks: Array<{ subtaskId: number; score: number }> } | null }) {
  const full = new Map(item.TestSetRevision?.Subtasks.map(subtask => [subtask.subtaskId, subtask.score]) || [])
  const subtasks = parseJson(item.subtasks).map((subtask: any) => ({
    id: Number(subtask?.id),
    score: Number(subtask?.score || 0),
    cases: Array.isArray(subtask?.cases) ? subtask.cases.map((entry: any) => String(entry?.result || '')).filter(Boolean) : [],
  })).filter((subtask: any) => Number.isSafeInteger(subtask.id) && subtask.id > 0)
  const affectedSubtaskIds = subtasks.filter((subtask: any) => !full.has(subtask.id) || subtask.score < (full.get(subtask.id) || 0)).map((subtask: any) => subtask.id)
  const topLevelCases = parseJson(item.cases).map((entry: any) => String(entry?.result || '')).filter(Boolean)
  const signature = JSON.stringify({ result: item.result, score: item.score, subtasks, cases: topLevelCases })
  return { affectedSubtaskIds: [...new Set(affectedSubtaskIds)].sort((a, b) => a - b), signature }
}
async function managed(user: JwtPayload, problemId: string) { const problem = await prisma.problem.findUnique({ where: { id: problemId } }); if (!problem || !canModifyProblem(user, problem)) { const error: any = new Error('题目不存在'); error.statusCode = 404; throw error } return problem }

export async function getWrongCorpus(user: JwtPayload, problemId: string) {
  await managed(user, problemId)
  const [revision, clusters, categories] = await Promise.all([
    prisma.wrongCorpusRevision.findFirst({ where: { problemId, status: 'active' }, orderBy: { revisionNumber: 'desc' } }),
    prisma.wrongBehaviorCluster.findMany({ where: { problemId, status: 'active' }, orderBy: [{ weight: 'desc' }, { frequency: 'desc' }], take: 512, select: { id: true, behaviorHash: true, categoryId: true, weight: true, frequency: true, partition: true, status: true } }),
    prisma.bugCategory.findMany({ where: { problemId }, orderBy: { name: 'asc' } }),
  ])
  return { revision, clusters, categories }
}

export async function rebuildWrongCorpus(user: JwtPayload, problemId: string) {
  await managed(user, problemId)
  const rows = await prisma.submission.findMany({ where: { problemInternalId: problemId, submitMethod: 'local', OR: [
    { CurrentJudgeRun: { is: { status: 'FINALIZED', OR: [{ result: { in: WRONG_RESULTS } }, { score: { lt: 100 } }] } } },
    { CurrentJudgeRun: { is: null }, OR: [{ result: { in: WRONG_RESULTS } }, { score: { lt: 100 } }] },
  ] }, orderBy: { createdAt: 'desc' }, take: 10_000, select: { id: true, language: true, code: true, result: true, score: true, inputFilename: true, outputFilename: true, subtasks: true, cases: true, TestSetRevision: { select: { Subtasks: { select: { subtaskId: true, score: true } } } }, CurrentJudgeRun: { select: { result: true, score: true, subtasks: true, cases: true, inputFilename: true, outputFilename: true, TestSetRevision: { select: { Subtasks: { select: { subtaskId: true, score: true } } } } } } } })
  const submissions = rows.map(item => item.CurrentJudgeRun ? {
    ...item,
    result: item.CurrentJudgeRun.result,
    score: item.CurrentJudgeRun.score,
    subtasks: item.CurrentJudgeRun.subtasks,
    cases: item.CurrentJudgeRun.cases,
    inputFilename: item.CurrentJudgeRun.inputFilename,
    outputFilename: item.CurrentJudgeRun.outputFilename,
    TestSetRevision: item.CurrentJudgeRun.TestSetRevision,
  } : item).filter(item => Boolean(item.result) && (WRONG_RESULTS.includes(item.result!) || (item.score ?? 100) < 100))
  const unique = new Map<string, typeof submissions[number]>()
  for (const item of submissions) {
    const sourceSha256 = hash(`${item.language}\0${normalizedSource(item.code)}`)
    const executionFingerprint = hash(`${sourceSha256}\0${item.inputFilename || 'stdin'}\0${item.outputFilename || 'stdout'}`)
    if (!unique.has(executionFingerprint)) unique.set(executionFingerprint, item)
  }
  const selected = [...unique.entries()].slice(0, EVALUATION_LIMITS.maxCorpusClusters)
  const clustered = new Map<string, Array<{ executionFingerprint: string; item: typeof submissions[number]; affectedSubtaskIds: number[] }>>()
  for (const [executionFingerprint, item] of selected) {
    const behavior = behaviorOf(item)
    const behaviorHash = hash(behavior.signature)
    clustered.set(behaviorHash, [...(clustered.get(behaviorHash) || []), { executionFingerprint, item, affectedSubtaskIds: behavior.affectedSubtaskIds }])
  }
  const previous = await prisma.wrongCorpusRevision.aggregate({ where: { problemId }, _max: { revisionNumber: true } }), revisionId = crypto.randomUUID(), revisionNumber = (previous._max.revisionNumber || 0) + 1
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wrong-corpus:${problemId}`}, 0)) IS NULL AS locked`
    await tx.wrongCorpusRevision.updateMany({ where: { problemId, status: 'active' }, data: { status: 'archived' } }); await tx.wrongBehaviorCluster.updateMany({ where: { problemId, status: 'active' }, data: { status: 'archived' } })
    for (const [behaviorHash, members] of clustered) {
      const sampleIds: string[] = []
      const affectedSubtaskIds = [...new Set(members.flatMap(member => member.affectedSubtaskIds))].sort((a, b) => a - b)
      for (const { executionFingerprint, item } of members) {
        const sourceSha256 = hash(`${item.language}\0${normalizedSource(item.code)}`)
        const sample = await tx.wrongSolutionSample.upsert({ where: { problemId_executionFingerprint: { problemId, executionFingerprint } }, update: { result: item.result, score: item.score, status: 'active', inputFilename: item.inputFilename, outputFilename: item.outputFilename, behaviorHash, subtaskIds: JSON.stringify(behaviorOf(item).affectedSubtaskIds) }, create: { id: crypto.randomUUID(), problemId, source: 'historical_submission', submissionId: item.id, language: item.language, sourceSha256, executionFingerprint, inputFilename: item.inputFilename, outputFilename: item.outputFilename, result: item.result, score: item.score, status: 'active', behaviorHash, subtaskIds: JSON.stringify(behaviorOf(item).affectedSubtaskIds) } })
        sampleIds.push(sample.id)
      }
      const partition = parseInt(behaviorHash.slice(0, 2), 16) % 5 === 0 ? 'holdout' : 'evaluation'
      const cluster = await tx.wrongBehaviorCluster.upsert({ where: { problemId_behaviorHash: { problemId, behaviorHash } }, update: { corpusRevisionId: revisionId, representativeSampleId: sampleIds[0], partition, frequency: members.length, subtaskIds: JSON.stringify(affectedSubtaskIds), status: 'active' }, create: { id: crypto.randomUUID(), problemId, corpusRevisionId: revisionId, representativeSampleId: sampleIds[0], behaviorHash, partition, frequency: members.length, subtaskIds: JSON.stringify(affectedSubtaskIds) } })
      await tx.wrongSolutionSample.updateMany({ where: { id: { in: sampleIds } }, data: { clusterId: cluster.id } })
    }
    const holdoutCount = [...clustered.keys()].filter(behaviorHash => parseInt(behaviorHash.slice(0, 2), 16) % 5 === 0).length
    await tx.wrongCorpusRevision.create({ data: { id: revisionId, problemId, revisionNumber, status: 'active', sampleCount: selected.length, clusterCount: clustered.size, evaluationCount: clustered.size - holdoutCount, holdoutCount, corpusHash: `ready:${hash(selected.map(([key]) => key).sort().join('\n'))}`, createdBy: user.userId, activatedAt: new Date() } })
  })
  await refreshAdmittedCandidateStages(problemId)
  await queueAwaitingCandidateEvaluations(problemId)
  return { revisionNumber, samples: selected.length, clusters: clustered.size }
}
