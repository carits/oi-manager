import yaml from 'js-yaml'

export type AssignmentCategory = 'REQUIRED' | 'OPTIONAL' | 'CHALLENGE'
export type OptionalScoringPolicy = 'NONE' | 'BONUS' | 'BEST_N'
export type ChallengeScoringPolicy = 'NONE' | 'EXTRA_CREDIT'

export interface AssignmentGradeProblem {
  id: string
  category: AssignmentCategory
  maxScore: number
  weight: number
}

export interface AssignmentGradeProgress {
  assignmentProblemId: string
  finalScore: number | null
}

export interface AssignmentGradePolicy {
  gradingVersion: number
  baseScoreMax: number
  optionalScoringPolicy: OptionalScoringPolicy
  optionalBestCount: number | null
  optionalBonusMax: number
  challengeScoringPolicy: ChallengeScoringPolicy
  challengeBonusMax: number
}

export interface AssignmentGradeResult {
  rawScore: number
  maxScore: number
  components: {
    required: number
    optional: number
    challenge: number
  }
  evidence: Array<{
    assignmentProblemId: string
    category: AssignmentCategory
    score: number
    maxScore: number
    weight: number
    ratio: number
  }>
}

function finitePositive(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

export function judgeMaxScoreFromSnapshot(snapshot: string, mode?: string): number {
  if (String(mode || '').toLowerCase() === 'acm') return 100
  try {
    const config = yaml.load(snapshot) as any
    if (String(config?.mode || '').toLowerCase() === 'acm') return 100
    const explicit = Number(config?.totalScore ?? config?.fullScore)
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit)
    if (Array.isArray(config?.subtasks)) {
      const total = config.subtasks.reduce((sum: number, subtask: any) => {
        const score = Number(subtask?.score ?? subtask?.points ?? subtask?.fullScore)
        return sum + (Number.isFinite(score) && score > 0 ? score : 0)
      }, 0)
      if (total > 0) return Math.round(total)
    }
  } catch {
    // The immutable revision is validated elsewhere. Keep legacy snapshots usable.
  }
  return 100
}

export function mapJudgeScore(input: {
  score: number | null
  result: string | null
  judgeMaxScore: number
  assignmentMaxScore: number
}) {
  const judgeMax = finitePositive(input.judgeMaxScore, 100)
  const assignmentMax = finitePositive(input.assignmentMaxScore, 100)
  const accepted = ['accepted', 'ac'].includes(String(input.result || '').toLowerCase())
  const raw = input.score === null ? (accepted ? judgeMax : 0) : Number(input.score)
  const ratio = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw / judgeMax : 0))
  return Math.round(ratio * assignmentMax)
}

function weightedComponent(items: AssignmentGradeResult['evidence'], maximum: number) {
  if (!items.length || maximum <= 0) return 0
  const denominator = items.reduce((sum, item) => sum + Math.max(1, item.weight), 0)
  if (!denominator) return 0
  const ratio = items.reduce((sum, item) => sum + item.ratio * Math.max(1, item.weight), 0) / denominator
  return Math.round(Math.max(0, Math.min(1, ratio)) * maximum)
}

export function calculateAssignmentGrade(
  policy: AssignmentGradePolicy,
  problems: AssignmentGradeProblem[],
  progress: AssignmentGradeProgress[],
): AssignmentGradeResult {
  const progressByProblem = new Map(progress.map(item => [item.assignmentProblemId, item.finalScore]))
  const evidence = problems.map(problem => {
    const score = Math.max(0, Math.min(problem.maxScore, Number(progressByProblem.get(problem.id) || 0)))
    return {
      assignmentProblemId: problem.id,
      category: problem.category,
      score,
      maxScore: problem.maxScore,
      weight: problem.weight,
      ratio: problem.maxScore > 0 ? score / problem.maxScore : 0,
    }
  })
  const required = weightedComponent(evidence.filter(item => item.category === 'REQUIRED'), policy.baseScoreMax)
  const optionalItems = evidence.filter(item => item.category === 'OPTIONAL')
  const selectedOptional = policy.optionalScoringPolicy === 'BEST_N'
    ? [...optionalItems].sort((left, right) => right.ratio - left.ratio || right.weight - left.weight || left.assignmentProblemId.localeCompare(right.assignmentProblemId)).slice(0, Math.max(1, policy.optionalBestCount || 1))
    : optionalItems
  const optional = policy.optionalScoringPolicy === 'NONE' ? 0 : weightedComponent(selectedOptional, policy.optionalBonusMax)
  const challenge = policy.challengeScoringPolicy === 'EXTRA_CREDIT'
    ? weightedComponent(evidence.filter(item => item.category === 'CHALLENGE'), policy.challengeBonusMax)
    : 0
  return {
    rawScore: required + optional + challenge,
    maxScore: policy.baseScoreMax + (policy.optionalScoringPolicy === 'NONE' ? 0 : policy.optionalBonusMax) + (policy.challengeScoringPolicy === 'EXTRA_CREDIT' ? policy.challengeBonusMax : 0),
    components: { required, optional, challenge },
    evidence,
  }
}
