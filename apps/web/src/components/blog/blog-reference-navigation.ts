import type { BlogVisibility, PublishedBlogReferenceType } from './blog-contract'
import type { NavigationContext } from '@/lib/navigationContext'

export type PublishedBlogReference = {
  id: string
  type: PublishedBlogReferenceType
  referenceId: string
  referenceVersionId?: string | null
  accessMode: BlogVisibility
  status: string
  snapshot?: unknown
}

function scopedProblemHref(problemId: string, organizationId: string | null | undefined, tab: string | undefined, context?: NavigationContext | null) {
  const base = organizationId
    ? `/org/${encodeURIComponent(organizationId)}/problems/${encodeURIComponent(problemId)}`
    : context?.workspace === 'platform'
      ? `${context.platformBasePath || '/platform-admin'}/problems/${encodeURIComponent(problemId)}`
      : context?.workspace === 'personal'
        ? `/personal/problems/${encodeURIComponent(problemId)}`
        : null
  if (!base) return null
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base
}

export function referenceHref(reference: PublishedBlogReference, context?: NavigationContext | null) {
  const snapshot = (reference.snapshot || {}) as Record<string, any>
  if (reference.type === 'PROBLEM' || reference.type === 'PROBLEM_REVISION') {
    return scopedProblemHref(reference.referenceId, snapshot.organizationId, undefined, context)
  }
  if (reference.type === 'SOLUTION_VERSION' && snapshot.problem?.id) {
    return scopedProblemHref(snapshot.problem.id, snapshot.problem.organizationId, 'solution', context)
  }
  if (reference.type === 'CONTEST_STANDING') {
    const trainingId = snapshot.trainingId || reference.referenceId
    return snapshot.organizationId
      ? `/org/${encodeURIComponent(snapshot.organizationId)}/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
      : context?.workspace === 'platform'
        ? `${context.platformBasePath || '/platform-admin'}/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
        : context?.workspace === 'personal'
          ? `/personal/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
          : null
  }
  if (reference.type === 'RATING_CHANGE' && snapshot.contest?.id) {
    return snapshot.organizationId
      ? `/org/${encodeURIComponent(snapshot.organizationId)}/contests/${encodeURIComponent(String(snapshot.contest.id))}?tab=ranking`
      : context?.workspace === 'platform'
        ? `${context.platformBasePath || '/platform-admin'}/contests/${encodeURIComponent(String(snapshot.contest.id))}?tab=ranking`
        : context?.workspace === 'personal'
          ? `/personal/contests/${encodeURIComponent(String(snapshot.contest.id))}?tab=ranking`
          : null
  }
  return null
}
