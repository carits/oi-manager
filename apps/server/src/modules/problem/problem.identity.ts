import type { Prisma } from '@prisma/client'
import { normalizeOjPlatformKey, type JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { canUseProblem, canViewProblem } from './problem.authorization'

export class ProblemIdentityError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string, public readonly data?: unknown) {
    super(message)
    this.name = 'ProblemIdentityError'
  }
}

export type PrimaryProblemIdentity = { platform: string; problemId: string }
export const primaryIdentityKey = (value: PrimaryProblemIdentity) => JSON.stringify([value.platform, value.problemId])

export function normalizePrimaryProblemIdentity(platformInput: unknown, numberInput: unknown): PrimaryProblemIdentity {
  const platform = typeof platformInput === 'string' ? normalizeOjPlatformKey(platformInput) : null
  if (!platform) throw new ProblemIdentityError(400, 'INVALID_OJ_PLATFORM', '平台名称未注册，请选择有效的 OJ 平台')
  if (typeof numberInput !== 'string' || !numberInput.trim() || numberInput.trim().length > 128) {
    throw new ProblemIdentityError(400, 'INVALID_PROBLEM_NUMBER', '题号必须是 1 至 128 个字符的字符串')
  }
  return { platform, problemId: numberInput.trim() }
}

export function normalizeProblemOjBindings(input: unknown) {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.length > 3) throw new ProblemIdentityError(400, 'INVALID_OJ_BINDINGS', '附加来源必须是数组，最多 3 项')
  return input.map(item => {
    if (!item || typeof item !== 'object') throw new ProblemIdentityError(400, 'INVALID_OJ_BINDINGS', '附加来源格式无效')
    const identity = normalizePrimaryProblemIdentity(item.platform, item.problemId)
    if (item.url !== undefined && typeof item.url !== 'string') throw new ProblemIdentityError(400, 'INVALID_OJ_BINDINGS', '来源链接必须是字符串')
    return { ...identity, ...(item.url !== undefined ? { url: item.url as string } : {}) }
  })
}

const identitySelect = {
  id: true, platform: true, problemId: true, title: true, difficulty: true,
  libraryScope: true, organizationId: true, ownerId: true, status: true, visibility: true,
} as const satisfies Prisma.ProblemSelect
export type PrimaryProblemRecord = Prisma.ProblemGetPayload<{ select: typeof identitySelect }>
export type PrimaryProblemMatch =
  | { kind: 'found'; problem: PrimaryProblemRecord; usable: boolean }
  | { kind: 'not_found' | 'identity_conflict' }

/** Only primary columns are searched. Authorization may hide a result, never substitute another identity. */
export async function findPrimaryProblemIdentities(
  user: JwtPayload,
  identities: readonly PrimaryProblemIdentity[],
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, PrimaryProblemMatch>> {
  const unique = new Map(identities.map(identity => [primaryIdentityKey(identity), identity]))
  const matches = new Map<string, PrimaryProblemRecord[]>()
  if (unique.size) {
    const rows = await client.problem.findMany({
      where: { AND: [
        { OR: [...unique.values()] },
        { OR: [{ libraryScope: 'platform' }, ...(user.organizationId ? [{ libraryScope: 'school', organizationId: user.organizationId }] : [])] },
      ] },
      select: identitySelect,
    })
    for (const row of rows) {
      if (!canViewProblem(user, row) && !canUseProblem(user, row)) continue
      const key = primaryIdentityKey(row)
      const group = matches.get(key) || []
      group.push(row)
      matches.set(key, group)
    }
  }
  return new Map([...unique.keys()].map(key => {
    const group = matches.get(key) || []
    const result: PrimaryProblemMatch = !group.length ? { kind: 'not_found' }
      : group.length > 1 ? { kind: 'identity_conflict' }
      : { kind: 'found', problem: group[0], usable: canUseProblem(user, group[0]) }
    return [key, result]
  }))
}

export async function findPrimaryUsableProblem(user: JwtPayload, rawPlatform: unknown, rawNumber: unknown, client: Prisma.TransactionClient = prisma) {
  const identity = normalizePrimaryProblemIdentity(rawPlatform, rawNumber)
  const result = (await findPrimaryProblemIdentities(user, [identity], client)).get(primaryIdentityKey(identity))!
  if (result.kind === 'identity_conflict') throw new ProblemIdentityError(409, 'PROBLEM_IDENTITY_CONFLICT', '相同平台和题号存在多个可访问记录，系统未自动选择')
  if (result.kind !== 'found' || !result.usable) return null
  const problem = await client.problem.findUnique({ where: { id: result.problem.id } })
  return problem && canUseProblem(user, problem) ? problem : null
}

/** Write-time collision detection only; never used as a lookup fallback. Does not repair legacy rows. */
export async function assertPrimaryIdentityAvailable(client: Prisma.TransactionClient, libraryKey: string, identity: PrimaryProblemIdentity, exceptId?: string) {
  const candidates = await client.problem.findMany({
    where: { libraryKey, problemId: identity.problemId }, select: { id: true, platform: true },
  })
  if (candidates.some(row => row.id !== exceptId && normalizeOjPlatformKey(row.platform) === identity.platform)) {
    throw new ProblemIdentityError(409, 'PROBLEM_EXISTS', '当前题库存在相同主身份或待清理的历史平台名称，未创建或覆盖题目')
  }
}

export async function canChangePrimaryIdentity(client: Prisma.TransactionClient, problem: { id: string; status: string; publishedAt: Date | null }) {
  if (problem.status !== 'draft' || problem.publishedAt) return false
  const [references, submissions] = await Promise.all([
    client.problem.findUnique({ where: { id: problem.id }, select: { _count: { select: {
      ProblemListEntry: true, AssignmentProblem: true, ContestProblems: true,
      TrainingSessionStageProblem: true, CopiedProblems: true, BlogReferences: true,
    } } } }),
    client.submission.count({ where: { problemInternalId: problem.id } }),
  ])
  return Boolean(references) && submissions === 0 && Object.values(references!._count).every(count => count === 0)
}
