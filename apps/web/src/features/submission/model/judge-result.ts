export interface JudgeCaseResult {
  caseId?: number | string
  subtaskId?: number | string
  result: string
  time?: number | null
  memory?: number | null
  score?: number | null
  message?: string | null
}

export interface JudgeSubtaskResult {
  id: number | string
  type: string
  score: number
  cases: JudgeCaseResult[]
}

export type JudgeResultRow =
  | { kind: 'subtask'; subtask: JudgeSubtaskResult }
  | { kind: 'case'; index: number; testCase: JudgeCaseResult }

export function buildJudgeResultRows(
  judgeMode: 'acm' | 'oi',
  cases: JudgeCaseResult[] | null | undefined,
  subtasks: JudgeSubtaskResult[] | null | undefined,
): JudgeResultRow[] {
  if (judgeMode === 'oi' && subtasks?.length) {
    let index = 0
    return subtasks.flatMap(subtask => [
      { kind: 'subtask', subtask } as const,
      ...subtask.cases.map(testCase => ({ kind: 'case', index: index++, testCase }) as const),
    ])
  }
  return (cases || []).map((testCase, index) => ({ kind: 'case', index, testCase }))
}

export function firstFailedCaseIndex(cases: JudgeCaseResult[] | null | undefined): number {
  return (cases || []).findIndex(testCase =>
    !['Accepted', 'accepted', 'Skipped', 'skipped'].includes(testCase.result),
  )
}

export function formatJudgeMemory(memoryKiB?: number | null): string {
  if (memoryKiB == null) return '-'
  if (memoryKiB >= 1024) return `${(memoryKiB / 1024).toFixed(2)} MB`
  return `${memoryKiB} KB`
}
