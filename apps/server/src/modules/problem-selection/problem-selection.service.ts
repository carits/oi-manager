import { normalizeOjPlatformKey } from '@oi-manager/shared'
import type { EndpointBody } from '@oi-manager/contracts'
import { ProblemSelectionContracts } from '@oi-manager/contracts'
import { findAccessibleProblem, findUsableProblemByExternalId } from '../problem/problem.access'
import { prisma } from '../../prisma'

type AuthUser = NonNullable<Express.Request['user']>
type Body = EndpointBody<typeof ProblemSelectionContracts.resolve>

export async function resolveProblemSelection(user: AuthUser, body: Body) {
  const items = []
  for (const input of body.items) {
    const platform = normalizeOjPlatformKey(input.platform)
    const problemCode = input.problemCode.trim()
    if (!platform) {
      items.push({
        clientKey: input.clientKey,
        platform: input.platform,
        problemCode,
        status: 'not_found' as const,
        message: '不支持的题目平台',
      })
      continue
    }

    let problem = platform === 'carits'
      ? await findAccessibleProblem(user, problemCode, 'use').catch(() => null)
      : null
    if (!problem) problem = await findUsableProblemByExternalId(user, platform, problemCode)

    if (!problem) {
      items.push({
        clientKey: input.clientKey,
        platform,
        problemCode,
        status: 'not_found' as const,
        message: '题库中未找到该题目，或当前账号无权使用',
      })
      continue
    }

    const selected = await prisma.problem.findUnique({
      where: { id: problem!.id },
      select: {
        id: true,
        platform: true,
        problemId: true,
        title: true,
        difficulty: true,
        LatestTestSetRevision: { select: { id: true, revisionNumber: true, mode: true } },
      },
    })
    if (!selected) {
      items.push({ clientKey: input.clientKey, platform, problemCode, status: 'not_found' as const })
      continue
    }
    const summary = {
      id: selected.id,
      platform: selected.platform,
      problemCode: selected.problemId,
      title: selected.title,
      difficulty: selected.difficulty,
      ...(selected.LatestTestSetRevision ? {
        latestRevision: {
          id: selected.LatestTestSetRevision.id,
          number: selected.LatestTestSetRevision.revisionNumber,
          mode: selected.LatestTestSetRevision.mode === 'oi' ? 'oi' as const : 'acm' as const,
        },
      } : {}),
    }
    items.push(selected.LatestTestSetRevision ? {
      clientKey: input.clientKey, platform, problemCode, status: 'resolved' as const, problem: summary,
    } : {
      clientKey: input.clientKey, platform, problemCode, status: 'revision_unavailable' as const, problem: summary,
      message: '该题尚无可用的正式评测版本',
    })
  }
  return { items }
}
