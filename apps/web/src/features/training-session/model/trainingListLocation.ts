import type { TrainingListStatus } from './trainingListScope'
export interface TrainingListLocation { status: TrainingListStatus; keyword: string; page: number; teamId: string }
const statuses = new Set<string>(['active', 'upcoming', 'completed'])

export function readTrainingListLocation(params: URLSearchParams, prefix = ''): TrainingListLocation {
  const status = params.get(`${prefix}status`)
  const page = Number(params.get(`${prefix}page`) || '1')
  return {
    status: statuses.has(status || '') ? status as TrainingListStatus : 'active',
    keyword: (params.get(`${prefix}q`) || '').slice(0, 200),
    page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1,
    teamId: params.get(`${prefix}teamId`) || '',
  }
}

export function updateTrainingListLocation(params: URLSearchParams, patch: Partial<TrainingListLocation>, prefix = ''): URLSearchParams {
  const current = readTrainingListLocation(params, prefix)
  const next = { ...current, ...patch }
  if (patch.page === undefined && (patch.status !== undefined || patch.keyword !== undefined || patch.teamId !== undefined)) next.page = 1
  const result = new URLSearchParams(params)
  const entries: Array<[string, string, string]> = [
    ['status', next.status, 'active'], ['q', next.keyword.trim().slice(0, 200), ''],
    ['page', String(next.page), '1'], ['teamId', next.teamId, ''],
  ]
  for (const [name, value, defaultValue] of entries) value === defaultValue ? result.delete(prefix + name) : result.set(prefix + name, value)
  return result
}
