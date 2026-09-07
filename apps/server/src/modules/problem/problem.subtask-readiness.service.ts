import { prisma } from '../../prisma'
import { loadRevisionSpec } from './problem.testset-revision.service'
import { OI_CANDIDATE_LIMITS, parseSubtaskIds, resolveCorpusMode, uniqueSubtaskCases, type CorpusMode } from './problem.oi-candidate-policy'

export type SubtaskContributionReadiness = {
  subtaskId: number
  caseCount: number
  caseLimit: number
  wrongProgramCount: number
  wrongClusterCount: number
  contributionMode: CorpusMode
  autoSelection: boolean
  bootstrapAvailable: boolean
}

export async function resolveSubtaskReadiness(problemId: string, revisionId: string | null): Promise<SubtaskContributionReadiness[]> {
  if (!revisionId) return []
  const [spec, samples, clusters] = await Promise.all([
    loadRevisionSpec(revisionId),
    prisma.wrongSolutionSample.findMany({ where: { problemId, status: 'active' }, select: { subtaskIds: true } }),
    prisma.wrongBehaviorCluster.findMany({ where: { problemId, status: 'active' }, select: { subtaskIds: true } }),
  ])
  if (!spec || spec.mode !== 'oi') return []
  return (spec.subtasks || []).map(subtask => {
    const wrongProgramCount = samples.filter(sample => parseSubtaskIds(sample.subtaskIds).includes(subtask.id)).length
    const wrongClusterCount = clusters.filter(cluster => parseSubtaskIds(cluster.subtaskIds).includes(subtask.id)).length
    const contributionMode = resolveCorpusMode(wrongProgramCount, wrongClusterCount)
    const caseCount = uniqueSubtaskCases(subtask).length
    return { subtaskId: subtask.id, caseCount, caseLimit: OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK, wrongProgramCount, wrongClusterCount, contributionMode, autoSelection: contributionMode === 'open', bootstrapAvailable: caseCount < OI_CANDIDATE_LIMITS.MIN_BOOTSTRAP_CASES }
  })
}
