import { prisma } from '../../prisma'
import { loadTestSetSlotSpec, type TestSetSlotSpec } from './problem.testset-slot.service'
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

export async function resolveSubtaskReadiness(
  problemId: string,
  slot: 'STABLE' | 'EVOLVING' = 'EVOLVING',
): Promise<SubtaskContributionReadiness[]> {
  const [preferred, samples, clusters] = await Promise.all([
    loadTestSetSlotSpec(problemId, slot),
    prisma.wrongSolutionSample.findMany({ where: { problemId, status: 'active' }, select: { subtaskIds: true } }),
    prisma.wrongBehaviorCluster.findMany({ where: { problemId, status: 'active' }, select: { subtaskIds: true } }),
  ])
  const spec: TestSetSlotSpec | null = preferred || (slot === 'EVOLVING' ? await loadTestSetSlotSpec(problemId, 'STABLE') : null)
  if (!spec || spec.mode !== 'oi') return []
  return (spec.subtasks || []).map(subtask => {
    const wrongProgramCount = samples.filter(sample => parseSubtaskIds(sample.subtaskIds).includes(subtask.id)).length
    const wrongClusterCount = clusters.filter(cluster => parseSubtaskIds(cluster.subtaskIds).includes(subtask.id)).length
    const contributionMode = resolveCorpusMode(wrongProgramCount, wrongClusterCount)
    const caseCount = uniqueSubtaskCases(subtask).length
    return {
      subtaskId: subtask.id,
      caseCount,
      caseLimit: OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK,
      wrongProgramCount,
      wrongClusterCount,
      contributionMode,
      autoSelection: contributionMode === 'open',
      bootstrapAvailable: caseCount < OI_CANDIDATE_LIMITS.MIN_BOOTSTRAP_CASES,
    }
  })
}
