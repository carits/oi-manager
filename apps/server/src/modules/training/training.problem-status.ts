export const TRAINING_RESULT_DISPLAY: Record<string, string> = {
  accepted: 'Accepted',
  submitted: 'Submitted',
  queuing: 'Submitted',
  judging: 'Judging',
  wa: 'Wrong Answer',
  tle: 'Time Limit Exceeded',
  mle: 'Memory Limit Exceeded',
  re: 'Runtime Error',
  ce: 'Compilation Error',
  pe: 'Presentation Error',
  ole: 'Output Limit Exceeded',
  pending_review: 'Judging',
  remote_unavailable: 'Judge Error',
  judge_failed: 'Judge Error',
  unknown_error: 'Judge Error',
  submit_failed: 'Submit Failed',
}

export function buildContestProblemStatus(
  format: string,
  submissions: Array<{ result: string; score: number | null }>,
): { hasSubmitted: boolean; bestScore: number | null; bestResult: string | null; latestResult: string | null; hasAccepted: boolean; displayStatus: string | null } {
  if (submissions.length === 0) return { hasSubmitted: false, bestScore: null, bestResult: null, latestResult: null, hasAccepted: false, displayStatus: null }

  let best = submissions[0]
  for (const submission of submissions.slice(1)) {
    const score = submission.score ?? 0
    const bestScore = best.score ?? 0
    if (score > bestScore || (score === bestScore && submission.result === 'accepted' && best.result !== 'accepted')) best = submission
  }

  const hasAccepted = submissions.some(submission => submission.result === 'accepted')
  const latestResult = submissions[submissions.length - 1]?.result ?? null
  return {
    hasSubmitted: true,
    bestScore: best.score ?? 0,
    bestResult: best.result,
    latestResult,
    hasAccepted,
    displayStatus: format === 'icpc' ? (hasAccepted ? 'accepted' : latestResult || 'submitted') : latestResult,
  }
}