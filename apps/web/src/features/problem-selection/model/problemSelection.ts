import type { ResolvedProblemSelection } from '@oi-manager/contracts'

export type SelectedCanonicalProblem = NonNullable<ResolvedProblemSelection['problem']>

export function parseProblemCodes(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(/[\s,;，；]+/u)
    .map(item => item.trim())
    .filter(item => item.length > 0 && !seen.has(item) && Boolean(seen.add(item)))
    .slice(0, 100)
}

