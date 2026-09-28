import type { ResolvedProblemSelection } from '@oi-manager/contracts'

export type SelectedCanonicalProblem = NonNullable<ResolvedProblemSelection['problem']>
export const MAX_PROBLEM_SELECTION_BATCH = 100

/** Split explicit numbers only; never infer a platform, prefix, URL or UUID. */
export function parseProblemIds(value: string): string[] {
  return [...new Set(value.split(/[\s,;，；]+/u).map(item => item.trim()).filter(Boolean))]
}

export function problemSelectionInputError(codes: readonly string[]): string | null {
  if (codes.length > MAX_PROBLEM_SELECTION_BATCH) return `每次最多检索 ${MAX_PROBLEM_SELECTION_BATCH} 道题，请分批输入；本次输入未截断。`
  if (codes.some(code => code.length > 128)) return '题号不能超过 128 个字符；请只输入题号，不要粘贴题目链接。'
  return null
}

export interface SelectionPreviewRow {
  result: ResolvedProblemSelection
  state: 'ready' | 'duplicate' | 'blocked'
  message: string
}

/** Readiness belongs to the caller, not to the identity resolver. */
export function prepareProblemSelection(
  results: readonly ResolvedProblemSelection[],
  existingProblemIds: Iterable<string>,
  requireStable: boolean,
) {
  const seen = new Set(existingProblemIds)
  const accepted: SelectedCanonicalProblem[] = []
  const remainingProblemIds: string[] = []
  const rows: SelectionPreviewRow[] = results.map(result => {
    const problem = result.problem
    if (result.status !== 'resolved' || !problem) {
      remainingProblemIds.push(result.problemId)
      return { result, state: 'blocked', message: result.message || '当前输入不能使用' }
    }
    if (seen.has(problem.id)) return { result, state: 'duplicate', message: '该题已在当前列表中' }
    if (requireStable && !problem.stableData) {
      remainingProblemIds.push(result.problemId)
      return { result, state: 'blocked', message: '已找到题目，但当前入口需要 Stable 评测数据，暂不能选入' }
    }
    seen.add(problem.id)
    accepted.push(problem)
    return { result, state: 'ready', message: '已找到；选入表单后仍需保存' }
  })
  return { rows, accepted, remainingProblemIds }
}
