export type JudgeLane = 'submission' | 'hack' | 'generation'

export function judgeLaneForDispatch(cursor: number): JudgeLane {
  const slot = ((Math.trunc(cursor) % 10) + 10) % 10
  if (slot < 8) return 'submission'
  return slot === 8 ? 'hack' : 'generation'
}
