import type { RevisionCaseSpec, RevisionSubtaskSpec, TestSetRevisionSpec } from './problem.testset-revision.service'
import crypto from 'node:crypto'

export const OI_CANDIDATE_LIMITS = Object.freeze({
  MAX_SUBTASKS: 15,
  MAX_CASES_PER_SUBTASK: 10,
  MIN_OFFICIAL_CORE: 3,
  MIN_BOOTSTRAP_CASES: 3,
  MIN_WRONG_PROGRAMS_FOR_CONTRIBUTION: 1,
  MIN_WRONG_PROGRAMS_FOR_AUTO_SELECTION: 5,
  MIN_WRONG_CLUSTERS_FOR_AUTO_SELECTION: 3,
  NEW_CASE_PROTECTION_DAYS: 7,
  SUCCESSFUL_HACK_PROTECTION_DAYS: 14,
  MAX_CASES_PER_SEMANTIC_CLUSTER: 2,
  MIN_REPLACEMENT_ABS_GAIN: 50,
  MIN_REPLACEMENT_REL_GAIN: 0.05,
})

export type CorpusMode = 'closed' | 'limited' | 'open'

export function resolveCorpusMode(wrongProgramCount: number, wrongClusterCount: number): CorpusMode {
  if (wrongProgramCount < OI_CANDIDATE_LIMITS.MIN_WRONG_PROGRAMS_FOR_CONTRIBUTION) return 'closed'
  if (wrongProgramCount >= OI_CANDIDATE_LIMITS.MIN_WRONG_PROGRAMS_FOR_AUTO_SELECTION
    && wrongClusterCount >= OI_CANDIDATE_LIMITS.MIN_WRONG_CLUSTERS_FOR_AUTO_SELECTION) return 'open'
  return 'limited'
}

export function parseSubtaskIds(value: string | null | undefined): number[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(Number).filter((id): id is number => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b)
      : []
  } catch {
    return []
  }
}

