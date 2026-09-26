import yaml from 'js-yaml'
export function revisionDataLayout(revision: any) {
  return revision.mode === 'acm'
    ? {
        mode: revision.mode,
        cases: revision.AcmCases.map((item: any) => ({
          testcaseId: item.testcaseId,
          inputObjectId: item.inputObjectId,
          outputObjectId: item.outputObjectId,
          inputName: item.inputName,
          outputName: item.outputName,
          orderIndex: item.orderIndex,
          time: item.time,
          memory: item.memory,
          source: item.source,
        })),
      }
    : {
        mode: revision.mode,
        subtasks: revision.Subtasks.map((subtask: any) => ({
          subtaskId: subtask.subtaskId,
          orderIndex: subtask.orderIndex,
          groups: subtask.Groups.map((group: any) => ({
            kind: group.kind,
            orderIndex: group.orderIndex,
            cases: group.Cases.map((item: any) => ({
              testcaseId: item.testcaseId,
              inputObjectId: item.inputObjectId,
              outputObjectId: item.outputObjectId,
              inputName: item.inputName,
              outputName: item.outputName,
              orderIndex: item.orderIndex,
              time: item.time,
              memory: item.memory,
              source: item.source,
            })),
          })),
        })),
      }
}

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

export function nonScoringJudgeConfig(configText: string) {
  const parsed = (yaml.load(configText) || {}) as Record<string, any>
  const { subtasks: _subtasks, ...rest } = parsed
  return stableValue(rest)
}

export function isAllowedRepairSuccessor(current: { id: string; mode: string }, target: {
  parentRevisionId: string | null
  mode: string
  source: string
}) {
  return target.parentRevisionId === current.id
    && target.mode === current.mode
    && (target.source === 'admin_edit' || target.source === 'initial')
}
