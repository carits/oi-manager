import type { BlogVisibility, PublishedBlogReferenceType } from './blog-contract'

export type PublishedBlogReference = {
  id: string
  type: PublishedBlogReferenceType
  referenceId: string
  referenceVersionId?: string | null
  accessMode: BlogVisibility
  status: string
  snapshot?: unknown
}

function scopedProblemHref(problemId: string, organizationId?: string | null, tab?: string) {
  const base = organizationId
    ? `/org/${encodeURIComponent(organizationId)}/problems/${encodeURIComponent(problemId)}`
    : `/personal/problems/${encodeURIComponent(problemId)}`
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base
}

export function referenceHref(reference: PublishedBlogReference) {
  const snapshot = (reference.snapshot || {}) as Record<string, any>
  if (reference.type === 'PROBLEM' || reference.type === 'PROBLEM_REVISION') {
    return scopedProblemHref(reference.referenceId, snapshot.organizationId)
  }
  if (reference.type === 'SOLUTION_VERSION' && snapshot.problem?.id) {
    return scopedProblemHref(snapshot.problem.id, snapshot.problem.organizationId, 'solution')
  }
  if (reference.type === 'CONTEST_STANDING') {
    const trainingId = snapshot.trainingId || reference.referenceId
    return snapshot.organizationId
      ? `/org/${encodeURIComponent(snapshot.organizationId)}/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
      : `/personal/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
  }
  if (reference.type === 'RATING_CHANGE' && snapshot.contest?.id) {
    return snapshot.organizationId
      ? `/org/${encodeURIComponent(snapshot.organizationId)}/contests/${encodeURIComponent(String(snapshot.contest.id))}?tab=ranking`
      : `/personal/contests/${encodeURIComponent(String(snapshot.contest.id))}?tab=ranking`
  }
  return null
}
