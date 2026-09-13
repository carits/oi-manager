import crypto from 'crypto'
import { prisma } from '../../../prisma'
import type { AuthRequest } from '../../../middleware/auth'
import { isPersonalContextForTeams } from '../../../middleware/auth'
import { teamService } from '../team.service'
import { requestHasOrganizationCapability } from '../../authorization/capabilities'

type AuthUser = NonNullable<AuthRequest['user']>

export class TeamProblemListError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'TeamProblemListError'
  }
}

function fail(statusCode: number, message: string): never { throw new TeamProblemListError(statusCode, message) }

async function scopedTeam(teamId: string, user: AuthUser) {
  try {
    return await teamService.assertTeamScope(teamId, user)
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_SCOPE_MISMATCH') fail(403, '该团队不属于当前使用模式')
    throw error
  }
}

async function managementRole(user: AuthUser, teamId: string) {
  if (!isPersonalContextForTeams(user) && user.accountRole === 'super_admin') return 'super_admin'
  const member = await prisma.teamMember.findFirst({ where: { teamId, userId: user.userId, status: 'active' } })
  if (member?.role === 'owner' || member?.role === 'admin') return member.role
  if (member?.userType === 'teacher' && requestHasOrganizationCapability(user, 'team.create')) return 'teacher'
  return null
}

export async function listTeamProblemLists(user: AuthUser, teamId: string) {
  const team = await scopedTeam(teamId, user)
  if (isPersonalContextForTeams(user) || (user.accountRole !== 'super_admin' && user.accountRole !== 'platform_admin')) {
    const member = await prisma.teamMember.findFirst({ where: { teamId, userId: user.userId, status: 'active' } })
    if (!member) fail(403, '无权限查看该团队题单')
  }
  const items = await prisma.teamProblemList.findMany({
    where: { teamId, ProblemList: { scope: team.scope } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      ProblemList: {
        select: {
          id: true, title: true, description: true, ownerId: true, ownerType: true, scope: true,
          _count: { select: { ProblemListSection: true } },
        },
      },
    },
  })
  return Promise.all(items.map(async item => {
    const entryCount = await prisma.problemListEntry.count({
      where: { ProblemListSection: { problemListId: item.problemListId } },
    })
    const [ownerUser, addedByUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: item.ProblemList.ownerId }, select: { username: true } }),
      prisma.user.findUnique({ where: { id: item.addedBy }, select: { username: true } }),
    ])
    let ownerName = ownerUser?.username || '未知'
    let addedByName = addedByUser?.username || '未知'
    if (team.scope === 'campus' && team.organizationId) {
      const memberships = await prisma.organizationMembership.findMany({
        where: { organizationId: team.organizationId, userId: { in: [item.ProblemList.ownerId, item.addedBy] } },
        select: { userId: true, TeacherProfile: { select: { name: true } }, StudentProfile: { select: { name: true } } },
      })
      const displayName = (userId: string, fallback: string) => {
        const member = memberships.find(entry => entry.userId === userId)
        return member?.TeacherProfile?.name || member?.StudentProfile?.name || fallback
      }
      ownerName = displayName(item.ProblemList.ownerId, ownerName)
      addedByName = displayName(item.addedBy, addedByName)
    }
    return {
      id: item.id,
      problemListId: item.problemListId,
      addedBy: item.addedBy,
      addedByName,
      addedByRole: item.addedByRole,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
      problemList: {
        id: item.ProblemList.id,
        title: item.ProblemList.title,
        description: item.ProblemList.description,
        ownerId: item.ProblemList.ownerId,
        ownerName,
        ownerType: item.ProblemList.ownerType,
        sectionCount: item.ProblemList._count.ProblemListSection,
        entryCount,
      },
    }
  }))
}

export async function addTeamProblemList(user: AuthUser, teamId: string, problemListId: unknown) {
  await scopedTeam(teamId, user)
  if (!isPersonalContextForTeams(user) && !requestHasOrganizationCapability(user, 'team.create')) fail(403, '当前校园权限不能添加团队题单')
  if (typeof problemListId !== 'string' || !problemListId) fail(400, '缺少 problemListId')
  const teamRole = await managementRole(user, teamId)
  if (!teamRole) fail(403, '只有团队管理员或教师成员可添加题单')
  const [list, team] = await Promise.all([
    prisma.problemList.findUnique({ where: { id: problemListId } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { scope: true } }),
  ])
  if (!list || !team || list.scope !== team.scope) fail(404, '题单不存在')
  if (list.ownerId !== user.userId) fail(403, '只能添加自己是 owner 的题单')
  if (await prisma.teamProblemList.findUnique({ where: { teamId_problemListId: { teamId, problemListId } } })) {
    fail(409, '该题单已在团队题单库中')
  }
  return prisma.teamProblemList.create({
    data: {
      id: crypto.randomUUID(), teamId, problemListId, addedBy: user.userId,
      addedByRole: teamRole,
    },
  })
}

export async function removeTeamProblemList(user: AuthUser, teamId: string, id: string) {
  await scopedTeam(teamId, user)
  if (!isPersonalContextForTeams(user) && !requestHasOrganizationCapability(user, 'team.create')) fail(403, '当前校园权限不能移除团队题单')
  const item = await prisma.teamProblemList.findUnique({ where: { id } })
  if (!item) fail(404, '记录不存在')
  if (item.teamId !== teamId) fail(400, '题单不属于该团队')
  if (isPersonalContextForTeams(user) || user.accountRole !== 'super_admin') {
    const member = await prisma.teamMember.findFirst({ where: { teamId, userId: user.userId, status: 'active' } })
    if (member?.role !== 'owner' && item.addedBy !== user.userId) fail(403, '只能移除自己添加的题单')
  }
  await prisma.teamProblemList.delete({ where: { id } })
}
