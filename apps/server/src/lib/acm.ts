const ACCEPTED_RESULTS = new Set(['Accepted', 'AC', 'accepted', 'ac'])
const PENDING_RESULTS = new Set(['queuing', 'Judging', 'judging', 'pending', ''])

export type AcmOutcome = 'accepted' | 'failed' | 'pending'

export function acmOutcome(result: string | null | undefined): AcmOutcome {
  if (result == null || PENDING_RESULTS.has(result)) return 'pending'
  return ACCEPTED_RESULTS.has(result) ? 'accepted' : 'failed'
}

export function acmScore(result: string | null | undefined): number | null {
  const outcome = acmOutcome(result)
  return outcome === 'pending' ? null : outcome === 'accepted' ? 100 : 0
}
