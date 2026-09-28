import { normalizeOjPlatformKey } from '@oi-manager/shared'
import type { EndpointBody, ResolvedProblemSelection } from '@oi-manager/contracts'
import { ProblemSelectionContracts } from '@oi-manager/contracts'
import { canUseProblem, canViewProblem } from '../problem/problem.access'
import { prisma } from '../../prisma'

type AuthUser = NonNullable<Express.Request['user']>
type Body = EndpointBody<typeof ProblemSelectionContracts.resolve>
const identityKey = (platform: string, problemId: string) => JSON.stringify([platform, problemId])

/** Read-only primary-identity lookup. No bindings, UUID fallback or remote IO. */
export async function resolveProblemSelection(user: AuthUser, body: Body) {
  const inputs = body.items.map(input => ({
    clientKey: input.clientKey,
    platform: normalizeOjPlatformKey(input.platform),
    problemCode: input.problemCode.trim(),
  }))
  const identities = new Map<string, { platform: string; problemId: string }>()
  for (const input of inputs) {
    if (input.platform) identities.set(identityKey(input.platform, input.problemCode), {
      platform: input.platform, problemId: input.problemCode,
    })
  }
  // Keep the existing ownership boundary until the separately approved data migration.
  // Query each exact pair together; independent IN clauses could cross-match pairs.
  const records = identities.size ? await prisma.problem.findMany({
    where: {
      AND: [
        { OR: [...identities.values()] },
        { OR: [
          { libraryScope: 'platform' },
          ...(user.organizationId ? [{ libraryScope: 'school', organizationId: user.organizationId }] : []),
        ] },
      ],
    },
    select: {
      id: true, platform: true, problemId: true, title: true, difficulty: true,
      libraryScope: true, organizationId: true, ownerId: true, status: true, visibility: true,
      TestSetSlots: { where: { slot: 'STABLE' }, select: { graphHash: true, fencingToken: true, mode: true } },
    },
  }) : []
  const visibleByIdentity = new Map<string, typeof records>()
  for (const record of records) {
    // Never reveal the existence, name or duplicates of a private inaccessible problem.
    if (!canUseProblem(user, record) && !canViewProblem(user, record)) continue
    const key = identityKey(record.platform, record.problemId)
    const matches = visibleByIdentity.get(key) || []
    matches.push(record)
    visibleByIdentity.set(key, matches)
  }
  const items: ResolvedProblemSelection[] = inputs.map(input => {
    const base = { clientKey: input.clientKey, platform: input.platform || '', problemCode: input.problemCode }
    if (!input.platform) return { ...base, status: 'invalid_input', message: '平台名称未注册，请选择有效的 OJ 平台' }
    const matches = visibleByIdentity.get(identityKey(input.platform, input.problemCode)) || []
    if (!matches.length) return { ...base, status: 'not_found', message: '当前可访问题库中未找到该题' }
    if (matches.length !== 1) return {
      ...base, status: 'identity_conflict',
      message: '当前范围存在多个相同平台和题号的记录，请联系管理员处理；系统未自动选择',
    }
    const selected = matches[0]
    const stable = selected.TestSetSlots[0]
    const problem = {
      id: selected.id, platform: selected.platform, problemCode: selected.problemId,
      title: selected.title, difficulty: selected.difficulty,
      ...(stable ? { stableData: {
        slot: 'STABLE' as const, graphHash: stable.graphHash, fencingToken: stable.fencingToken,
        mode: stable.mode === 'oi' ? 'oi' as const : 'acm' as const,
      } } : {}),
    }
    if (!canUseProblem(user, selected)) return {
      ...base, status: 'not_published', problem,
      message: selected.status === 'archived' ? '已找到题目，但该题已归档' : '已找到题目，但该题尚未发布',
    }
    // Missing Stable data does not mean the primary identity was not found.
    // Business save commands remain responsible for their own assessment requirements.
    return { ...base, status: 'resolved', problem }
  })
  return { items }
}
