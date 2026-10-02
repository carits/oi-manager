import type { ProblemSelectionItem, ResolvedProblemSelection } from '@oi-manager/contracts'

export type SelectedCanonicalProblem = NonNullable<ResolvedProblemSelection['problem']>
export type ProblemDataRequirement = 'none' | 'stable' | 'training'
export interface SelectedProblemReference {
  problem: SelectedCanonicalProblem
  alias?: string | null
  lineNumber?: number
}
export const MAX_PROBLEM_SELECTION_BATCH = 100

/** Split explicit numbers only; never infer a platform, prefix, URL or UUID. */
export function parseProblemIds(value: string): string[] {
  return [...new Set(value.split(/[\s,;，；]+/u).map(item => item.trim()).filter(Boolean))]
}

export function problemSelectionInputError(problemIds: readonly string[]): string | null {
  if (problemIds.length > MAX_PROBLEM_SELECTION_BATCH) return `每次最多检索 ${MAX_PROBLEM_SELECTION_BATCH} 道题，请分批输入；本次输入未截断。`
  if (problemIds.some(id => id.length > 128)) return '题号不能超过 128 个字符；请只输入题号，不要粘贴题目链接。'
  if (problemIds.some(id => /[\s,;，；]/u.test(id))) return '此处只能输入一个题号；多题请使用“编辑”切换到文本模式。'
  if (problemIds.some(id => /:\/\//u.test(id))) return '请填写原始题号，不要填写题目链接。'
  return null
}

export interface SelectionPreviewRow {
  result: ResolvedProblemSelection
  state: 'ready' | 'duplicate' | 'blocked'
  message: string
}

const statusMessages: Record<ResolvedProblemSelection['status'], string> = {
  resolved: '已找到；选入表单后仍需保存',
  not_found: '当前可访问题库中未找到该题',
  invalid_input: '请检查平台和题号',
  not_published: '已找到，但题目尚未发布或已归档',
  identity_conflict: '平台和题号存在重复记录，请联系管理员处理',
}

/** Readiness belongs to the caller, not to the identity resolver. */
export function prepareProblemSelection(
  results: readonly ResolvedProblemSelection[],
  existingProblemIds: Iterable<string>,
  requirement: ProblemDataRequirement | boolean = 'stable',
) {
  const dataRequirement: ProblemDataRequirement = typeof requirement === 'boolean'
    ? (requirement ? 'stable' : 'none')
    : requirement
  const seen = new Set(existingProblemIds)
  const accepted: SelectedCanonicalProblem[] = []
  const remainingProblemIds: string[] = []
  const rows: SelectionPreviewRow[] = results.map(result => {
    const problem = result.problem
    if (result.status !== 'resolved' || !problem) {
      remainingProblemIds.push(result.problemId)
      return { result, state: 'blocked', message: result.message || statusMessages[result.status] }
    }
    if (seen.has(problem.id)) return { result, state: 'duplicate', message: '该题已在当前列表中' }
    if (dataRequirement === 'stable' && !problem.stableData) {
      remainingProblemIds.push(result.problemId)
      return { result, state: 'blocked', message: '已找到题目，但当前入口需要 Stable 评测数据，暂不能选入' }
    }
    if (dataRequirement === 'training' && !problem.evolvingData && !problem.stableData) {
      remainingProblemIds.push(result.problemId)
      return { result, state: 'blocked', message: '已找到题目，但没有可用于训练的 Evolving 或 Stable 评测数据' }
    }
    seen.add(problem.id)
    accepted.push(problem)
    return { result, state: 'ready', message: statusMessages.resolved }
  })
  return { rows, accepted, remainingProblemIds }
}

/** A valid envelope must also belong to this exact request, including every row. */
export function orderProblemSelectionResults(
  inputs: readonly ProblemSelectionItem[],
  results: readonly ResolvedProblemSelection[],
): ResolvedProblemSelection[] {
  const byKey = new Map(results.map(result => [result.clientKey, result]))
  if (results.length !== inputs.length || byKey.size !== inputs.length) throw new Error('检索响应不完整，请重试')
  return inputs.map(input => {
    const result = byKey.get(input.clientKey)
    if (!result || result.platform !== input.platform || result.problemId !== input.problemId) {
      throw new Error('检索响应与当前平台、题号不一致，请重试')
    }
    if (result.problem && (result.problem.platform !== input.platform || result.problem.problemId !== input.problemId)) {
      throw new Error('检索响应的题目身份不一致，请重试')
    }
    return result
  })
}

export interface ProblemReferenceAddContext {
  signal: AbortSignal
  /** Async callers must check this before mutating a business draft. */
  isCurrent: () => boolean
}
export interface ProblemReferenceAddReceipt {
  acceptedIds: string[]
  rejected?: Array<{ id: string; message: string }>
}
export type AddProblemReferences = (
  references: SelectedProblemReference[],
  context: ProblemReferenceAddContext,
) => void | ProblemReferenceAddReceipt | Promise<void | ProblemReferenceAddReceipt>

/** Existing synchronous callers accept the whole array. Partial async callers return a receipt. */
export function problemReferenceAddReceipt(
  references: readonly SelectedProblemReference[],
  receipt: void | ProblemReferenceAddReceipt,
): ProblemReferenceAddReceipt {
  if (!receipt) return { acceptedIds: references.map(reference => reference.problem.id) }
  const requested = new Set(references.map(reference => reference.problem.id))
  const accepted = new Set(receipt.acceptedIds)
  const rejected = new Map((receipt.rejected || []).map(item => [item.id, item.message]))
  if (accepted.size !== receipt.acceptedIds.length || [...accepted].some(id => !requested.has(id))
    || [...rejected.keys()].some(id => !requested.has(id) || accepted.has(id))) {
    throw new Error('选入回执与当前题目不一致，输入已保留，请核对列表')
  }
  return {
    acceptedIds: [...accepted],
    rejected: references.filter(reference => !accepted.has(reference.problem.id)).map(reference => ({
      id: reference.problem.id, message: rejected.get(reference.problem.id) || '未选入当前表单，请重试',
    })),
  }
}

/** Cancels transport and invalidates callbacks even when the transport ignores AbortSignal. */
export class ProblemReferenceOperation {
  private generation = 0
  private controller: AbortController | null = null
  private runningKey: string | null = null

  isRunning(key: string): boolean { return this.runningKey === key && !this.controller?.signal.aborted }

  cancel(): void {
    this.generation += 1
    this.controller?.abort()
    this.controller = null
    this.runningKey = null
  }

  begin(key: string): ProblemReferenceAddContext {
    this.cancel()
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    this.runningKey = key
    return { signal: controller.signal, isCurrent: () => generation === this.generation && !controller.signal.aborted }
  }

  finish(operation: ProblemReferenceAddContext): void {
    if (operation.isCurrent()) this.runningKey = null
  }
}
