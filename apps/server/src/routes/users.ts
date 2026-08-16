import crypto from 'crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate, AuthRequest, isAdmin, isPersonalContext, isSuperAdmin } from '../middleware/auth.js'
import { prisma } from '../prisma.js'
import { validatePassword, validateUsername } from '../utils/validation.js'
import { passwordResetLimiter } from '../middleware/rateLimiter.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { parsePagination, paginatedResponse } from '../lib/pagination.js'

export const userRouter = Router()

userRouter.get('/:userId/profile', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { userId } = req.params
  const userType = typeof req.query.userType === 'string' ? req.query.userType : 'user'
  if (!['teacher', 'student', 'user'].includes(userType)) {
    return res.status(400).json({ success: false, message: 'userType 参数无效' })
  }

  if (isPersonalContext(req.user) || userType === 'user') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, avatar: true, bio: true, status: true } })
    if (!user || user.status !== 'active') return res.status(404).json({ success: false, message: '用户不存在' })
    return res.json({ success: true, data: { ...user, userType: 'user' } })
  }

  const organizationId = req.user!.organizationId!
  if (userType === 'student') {
    const profile = await prisma.organizationStudentProfile.findFirst({
      where: { OR: [{ id: userId }, { Membership: { userId, organizationId, status: 'active' } }] },
      include: { Membership: { include: { User: { select: { id: true, username: true, avatar: true, bio: true } }, Organization: { select: { id: true, name: true } } } } },
    })
    if (!profile || profile.Membership.organizationId !== organizationId) return res.status(404).json({ success: false, message: '用户不存在' })
    return res.json({ success: true, data: {
      id: profile.Membership.userId,
      profileId: profile.id,
      name: profile.name,
      username: profile.Membership.User.username,
      avatar: profile.Membership.User.avatar || profile.avatar,
      bio: profile.Membership.User.bio,
      userType: 'student',
      school: profile.Membership.Organization,
    } })
  }

  const profile = await prisma.organizationTeacherProfile.findFirst({
    where: { OR: [{ id: userId }, { Membership: { userId, organizationId, status: 'active' } }] },
    include: { Membership: { include: { User: { select: { id: true, username: true, avatar: true, bio: true } }, Organization: { select: { id: true, name: true } } } } },
  })
  if (!profile || profile.Membership.organizationId !== organizationId) return res.status(404).json({ success: false, message: '用户不存在' })
  return res.json({ success: true, data: {
    id: profile.Membership.userId,
    profileId: profile.id,
    name: profile.name,
    username: profile.Membership.User.username,
    avatar: profile.Membership.User.avatar || profile.avatar,
    bio: profile.Membership.User.bio || profile.bio,
    userType: 'teacher',
    school: profile.Membership.Organization,
  } })
}))

userRouter.get('/', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!isAdmin(req.user!.role)) return res.status(403).json({ success: false, message: '权限不足' })
  const { page, pageSize, skip } = parsePagination(req.query)
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : ''
  const status = req.query.status === 'active' || req.query.status === 'disabled' ? req.query.status : undefined
  const role = typeof req.query.role === 'string' ? req.query.role : undefined
  const allowedRoles = req.user!.role === 'platform_admin'
    ? ['user']
    : ['user', 'platform_admin', 'super_admin']
  const where = {
    role: role && allowedRoles.includes(role) ? role : { in: allowedRoles },
    ...(status ? { status } : {}),
    ...(keyword ? { username: { contains: keyword, mode: 'insensitive' as const } } : {}),
  }
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' },  }),
    prisma.user.count({ where }),
  ])
  res.json({ success: true, data: { users: users.map(user => ({ ...user, name: user.username })), ...paginatedResponse([], total, page, pageSize) } })
}))

userRouter.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!isAdmin(req.user!.role)) return res.status(403).json({ success: false, message: '权限不足' })
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { OrganizationMembership: { where: { status: 'active' }, include: { Organization: { select: { id: true, name: true } }, StudentProfile: true, TeacherProfile: true } } } })
  if (!user) return res.status(404).json({ success: false, message: '用户不存在' })
  res.json({ success: true, data: user })
}))

userRouter.post('/platform-admin', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!isSuperAdmin(req.user!.role)) return res.status(403).json({ success: false, message: '只有超级管理员可以创建平台管理员' })
  const { username, password, name, phone, email, bio } = req.body
  const usernameValidation = validateUsername(username)
  if (!usernameValidation.valid) return res.status(400).json({ success: false, message: usernameValidation.message })
  const passwordValidation = validatePassword(password)
  if (!passwordValidation.valid) return res.status(400).json({ success: false, message: passwordValidation.message })
  if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: '姓名不能为空' })
  if (await prisma.user.findUnique({ where: { username } })) return res.status(409).json({ success: false, message: '用户名已存在' })
  const userId = crypto.randomUUID()
  const user = await prisma.user.create({ data: { id: userId, username, passwordHash: await bcrypt.hash(password, 10), role: 'platform_admin', phone: phone || null, email: email || null, bio: bio || null } })
  res.status(201).json({ success: true, data: { userId: user.id, username: user.username, role: user.role, adminId: undefined } })
}))

userRouter.put('/:id/status', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!isAdmin(req.user!.role)) return res.status(403).json({ success: false, message: '权限不足' })
  const status = req.body.status
  if (!['active', 'disabled'].includes(status)) return res.status(400).json({ success: false, message: '状态值无效' })
  const target = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!target) return res.status(404).json({ success: false, message: '用户不存在' })
  if (req.user!.role === 'platform_admin' && ['platform_admin', 'super_admin'].includes(target.role)) return res.status(403).json({ success: false, message: '平台管理员不能操作管理员账号' })
  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { status } }),
    prisma.userStatusLog.create({ data: { id: crypto.randomUUID(), targetId: target.id, operatorId: req.user!.userId, operatorRole: req.user!.role, oldStatus: target.status, newStatus: status, reason: String(req.body.reason || '') } }),
  ])
  res.json({ success: true, data: { userId: updated.id, status: updated.status } })
}))

userRouter.post('/:id/reset-password', passwordResetLimiter, authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!isAdmin(req.user!.role)) return res.status(403).json({ success: false, message: '权限不足' })
  const newPassword = req.body.newPassword
  const validation = validatePassword(newPassword)
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message })
  const target = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!target) return res.status(404).json({ success: false, message: '用户不存在' })
  if (req.user!.role === 'platform_admin' && ['platform_admin', 'super_admin'].includes(target.role)) return res.status(403).json({ success: false, message: '平台管理员不能重置管理员密码' })
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } })
  res.json({ success: true, message: '密码已重置' })
}))