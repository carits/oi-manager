import crypto from 'crypto'
import { getMembershipType, getResourceScope, isPersonalContext, isPersonalContextForTeams } from '../../../middleware/auth'
import { prisma } from '../../../prisma'
import { getProblemListPermission } from './problem-list-access.service'
import { ProblemListApplicationError } from './problem-list-crud.service'

type AuthUser = NonNullable<Express.Request['user']>

function fail(statusCode: number, message: string): never { throw new ProblemListApplicationError(statusCode, message) }

async function ownedList(user: AuthUser, id: string) {
  const list = await prisma.problemList.findUnique({ where: { id } })
  const scope = getResourceScope(user)
  if (!list || list.scope !== scope) fail(404, '题单不存在')
  if (scope === 'campus' && (!user.organizationId || list.organizationId !== user.organizationId)) fail(404, '题单不存在')
  if (scope === 'personal' && list.organizationId !== null) fail(404, '题单不存在')
  if (list.ownerId !== user.userId) fail(403, '只有创建者可以管理分享')
  return list
}

export async function listProblemListShares(user: AuthUser, id: string) {
  if (await getProblemListPermission(id, user) !== 'admin') fail(403, '无权限管理分享')
  const shares = await prisma.problemListShare.findMany({ where: { problemListId: id }, orderBy: { createdAt: 'asc' } })
  return Promise.all(shares.map(async share => {
    const target = await prisma.user.findUnique({ where: { id: share.targetId }, select: { username: true, avatar: true } })
    return {
      ...share,
      targetName: target?.username || share.targetId,
      targetAvatar: target?.avatar || null,
      targetUsername: target?.username || '',
    }
  }))
}

export async function listProblemListShareCandidates(user: AuthUser, id: string, query: any) {
  const list = await ownedList(user, id)
  const personal = isPersonalContext(user)
  const requestedType = typeof query.type === 'string' ? query.type : 'teacher'
  const type = personal ? 'user' : requestedType
  if (!['user', 'teacher', 'student'].includes(type)) fail(400, '分享对象类型无效')
  const keyword = typeof query.keyword === 'string' ? query.keyword : ''
  const existingShares = await prisma.problemListShare.findMany({
    where: { problemListId: id, targetType: type }, select: { targetId: true },
  })
  const excluded = new Set(existingShares.map(share => share.targetId))
  excluded.add(list.ownerId)
  if (personal) {
    const users = await prisma.user.findMany({
      where: {
        id: { notIn: [...excluded] }, status: 'active', PersonalProfile: { isNot: null },
        ...(keyword ? { username: { contains: keyword, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true, username: true, avatar: true }, orderBy: { username: 'asc' }, take: 20,
    })
    return users.map(candidate => ({
      id: candidate.id, name: candidate.username, type: 'user', username: candidate.username, avatar: candidate.avatar,
    }))
  }
  if (!list.organizationId) return []
  const where: any = {
    organizationId: list.organizationId,
    status: 'active',
    memberRole: type === 'teacher' ? { in: ['teacher', 'school_principal'] } : 'student',
    userId: { notIn: [...excluded] },
  }
  if (keyword) {
    where.OR = [
      { User: { username: { contains: keyword, mode: 'insensitive' } } },
      ...(type === 'teacher'
        ? [{ TeacherProfile: { name: { contains: keyword, mode: 'insensitive' } } }]
        : [{ StudentProfile: { name: { contains: keyword, mode: 'insensitive' } } }]),
    ]
  }
  const memberships = await prisma.organizationMembership.findMany({
    where,
    select: {
      userId: true, memberRole: true,
      User: { select: { username: true, avatar: true } },
      TeacherProfile: { select: { name: true, avatar: true } },
      StudentProfile: { select: { name: true, avatar: true } },
    },
    take: 20,
  })
  return memberships.map(member => ({
    id: member.userId,
    name: member.TeacherProfile?.name || member.StudentProfile?.name || member.User.username,
    type: member.memberRole === 'student' ? 'student' : 'teacher',
    username: member.User.username,
    avatar: member.TeacherProfile?.avatar || member.StudentProfile?.avatar || member.User.avatar,
  }))
}

export async function upsertProblemListShare(user: AuthUser, id: string, body: any) {
  if (getMembershipType(user) === 'student' && !isPersonalContextForTeams(user)) {
    fail(403, '校园模式下学生不能管理题单分享')
  }
  const list = await ownedList(user, id)
  const targetType = body.targetType
  const targetId = typeof body.targetId === 'string' ? body.targetId : ''
  const permission = body.permission
  const allowedTypes = isPersonalContext(user) ? ['user'] : ['teacher', 'student']
  if (!allowedTypes.includes(targetType)) fail(400, '分享对象与当前工作区不匹配')
  if (permission !== 'view' && permission !== 'edit') fail(400, '无效的权限级别')
  if (!targetId || targetId === list.ownerId) fail(400, '分享对象无效')
  if (isPersonalContext(user)) {
    const target = await prisma.user.findFirst({
      where: { id: targetId, status: 'active', PersonalProfile: { isNot: null } }, select: { id: true },
    })
    if (!target) fail(400, '分享对象无效')
  } else {
    const member = await prisma.organizationMembership.findFirst({
      where: {
        organizationId: list.organizationId!, userId: targetId, status: 'active',
        memberRole: targetType === 'teacher' ? { in: ['teacher', 'school_principal'] } : 'student',
      },
      select: { id: true },
    })
    if (!member) fail(400, '分享对象不属于当前校园或身份不匹配')
  }
  return prisma.problemListShare.upsert({
    where: { problemListId_targetType_targetId: { problemListId: id, targetType, targetId } },
    create: { id: crypto.randomUUID(), problemListId: id, targetType, targetId, permission, sharedBy: user.userId },
    update: { permission, sharedBy: user.userId },
  })
}

export async function deleteProblemListShare(user: AuthUser, id: string, shareId: string) {
  await ownedList(user, id)
  const share = await prisma.problemListShare.findFirst({ where: { id: shareId, problemListId: id }, select: { id: true } })
  if (!share) fail(404, '分享记录不存在')
  await prisma.problemListShare.delete({ where: { id: shareId } })
}
