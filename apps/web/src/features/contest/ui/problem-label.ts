export interface ContestProblemLabelSource {
  orderIndex?: number | null
  title?: string | null
  problemTitle?: string | null
  alias?: string | null
}

export function contestProblemCode(orderIndex?: number | null): string {
  let result = ''
  let index = Number.isInteger(orderIndex) && (orderIndex ?? 0) >= 0 ? orderIndex! : 0
  while (index >= 0) {
    result = String.fromCharCode(65 + (index % 26)) + result
    index = Math.floor(index / 26) - 1
  }
  return result
}

export function contestProblemTitle(problem: ContestProblemLabelSource): string {
  const title = problem.title?.trim() || problem.problemTitle?.trim()
  return title || `题目 ${contestProblemCode(problem.orderIndex)}`
}

export function contestProblemSectionTitle(problem: ContestProblemLabelSource): string {
  return problem.title?.trim() || problem.problemTitle?.trim() || '题目'
}
