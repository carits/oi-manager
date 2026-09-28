import { normalizeOjPlatformKey } from '@oi-manager/shared'
import type { EndpointBody, ResolvedProblemSelection } from '@oi-manager/contracts'
import { ProblemSelectionContracts } from '@oi-manager/contracts'
import { findPrimaryProblemIdentities, primaryIdentityKey } from '../problem/problem.identity'
import { prisma } from '../../prisma'

type AuthUser = NonNullable<Express.Request['user']>
type Body = EndpointBody<typeof ProblemSelectionContracts.resolve>

/** Read-only primary-identity lookup. No bindings, UUID fallback or remote IO. */
export async function resolveProblemSelection(user: AuthUser, body: Body) {
  const inputs = body.items.map(input => ({
    clientKey: input.clientKey,
    platform: normalizeOjPlatformKey(input.platform),
    problemCode: input.problemCode.trim(),
  }))
  const identities = inputs.flatMap(input => input.platform
    ? [{ platform: input.platform, problemId: input.problemCode }]
    : [])

  // Selection, legacy callers and ordinary submissions share the same authorization
  // and conflict rules. Stable readiness is enrichment, never identity resolution.
  const matches = await findPrimaryProblemIdentities(user, identities)
  const visibleIds = [...new Set([...matches.values()].flatMap(match =>
    match.kind === 'found' ? [match.problem.id] : []))]
  const slots = visibleIds.length ? await prisma.problemTestSetSlot.findMany({
    where: { problemId: { in: visibleIds }, slot: 'STABLE' },
    select: { problemId: true, graphHash: true, fencingToken: true, mode: true },
  }) : []
  const stableByProblem = new Map(slots.map(slot => [slot.problemId, slot]))

  const items: ResolvedProblemSelection[] = inputs.map(input => {
    const base = { clientKey: input.clientKey, platform: input.platform || '', problemCode: input.problemCode }
    if (!input.platform) return { ...base, status: 'invalid_input', message: '平台名称未注册，请选择有效的 OJ 平台' }
    const match = matches.get(primaryIdentityKey({ platform: input.platform, problemId: input.problemCode }))
    if (match?.kind === 'identity_conflict') return {
      ...base, status: 'identity_conflict',
      message: '当前范围存在多个相同平台和题号的记录，请联系管理员处理；系统未自动选择',
    }
    if (!match || match.kind !== 'found') return {
      ...base, status: 'not_found', message: '当前可访问题库中未找到该题',
    }
    const selected = match.problem
    const stable = stableByProblem.get(selected.id)
    const problem = {
      id: selected.id, platform: selected.platform, problemCode: selected.problemId,
      title: selected.title, difficulty: selected.difficulty,
      ...(stable ? { stableData: {
        slot: 'STABLE' as const, graphHash: stable.graphHash, fencingToken: stable.fencingToken,
        mode: stable.mode === 'oi' ? 'oi' as const : 'acm' as const,
      } } : {}),
    }
    if (!match.usable) return {
      ...base, status: 'not_published', problem,
      message: selected.status === 'archived' ? '已找到题目，但该题已归档' : '已找到题目，但该题尚未发布',
    }
    // Business save commands remain responsible for their own assessment requirements.
    return { ...base, status: 'resolved', problem }
  })
  return { items }
}
