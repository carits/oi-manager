import crypto from 'crypto'
import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import { notificationService } from '../modules/notification/notification.service'

export const workspaceRouter = Router()

const allModules = ['overview', 'campus', 'management', 'teams', 'homeworks', 'contests', 'problems', 'problem-lists', 'rankings']
const platformModules = ['overview', 'schools', 'users', 'problems', 'submissions', 'oj-accounts']

function modulesForRole(role: string) {
  if (role === 'school_principal') return allModules
  if (role === 'teacher') return allModules.filter(item => item !== 'problems')
  return ['overview', 'campus', 'teams', 'homeworks', 'contests', 'problem-lists', 'rankings']
}

function relationLabel(memberRole: string, relationType: string) {
  if (memberRole === 'school_principal') return '学校负责人'
  if (memberRole === 'teacher') return relationType === 'external_coach' ? '外聘教练' : '本校教师'
  if (relationType === 'preselected') return '预选学生'
  return '本校学生'
}

workspaceRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const rows = await prisma.organizationMembership.findMany({
    where: { userId: req.user!.userId, status: 'active', Organization: { status: 'active' } },
    include: { Organization: { include: { School: { select: { id: true, shortName: true } } } } },
    orderBy: { joinedAt: 'asc' }
  })
  const organizations = rows.map(row => ({
    type: 'organization' as const,
    organizationId: row.organizationId,
    organizationName: row.Organization.name,
    organizationType: row.Organization.type,
    schoolId: row.Organization.School?.id,
    shortName: row.Organization.School?.shortName || null,
    memberRole: row.memberRole,
    relationType: row.relationType,
    relationLabel: relationLabel(row.memberRole, row.relationType),
    availableModules: modulesForRole(row.memberRole)
  }))
  const platform = ['super_admin', 'platform_admin'].includes(req.user!.role)
    ? [{ type: 'platform' as const, organizationName: '平台管理', memberRole: 'platform_admin', relationLabel: '平台管理员', availableModules: platformModules }]
    : []
  res.json({ success: true, data: { workspaces: [...platform, ...organizations, { type: 'personal', availableModules: ['overview', 'teams', 'problems', 'contests', 'problem-lists', 'rankings', 'submissions'] }] } })
}))

workspaceRouter.post('/organizations/:id/invitations', authenticate, asyncHandler(async (req, res) => {
  const organizationId = req.params.id
  if (req.user!.organizationId !== organizationId) return res.status(403).json({ success: false, message: 'organization context is required' })
  const sender = await prisma.organizationMembership.findFirst({ where: { organizationId, userId: req.user!.userId, status: 'active' } })
  if (!sender || sender.memberRole !== 'school_principal') return res.status(403).json({ success: false, message: '只有学校负责人可以邀请成员' })
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const memberRole = req.body.memberRole === 'teacher' ? 'teacher' : 'student'
  if (!username) return res.status(400).json({ success: false, message: '请输入用户名' })
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } })
  if (!target) return res.status(404).json({ success: false, message: '用户不存在' })
  const existing = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId: target.id } },
    select: { status: true, memberRole: true }
  })
  if (existing?.status === 'active') {
    return res.status(409).json({ success: false, message: `该账号已是本校园${relationLabel(existing.memberRole, 'enrolled')}` })
  }
  if (existing?.status === 'pending') {
    return res.status(409).json({ success: false, message: '该账号已有待处理的校园邀请' })
  }
  const membership = await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId, userId: target.id } },
    create: { id: crypto.randomUUID(), organizationId, userId: target.id, memberRole, relationType: memberRole === 'teacher' ? 'employee' : 'enrolled', status: 'pending', invitedBy: req.user!.userId },
    update: { memberRole, relationType: memberRole === 'teacher' ? 'employee' : 'enrolled', status: 'pending', invitedBy: req.user!.userId, joinedAt: null }
  })
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } })
  await notificationService.create({ userId: target.id, scope: 'campus', type: 'organization_invitation', title: '收到学校邀请', body: `你受邀加入「${organization.name}」`, href: `organization:${organizationId}`, sourceType: 'organization_invitation', sourceId: membership.id })
  res.json({ success: true, data: { id: membership.id } })
}))

workspaceRouter.post('/organization-invitations/:id/:action', authenticate, asyncHandler(async (req, res) => {
  const accept = req.params.action === 'accept'
  if (!accept && req.params.action !== 'reject') return res.status(400).json({ success: false, message: '无效操作' })
  const invitation = await prisma.organizationMembership.findFirst({ where: { id: req.params.id, userId: req.user!.userId, status: 'pending' } })
  if (!invitation) return res.status(404).json({ success: false, message: '邀请不存在或已处理' })
  await prisma.$transaction(async tx => {
    await tx.organizationMembership.update({ where: { id: invitation.id }, data: { status: accept ? 'active' : 'rejected', joinedAt: accept ? new Date() : null } })
    if (!accept) return
    const user = await tx.user.findUniqueOrThrow({ where: { id: req.user!.userId }, select: { username: true, avatar: true, email: true, phone: true, bio: true } })
    if (invitation.memberRole === 'student') {
      await tx.organizationStudentProfile.upsert({
        where: { membershipId: invitation.id },
        create: { id: crypto.randomUUID(), membershipId: invitation.id, name: user.username, avatar: user.avatar, status: 'active' },
        update: { status: 'active' }
      })
    } else {
      await tx.organizationTeacherProfile.upsert({
        where: { membershipId: invitation.id },
        create: { id: crypto.randomUUID(), membershipId: invitation.id, name: user.username, avatar: user.avatar, email: user.email, phone: user.phone, bio: user.bio, status: 'active' },
        update: { status: 'active' }
      })
    }
  })
  await notificationService.markSourceRead(req.user!.userId, 'campus', 'organization_invitation', invitation.id)
  res.json({ success: true })
}))
