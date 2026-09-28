export interface FeatureSnapshot<T> {
  scope: string
  key: string
  data: T
}

/** Previous results may survive filter changes, never account/workspace changes. */
export function visibleFeatureData<T>(snapshot: FeatureSnapshot<T> | undefined, scope: string): T | undefined {
  return snapshot?.scope === scope ? snapshot.data : undefined
}

export function featureResourceKey(scope: string | null, key: string, enabled = true): readonly [string, string, string] | null {
  return enabled && scope ? ['feature-resource', scope, key] : null
}
