import { prisma } from '../../../prisma'
import { getMembershipType, getResourceScope } from '../../../middleware/auth'

export type ProblemListPermission = 'admin' | 'edit' | 'view'

const permissionOrder: Record<ProblemListPermission, number> = { admin: 3, edit: 2, view: 1 }
const managedProblemFilePatterns = [
  /\/api\/files\/([^/?#]+)\/(?:download|public)/g,
  /\/api\/files\/download\/([^/?#]+)/g,
]

export async function generateProblemListId(length = 7): Promise<string> {
  const min = Math.pow(10, length - 1)
  const max = Math.pow(10, length) - 1
  let id = String(min + Math.floor(Math.random() * (max - min + 1)))
  while (await prisma.problemList.findUnique({ where: { id }, select: { id: true } })) {
    id = await generateProblemListId(length + 1)
  }
  return id
}

export function extractManagedProblemFileId(value: string | null | undefined): string | null {
  if (!value) return null
  for (const pattern of managedProblemFilePatterns) {
    pattern.lastIndex = 0
    const match = pattern.exec(value)
    if (match?.[1]) return match[1]
  }
  return null
}

export function collectManagedProblemFileIds(content: string | null | undefined) {
  const ids: string[] = []
  if (!content) return ids
  for (const pattern of managedProblemFilePatterns) {
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) if (match[1]) ids.push(match[1])
  }
  return ids
}

export function problemListFileUrl(listId: string, entryId: string, value: string | null | undefined) {
  const fileId = extractManagedProblemFileId(value)
  return fileId ? `/api/problem-lists/${listId}/entries/${entryId}/files/${fileId}` : value ?? null
}

export function rewriteProblemListFileUrls(listId: string, entryId: string, content: string | null | undefined) {
  if (!content) return content ?? null
  let rewritten = content
  for (const pattern of managedProblemFilePatterns) {
    pattern.lastIndex = 0
    rewritten = rewritten.replace(pattern, (_url, fileId: string) =>
      `/api/problem-lists/${listId}/entries/${entryId}/files/${fileId}`)
  }
  return rewritten
}

function maxPermission(a: ProblemListPermission | null, b: ProblemListPermission | null) {
  if (!a) return b
  if (!b) return a
  return permissionOrder[a] >= permissionOrder[b] ? a : b
}

export async function getProblemListPermission(
  problemListId: string,
  user: NonNullable<Express.Request['user']>,
): Promise<ProblemListPermission | null> {
  const list = await prisma.problemList.findUnique({
    where: { id: problemListId },
    select: { ownerId: true, scope: true, organizationId: true },
  })
  const scope = getResourceScope(user)
  if (!list || list.scope !== scope) return null
  if (scope === 'campus') {
    if (!user.organizationId || list.organizationId !== user.organizationId) return null
  } else if (list.organizationId !== null) {
    return null
  }
  if (list.ownerId === user.userId) return 'admin'

  const shares = await prisma.problemListShare.findMany({ where: { problemListId } })
  let best: ProblemListPermission | null = null
  for (const share of shares) {
    if (share.targetType === getMembershipType(user) && share.targetId === user.userId) {
      best = maxPermission(best, share.permission as ProblemListPermission)
    }
  }
  if (user.organizationId && getMembershipType(user) !== 'student') {
    const schoolLink = await prisma.schoolProblemList.findFirst({
      where: { organizationId: user.organizationId, problemListId },
      select: { id: true },
    })
    if (schoolLink) best = maxPermission(best, 'view')
  }
  const teamIds = (await prisma.teamMember.findMany({
    where: {
      userId: user.userId,
      userType: getMembershipType(user),
      status: 'active',
      Team: {
        scope,
        ...(scope === 'campus' ? { organizationId: user.organizationId! } : { organizationId: null }),
      },
    },
    select: { teamId: true },
  })).map(member => member.teamId)
  if (teamIds.length > 0) {
    const teamLink = await prisma.teamProblemList.findFirst({
      where: { teamId: { in: teamIds }, problemListId },
      select: { id: true },
    })
    if (teamLink) best = maxPermission(best, 'view')
  }
  return best
}

export function checkProblemListOptimisticLock(expectedUpdatedAt: string | undefined, currentUpdatedAt: string | Date) {
  if (!expectedUpdatedAt) return true
  return new Date(currentUpdatedAt).getTime() === new Date(expectedUpdatedAt).getTime()
}

export async function getEntryProblemListId(entryId: string) {
  const entry = await prisma.problemListEntry.findUnique({
    where: { id: entryId },
    select: { ProblemListSection: { select: { problemListId: true } } },
  })
  return entry?.ProblemListSection?.problemListId || null
}

export async function getSectionProblemListId(sectionId: string) {
  const section = await prisma.problemListSection.findUnique({ where: { id: sectionId }, select: { problemListId: true } })
  return section?.problemListId || null
}
