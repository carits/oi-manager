import type { BlogVisibility, PublishedBlogReferenceType } from '../model/blog-contract'
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
  const snapshot = (reference.snapshot || {}) as Record<string, unknown>
  const snapshotProblem = snapshot.problem && typeof snapshot.problem === 'object'
    ? snapshot.problem as Record<string, unknown>
    : null
  const snapshotContest = snapshot.contest && typeof snapshot.contest === 'object'
    ? snapshot.contest as Record<string, unknown>
    : null
  if (reference.type === 'PROBLEM' || reference.type === 'PROBLEM_REVISION') {
    return scopedProblemHref(reference.referenceId, typeof snapshot.organizationId === 'string' ? snapshot.organizationId : null, undefined, context)
  }
  if (reference.type === 'SOLUTION_VERSION' && typeof snapshotProblem?.id === 'string') {
    return scopedProblemHref(snapshotProblem.id, typeof snapshotProblem.organizationId === 'string' ? snapshotProblem.organizationId : null, 'solution', context)
  }
  if (reference.type === 'CONTEST_STANDING') {
    const trainingId = snapshot.trainingId || reference.referenceId
    return typeof snapshot.organizationId === 'string'
      ? `/org/${encodeURIComponent(snapshot.organizationId)}/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
      : context?.workspace === 'platform'
        ? `${context.platformBasePath || '/platform-admin'}/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
        : context?.workspace === 'personal'
          ? `/personal/contests/${encodeURIComponent(String(trainingId))}?tab=ranking`
          : null
  }
  if (reference.type === 'RATING_CHANGE' && snapshotContest?.id) {
    return typeof snapshot.organizationId === 'string'
      ? `/org/${encodeURIComponent(snapshot.organizationId)}/contests/${encodeURIComponent(String(snapshotContest.id))}?tab=ranking`
      : context?.workspace === 'platform'
        ? `${context.platformBasePath || '/platform-admin'}/contests/${encodeURIComponent(String(snapshotContest.id))}?tab=ranking`
        : context?.workspace === 'personal'
          ? `/personal/contests/${encodeURIComponent(String(snapshotContest.id))}?tab=ranking`
          : null
  }
  return null
}
