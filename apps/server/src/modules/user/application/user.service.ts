import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'
import { validatePassword, validateUsername } from '../../../utils/validation'

export class UserApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code?: string) {
    super(message)
    this.name = 'UserApplicationError'
  }
}

export interface UserActor {
  userId: string
  role: string
  organizationId?: string | null
  personalContext: boolean
}

function fail(statusCode: number, message: string): never { throw new UserApplicationError(statusCode, message) }
function requireAdmin(actor: UserActor) {
  if (actor.role !== 'super_admin' && actor.role !== 'platform_admin') fail(403, '权限不足')
}

export async function getUserProfile(actor: UserActor, userId: string, requestedType: unknown) {
  const userType = typeof requestedType === 'string' ? requestedType : 'user'
  if (!['teacher', 'student', 'user'].includes(userType)) fail(400, 'userType 参数无效')
  if (actor.personalContext || userType === 'user') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, avatar: true, bio: true, status: true },
    })
    if (!user || user.status !== 'active') fail(404, '用户不存在')
    return { ...user, userType: 'user' }
  }

  const organizationId = actor.organizationId
  if (!organizationId) fail(404, '用户不存在')
  if (userType === 'student') {
    const profile = await prisma.organizationStudentProfile.findFirst({
      where: { OR: [{ id: userId }, { Membership: { userId, organizationId, status: 'active' } }] },
      include: {
        Membership: {
          include: {
            User: { select: { id: true, username: true, avatar: true, bio: true } },
            Organization: { select: { id: true, name: true } },
          },
        },
      },
    })
    if (!profile || profile.Membership.organizationId !== organizationId) fail(404, '用户不存在')
    return {
      id: profile.Membership.userId,
      profileId: profile.id,
      name: profile.name,
      username: profile.Membership.User.username,
      avatar: profile.Membership.User.avatar || profile.avatar,
      bio: profile.Membership.User.bio,
      userType: 'student',
      school: profile.Membership.Organization,
    }
  }

  const profile = await prisma.organizationTeacherProfile.findFirst({
    where: { OR: [{ id: userId }, { Membership: { userId, organizationId, status: 'active' } }] },
    include: {
      Membership: {
        include: {
          User: { select: { id: true, username: true, avatar: true, bio: true } },
          Organization: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!profile || profile.Membership.organizationId !== organizationId) fail(404, '用户不存在')
  return {
    id: profile.Membership.userId,
    profileId: profile.id,
    name: profile.name,
    username: profile.Membership.User.username,
    avatar: profile.Membership.User.avatar || profile.avatar,
    bio: profile.Membership.User.bio || profile.bio,
    userType: 'teacher',
    school: profile.Membership.Organization,
  }
}

export async function listGlobalUsers(actor: UserActor, query: any, page: number, pageSize: number, skip: number) {
  requireAdmin(actor)
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
  const status = query.status === 'active' || query.status === 'disabled' ? query.status : undefined
  const role = typeof query.role === 'string' ? query.role : undefined
  const allowedRoles = actor.role === 'platform_admin' ? ['user'] : ['user', 'platform_admin', 'super_admin']
  const where = {
    role: role && allowedRoles.includes(role) ? role : { in: allowedRoles },
    ...(status ? { status } : {}),
    ...(keyword ? { username: { contains: keyword, mode: 'insensitive' as const } } : {}),
  }
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where }),
  ])
  return { users: users.map(user => ({ ...user, name: user.username })), ...paginatedResponse([], total, page, pageSize) }
}

export async function getGlobalUser(actor: UserActor, userId: string) {
  requireAdmin(actor)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      OrganizationMembership: {
        where: { status: 'active' },
        include: {
          Organization: { select: { id: true, name: true } },
          StudentProfile: true,
          TeacherProfile: true,
        },
      },
    },
  })
  if (!user) fail(404, '用户不存在')
  return user
}

export async function createPlatformAdmin(actor: UserActor, body: any) {
  if (actor.role !== 'super_admin') fail(403, '只有超级管理员可以创建平台管理员')
  const { username, password, name, phone, email, bio } = body
  const usernameValidation = validateUsername(username)
  if (!usernameValidation.valid) fail(400, usernameValidation.message || '用户名无效')
  const passwordValidation = validatePassword(password)
  if (!passwordValidation.valid) fail(400, passwordValidation.message || '密码无效')
  if (!name || !String(name).trim()) fail(400, '姓名不能为空')
  if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) fail(409, '用户名已存在')
  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10),
      role: 'platform_admin', phone: phone || null, email: email || null, bio: bio || null,
    },
  })
  return { userId: user.id, username: user.username, role: user.role, adminId: undefined }
}

function protectAdminTarget(actor: UserActor, targetRole: string, message: string) {
  if (actor.role === 'platform_admin' && (targetRole === 'platform_admin' || targetRole === 'super_admin')) fail(403, message)
}

export async function updateGlobalUserStatus(actor: UserActor, userId: string, body: any) {
  requireAdmin(actor)
  const status = body.status
  if (status !== 'active' && status !== 'disabled') fail(400, '状态值无效')
  const target = await prisma.user.findUnique({ where: { id: userId } })
  if (!target) fail(404, '用户不存在')
  protectAdminTarget(actor, target.role, '平台管理员不能操作管理员账号')
  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { status } }),
    prisma.userStatusLog.create({
      data: {
        id: crypto.randomUUID(), targetId: target.id, operatorId: actor.userId, operatorRole: actor.role,
        oldStatus: target.status, newStatus: status, reason: String(body.reason || ''),
      },
    }),
  ])
  return { userId: updated.id, status: updated.status }
}

export async function resetGlobalUserPassword(actor: UserActor, userId: string, newPassword: unknown) {
  requireAdmin(actor)
  const password = typeof newPassword === 'string' ? newPassword : ''
  const validation = validatePassword(password)
  if (!validation.valid) fail(400, validation.message || '密码无效')
  const target = await prisma.user.findUnique({ where: { id: userId } })
  if (!target) fail(404, '用户不存在')
  protectAdminTarget(actor, target.role, '平台管理员不能重置管理员密码')
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await bcrypt.hash(password, 10), sessionVersion: { increment: 1 } },
  })
}