export function uniqueSubtaskCases(subtask: RevisionSubtaskSpec): RevisionCaseSpec[] {
  const seen = new Set<string>()
  const result: RevisionCaseSpec[] = []
  for (const group of subtask.groups) for (const item of group.cases) {
    const key = item.testcaseId || `${item.inputObjectId}\0${item.outputObjectId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export type OiFormalLimitIssue = { code: string; path: string; message: string }

export function validateOiFormalLimits(spec: TestSetRevisionSpec): OiFormalLimitIssue[] {
  if (spec.mode !== 'oi') return []
  const subtasks = spec.subtasks || []
  const issues: OiFormalLimitIssue[] = []
  if (subtasks.length > OI_CANDIDATE_LIMITS.MAX_SUBTASKS) issues.push({
    code: 'OI_SUBTASK_LIMIT_EXCEEDED', path: 'subtasks',
    message: `每道 OI 题最多允许 ${OI_CANDIDATE_LIMITS.MAX_SUBTASKS} 个 Subtask`,
  })
  for (const [index, subtask] of subtasks.entries()) {
    const count = uniqueSubtaskCases(subtask).length
    if (count > OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK) issues.push({
      code: 'OI_SUBTASK_CASE_LIMIT_REACHED', path: `subtasks.${index}.groups`,
      message: `Subtask ${subtask.id} 包含 ${count} 个唯一正式测试点，最多允许 ${OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK} 个；满额后必须通过 Selector 替换`,
    })
  }
  return issues
}

export function requiredReplacementGain(baselineQuality: number) {
  return Math.max(
    OI_CANDIDATE_LIMITS.MIN_REPLACEMENT_ABS_GAIN,
    Math.max(0, baselineQuality) * OI_CANDIDATE_LIMITS.MIN_REPLACEMENT_REL_GAIN,
  )
}

function bucket(value: number) {
  if (value <= 0) return 0
  return Math.floor(Math.log2(value))
}

export function semanticInputFingerprint(input: Buffer | string) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const numbers = tokens.map(token => /^[-+]?\d+$/.test(token) ? Number(token) : Number.NaN).filter(Number.isFinite)
  const negative = numbers.filter(value => value < 0).length
  const zero = numbers.filter(value => value === 0).length
  const unique = new Set(tokens).size
  const signature = {
    bytes: bucket(Buffer.byteLength(text)),
    lines: bucket(text.split(/\r?\n/).length),
    tokens: bucket(tokens.length),
    numericRatio: tokens.length ? Math.round(numbers.length / tokens.length * 10) : 0,
    negativeRatio: numbers.length ? Math.round(negative / numbers.length * 10) : 0,
    zeroRatio: numbers.length ? Math.round(zero / numbers.length * 10) : 0,
    uniqueRatio: tokens.length ? Math.round(unique / tokens.length * 10) : 0,
    magnitude: numbers.length ? bucket(Math.max(...numbers.map(Math.abs))) : 0,
  }
  return crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex')
}

export function genericInputFeatures(input: Buffer | string) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const numbers = tokens.map(token => /^[-+]?\d+$/.test(token) ? Number(token) : Number.NaN).filter(Number.isFinite)
  const bytes = Buffer.byteLength(text)
  const features = [`bytes.${bucket(bytes)}`, `tokens.${bucket(tokens.length)}`, `lines.${bucket(text.split(/\r?\n/).length)}`]
  if (numbers.some(value => value < 0)) features.push('number.negative')
  if (numbers.some(value => value === 0)) features.push('number.zero')
  if (numbers.length && Math.max(...numbers.map(Math.abs)) >= 1_000_000_000) features.push('number.large')
  if (new Set(tokens).size <= Math.max(1, tokens.length / 4)) features.push('tokens.repetitive')
  return features.sort()
}

export type SelectionMetric = {
  id: string
  semanticFingerprint?: string | null
  killedClusters?: Array<{ id: string; weight: number }>
  features?: string[]
  runtimeCost?: number
  hackEvidence?: boolean
}

export function scoreCaseSet(cases: SelectionMetric[], corpus: Array<{ id: string; weight: number }>, featureUniverse: string[]) {
  const clusterWeights = new Map(corpus.map(item => [item.id, Math.max(1, item.weight)]))
  const totalWeight = [...clusterWeights.values()].reduce((sum, item) => sum + item, 0)
  const killed = new Set(cases.flatMap(item => item.killedClusters?.map(cluster => cluster.id) || []))
  const killedWeight = [...killed].reduce((sum, id) => sum + (clusterWeights.get(id) || 0), 0)
  const killScore = totalWeight ? 500 * killedWeight / totalWeight : 0
  const semanticCount = new Set(cases.map(item => item.semanticFingerprint).filter(Boolean)).size
  const diversityScore = cases.length ? 200 * semanticCount / cases.length : 0
  const coveredFeatures = new Set(cases.flatMap(item => item.features || []))
  const featureScore = featureUniverse.length ? 150 * coveredFeatures.size / featureUniverse.length : 0
  const hackScore = cases.some(item => item.hackEvidence) ? 100 : 0
  const averageCost = cases.length ? cases.reduce((sum, item) => sum + Math.max(0, item.runtimeCost || 0), 0) / cases.length : 0
  const costPenalty = Math.min(50, averageCost)
  return Math.max(0, Math.min(1000, killScore + diversityScore + featureScore + hackScore - costPenalty))
}

export function leaveOneOutValues(cases: SelectionMetric[], corpus: Array<{ id: string; weight: number }>, featureUniverse: string[]) {
  const full = scoreCaseSet(cases, corpus, featureUniverse)
  return new Map(cases.map(item => [item.id, full - scoreCaseSet(cases.filter(other => other.id !== item.id), corpus, featureUniverse)]))
}

export function chooseBestEviction(input: { pool: SelectionMetric[]; removableIds: Set<string>; corpus: Array<{ id: string; weight: number }>; featureUniverse: string[]; preferCandidateId?: string }) {
  let best: { removed: SelectionMetric; quality: number } | null = null
  for (const removed of input.pool) {
    if (!input.removableIds.has(removed.id)) continue
    const quality = scoreCaseSet(input.pool.filter(item => item.id !== removed.id), input.corpus, input.featureUniverse)
    if (!best || quality > best.quality || quality === best.quality && removed.id === input.preferCandidateId) best = { removed, quality }
  }
  return best
}
