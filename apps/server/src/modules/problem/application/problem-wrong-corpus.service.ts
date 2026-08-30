import crypto from 'node:crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { canModifyProblem } from '../problem.access'
import { EVALUATION_LIMITS } from '../problem.evaluation-budget.service'

const WRONG_RESULTS = ['Wrong Answer', 'Presentation Error', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Runtime Error', 'Output Limit Exceeded']
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex')
const normalizedSource = (value: string) => value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
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
  const submissions = await prisma.submission.findMany({ where: { problemInternalId: problemId, submitMethod: 'local', OR: [{ result: { in: WRONG_RESULTS } }, { score: { lt: 100 } }] }, orderBy: { createdAt: 'desc' }, take: 10_000, select: { id: true, language: true, code: true, result: true, score: true } })
  const unique = new Map<string, typeof submissions[number]>()
  for (const item of submissions) { const sourceSha256 = hash(`${item.language}\0${normalizedSource(item.code)}`); if (!unique.has(sourceSha256)) unique.set(sourceSha256, item) }
  const selected = [...unique.entries()].slice(0, EVALUATION_LIMITS.maxCorpusClusters), previous = await prisma.wrongCorpusRevision.aggregate({ where: { problemId }, _max: { revisionNumber: true } }), revisionId = crypto.randomUUID(), revisionNumber = (previous._max.revisionNumber || 0) + 1
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wrong-corpus:${problemId}`}, 0)) IS NULL AS locked`
    await tx.wrongCorpusRevision.updateMany({ where: { problemId, status: 'active' }, data: { status: 'archived' } }); await tx.wrongBehaviorCluster.updateMany({ where: { problemId, status: 'active' }, data: { status: 'archived' } })
    for (const [sourceSha256, item] of selected) {
      const sample = await tx.wrongSolutionSample.upsert({ where: { problemId_sourceSha256: { problemId, sourceSha256 } }, update: { result: item.result, score: item.score, status: 'active' }, create: { id: crypto.randomUUID(), problemId, source: 'historical_submission', submissionId: item.id, language: item.language, sourceSha256, result: item.result, score: item.score, status: 'active' } }), behaviorHash = hash(`${item.language}\0${item.result}\0${item.score ?? ''}\0${sourceSha256}`), partition = parseInt(behaviorHash.slice(0, 2), 16) % 5 === 0 ? 'holdout' : 'evaluation'
      await tx.wrongBehaviorCluster.upsert({ where: { problemId_behaviorHash: { problemId, behaviorHash } }, update: { corpusRevisionId: revisionId, representativeSampleId: sample.id, partition, status: 'active' }, create: { id: crypto.randomUUID(), problemId, corpusRevisionId: revisionId, representativeSampleId: sample.id, behaviorHash, partition } })
    }
    const holdoutCount = selected.filter(([sourceSha256, item]) => parseInt(hash(`${item.language}\0${item.result}\0${item.score ?? ''}\0${sourceSha256}`).slice(0, 2), 16) % 5 === 0).length
    await tx.wrongCorpusRevision.create({ data: { id: revisionId, problemId, revisionNumber, status: 'active', sampleCount: selected.length, clusterCount: selected.length, evaluationCount: selected.length - holdoutCount, holdoutCount, corpusHash: hash(selected.map(([key]) => key).sort().join('\n')), createdBy: user.userId, activatedAt: new Date() } })
  })
  return { revisionNumber, samples: selected.length }
}
