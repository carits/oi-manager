import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { Router, type Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate, authorize, type AuthRequest } from '../middleware/auth'
import { prisma } from '../prisma'
import { parsePagination, paginatedResponse } from '../lib/pagination'
import { calculateGrade, getAllGrades } from '@oi-manager/shared/utils/grade'

export const organizationMemberRouter = Router({ mergeParams: true })

function requireOrganizationContext(req: AuthRequest, res: Response): string | null {
  const organizationId = req.params.organizationId
  if (!organizationId || req.user?.organizationId !== organizationId) {
    res.status(403).json({ success: false, code: 'ORGANIZATION_CONTEXT_REQUIRED', message: '当前组织上下文无效' })
    return null
  }
  return organizationId
}

function normalizeEducationSystemDetail(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const detail = value as Record<string, unknown>
  return {
    primaryYears: typeof detail.primaryYears === 'number' ? detail.primaryYears : undefined,
    middleYears: typeof detail.middleYears === 'number' ? detail.middleYears : undefined,
    highYears: typeof detail.highYears === 'number' ? detail.highYears : undefined,
  }
}

organizationMemberRouter.get('/campus', authenticate, asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { School: { select: { id: true, name: true, shortName: true, description: true, announcement: true, region: true, schoolType: true, schoolNature: true, educationSystem: true, educationSystemDetail: true, contactPerson: true, contactPhone: true, contactEmail: true, status: true, currentPrincipalMembershipId: true } } },
  })
  if (!organization?.School) return res.status(404).json({ success: false, message: '未找到校园资料' })
  const school = organization.School
  const principal = school.currentPrincipalMembershipId
    ? await prisma.organizationTeacherProfile.findUnique({ where: { membershipId: school.currentPrincipalMembershipId }, select: { name: true, title: true } })
    : null
  const canViewContact = req.user?.role === 'school_principal'
  res.json({ success: true, data: {
    ...school,
    principal,
    contactPhone: canViewContact ? school.contactPhone : maskContact(school.contactPhone),
    contactEmail: canViewContact ? school.contactEmail : maskEmail(school.contactEmail),
    contactMasked: !canViewContact,
  } })
}, '查看校园资料'))

organizationMemberRouter.put('/campus', authenticate, authorize('school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { School: { select: { id: true } } } })
  if (!organization?.School) return res.status(404).json({ success: false, message: '未找到校园资料' })
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  if (!name) return res.status(400).json({ success: false, message: '请填写校园名称' })
  const text = (key: string) => req.body[key] === undefined ? undefined : typeof req.body[key] === 'string' ? req.body[key].trim() || null : null
  const educationSystem = ['6-3-3', '5-4-3', '6-3', '5-4', 'custom'].includes(req.body.educationSystem) ? req.body.educationSystem : undefined
  await prisma.school.update({ where: { id: organization.School.id }, data: {
    name, shortName: text('shortName'), description: text('description'), region: text('region'), schoolType: text('schoolType'), schoolNature: text('schoolNature'), contactPerson: text('contactPerson'), contactPhone: text('contactPhone'), contactEmail: text('contactEmail'),
    educationSystem, educationSystemDetail: req.body.educationSystem === 'custom' ? req.body.educationSystemDetail : educationSystem ? null : undefined,
  } })
  res.json({ success: true })
}, '编辑校园资料'))

organizationMemberRouter.put('/campus/announcement', authenticate, authorize('school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { School: { select: { id: true } } } })
  if (!organization?.School) return res.status(404).json({ success: false, message: '未找到校园资料' })
  await prisma.school.update({ where: { id: organization.School.id }, data: { announcement: typeof req.body.announcement === 'string' ? req.body.announcement.trim() || null : null } })
  res.json({ success: true })
}, '编辑校园公告'))

function activityStatus(startTime: Date, endTime: Date) {
  const now = Date.now()
  if (now < startTime.getTime()) return 'upcoming'
  if (now <= endTime.getTime()) return 'ongoing'
  return 'finished'
}

async function organizationMemberTeamIds(organizationId: string, userId: string) {
  const members = await prisma.teamMember.findMany({
    where: { userId, status: 'active', Team: { organizationId, scope: 'campus' } },
    select: { teamId: true },
  })
  return members.map(member => member.teamId)
}

organizationMemberRouter.get('/activities/homeworks', authenticate, authorize('student', 'teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const teamIds = await organizationMemberTeamIds(organizationId, req.user!.userId)
  const trainings = teamIds.length ? await prisma.training.findMany({
    where: { organizationId, teamId: { in: teamIds }, type: 'homework' },
    orderBy: { startTime: 'desc' },
    include: { _count: { select: { TrainingProblem: true } } },
  }) : []
  const data = trainings.map(training => ({
    id: training.id, title: training.title, description: training.description,
    startTime: training.startTime, endTime: training.endTime,
    status: activityStatus(training.startTime, training.endTime), format: training.format,
    teamId: training.teamId, problemCount: training._count.TrainingProblem, createdAt: training.createdAt,
  })).sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
  res.json({ success: true, data })
}, '获取作业列表失败'))

organizationMemberRouter.get('/activities/contests', authenticate, authorize('student', 'teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const teamIds = await organizationMemberTeamIds(organizationId, req.user!.userId)
  const trainings = await prisma.training.findMany({
    where: { organizationId, type: 'contest', OR: [{ teamId: null }, ...(teamIds.length ? [{ teamId: { in: teamIds } }] : [])] },
    orderBy: { startTime: 'desc' },
    include: { _count: { select: { TrainingProblem: true } } },
  })
  const data = trainings.map(training => ({
    id: training.id, title: training.title, description: training.description,
    startTime: training.startTime, endTime: training.endTime,
    status: activityStatus(training.startTime, training.endTime), format: training.format,
    teamId: training.teamId, problemCount: training._count.TrainingProblem,
    source: training.teamId ? 'team' : 'school', createdAt: training.createdAt,
  })).sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
  res.json({ success: true, data })
}, '获取比赛列表失败'))
organizationMemberRouter.post('/activities/contests', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const title = typeof req.body.title === "string" ? req.body.title.trim() : ""
  const format = ["oi", "ioi", "icpc"].includes(req.body.format) ? req.body.format : "ioi"
  const startTime = new Date(req.body.startTime)
  const endTime = new Date(req.body.endTime)
  if (!title || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    return res.status(400).json({ success: false, message: "请填写有效的比赛名称和时间范围" })
  }
  const contest = await prisma.training.create({
    data: {
      title,
      description: typeof req.body.description === "string" ? req.body.description.trim() || null : null,
      format,
      type: "contest",
      scope: "campus",
      organizationId,
      startTime,
      endTime,
      createdBy: req.user!.userId,
      problemIdVisible: Boolean(req.body.problemIdVisible),
      solutionVisible: Boolean(req.body.solutionVisible),
      includeAdminInRanking: Boolean(req.body.includeAdminInRanking),
      status: activityStatus(startTime, endTime),
    },
  })
  res.status(201).json({ success: true, data: contest })
}, "创建比赛失败"))


function maskContact(value: string | null) {
  if (!value) return null
  return value.length > 7 ? value.slice(0, 3) + ' **** ' + value.slice(-4) : '已隐藏'
}

function maskEmail(value: string | null) {
  if (!value) return null
  const [name, domain] = value.split('@')
  return domain ? (name.slice(0, 2) || '*') + '***@' + domain : '已隐藏'
}

organizationMemberRouter.get('/students', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const { page, pageSize } = parsePagination(req.query)
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const status = req.query.status === 'active' || req.query.status === 'disabled' ? req.query.status : undefined
  const requestedHeadTeacherMembershipId = typeof req.query.headTeacherMembershipId === 'string' && req.query.headTeacherMembershipId ? req.query.headTeacherMembershipId : undefined
  const headTeacherMembershipId = req.user!.role === 'teacher' ? req.user!.organizationMembershipId : requestedHeadTeacherMembershipId
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { School: { select: { id: true, schoolType: true, educationSystem: true, educationSystemDetail: true } } } })
  if (!organization?.School) return res.status(404).json({ success: false, message: '未找到校园资料' })
  const school = organization.School
  const profiles = await prisma.organizationStudentProfile.findMany({
    where: {
      Membership: { organizationId, status: 'active', ...(q ? { OR: [{ User: { username: { contains: q, mode: 'insensitive' } } }, { StudentProfile: { name: { contains: q, mode: 'insensitive' } } }] } : {}) },
      ...(status ? { status } : {}),
      ...(headTeacherMembershipId ? { headTeacherMembershipId } : {}),
    },
    orderBy: [{ enrollmentYear: 'desc' }, { name: 'asc' }],
    include: { Membership: { include: { User: { select: { id: true, username: true, avatar: true, status: true } } } } },
  })
  const teacherMembershipIds = [...new Set(profiles.map(profile => profile.headTeacherMembershipId).filter((id): id is string => Boolean(id)))]
  const teacherProfiles = teacherMembershipIds.length ? await prisma.organizationTeacherProfile.findMany({ where: { membershipId: { in: teacherMembershipIds } }, select: { membershipId: true, name: true } }) : []
  const teacherNames = new Map(teacherProfiles.map(profile => [profile.membershipId, profile.name]))
  const rows = profiles.map(profile => ({ id: profile.id, membershipId: profile.membershipId, userId: profile.Membership.userId, name: profile.name, gender: profile.gender, enrollmentYear: profile.enrollmentYear, rating: profile.rating, status: profile.status, headTeacherMembershipId: profile.headTeacherMembershipId, headTeacher: profile.headTeacherMembershipId ? { id: profile.headTeacherMembershipId, name: teacherNames.get(profile.headTeacherMembershipId) || '-' } : null, user: profile.Membership.User }))
  const grade = typeof req.query.grade === 'string' && req.query.grade ? req.query.grade : undefined
  const filtered = grade ? rows.filter(profile => calculateGrade({ enrollmentYear: profile.enrollmentYear, educationSystem: school.educationSystem, educationSystemDetail: normalizeEducationSystemDetail(school.educationSystemDetail), schoolType: school.schoolType }) === grade) : rows
  const start = (page - 1) * pageSize
  res.json({ success: true, data: { ...paginatedResponse(filtered.slice(start, start + pageSize), filtered.length, page, pageSize), filters: { grades: getAllGrades(school.schoolType, school.educationSystem, normalizeEducationSystemDetail(school.educationSystemDetail)).filter(Boolean) } } })
}, '获取学生列表失败'))

organizationMemberRouter.get('/teachers', authenticate, authorize('school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const { page, pageSize } = parsePagination(req.query)
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const status = req.query.status === 'active' || req.query.status === 'disabled' ? req.query.status : undefined
  const role = req.query.role === 'school_principal' || req.query.role === 'teacher' ? req.query.role : undefined
  const profiles = await prisma.organizationTeacherProfile.findMany({
    where: { Membership: { organizationId, status: 'active', ...(role ? { memberRole: role } : {}), ...(q ? { OR: [{ User: { username: { contains: q, mode: 'insensitive' } } }, { TeacherProfile: { name: { contains: q, mode: 'insensitive' } } }] } : {}) }, ...(status ? { status } : {}) },
    orderBy: { name: 'asc' },
    include: { Membership: { include: { User: { select: { id: true, username: true, avatar: true, status: true } } } } },
  })
  const start = (page - 1) * pageSize
  const rows = profiles.map(profile => ({ id: profile.id, membershipId: profile.membershipId, userId: profile.Membership.userId, name: profile.name, title: profile.title, email: profile.email, phone: profile.phone, status: profile.status, memberRole: profile.Membership.memberRole, user: profile.Membership.User }))
  res.json({ success: true, data: paginatedResponse(rows.slice(start, start + pageSize), rows.length, page, pageSize) })
}, '获取教师列表失败'))


async function canManageStudentProfile(req: AuthRequest, profileId: string) {
  const profile = await prisma.organizationStudentProfile.findUnique({ where: { id: profileId }, include: { Membership: true } })
  if (!profile || profile.Membership.organizationId !== req.user?.organizationId || profile.Membership.status !== 'active') return { profile: null, allowed: false }
  if (req.user?.role === 'school_principal') return { profile, allowed: true }
  return { profile, allowed: profile.headTeacherMembershipId === req.user?.organizationMembershipId }
}

organizationMemberRouter.post('/students', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  if (!username || !password || !name) return res.status(400).json({ success: false, message: '请填写用户名、密码和姓名' })
  if (password.length < 6) return res.status(400).json({ success: false, message: '密码至少 6 位' })
  const headTeacherMembershipId = req.user!.role === 'school_principal' && typeof req.body.headTeacherMembershipId === 'string'
    ? req.body.headTeacherMembershipId
    : req.user!.organizationMembershipId
  if (headTeacherMembershipId) {
    const teacher = await prisma.organizationMembership.findFirst({ where: { id: headTeacherMembershipId, organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } })
    if (!teacher) return res.status(400).json({ success: false, message: '指定的主教练不存在' })
  }
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (existing) return res.status(409).json({ success: false, message: '用户名已存在' })
  const data = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10), role: 'user', avatar: req.body.avatar || null } })
    const membership = await tx.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId, userId: user.id, memberRole: 'student', relationType: 'enrolled', status: 'active', joinedAt: new Date() } })
    const profile = await tx.organizationStudentProfile.create({ data: { id: crypto.randomUUID(), membershipId: membership.id, name, gender: req.body.gender || null, enrollmentYear: req.body.enrollmentYear ? Number(req.body.enrollmentYear) : null, targetContest: req.body.targetContest || null, headTeacherMembershipId: headTeacherMembershipId || null, tags: req.body.tags ? JSON.stringify(req.body.tags) : null, notes: req.body.notes || null, avatar: req.body.avatar || null } })
    return { id: profile.id, membershipId: membership.id, userId: user.id }
  })
  res.status(201).json({ success: true, data })
}, '创建学生失败'))

organizationMemberRouter.put('/students/:profileId', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const access = await canManageStudentProfile(req, req.params.profileId)
  if (!access.profile) return res.status(404).json({ success: false, message: '学生档案不存在' })
  if (!access.allowed) return res.status(403).json({ success: false, message: '无权管理该学生' })
  const requestedTeacher = req.user!.role === 'school_principal' && typeof req.body.headTeacherMembershipId === 'string' ? req.body.headTeacherMembershipId : undefined
  if (requestedTeacher !== undefined && requestedTeacher) {
    const teacher = await prisma.organizationMembership.findFirst({ where: { id: requestedTeacher, organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } })
    if (!teacher) return res.status(400).json({ success: false, message: '指定的主教练不存在' })
  }
  await prisma.$transaction(async tx => {
    if (typeof req.body.password === 'string' && req.body.password) {
      if (req.body.password.length < 6) throw new Error('PASSWORD_TOO_SHORT')
      await tx.user.update({ where: { id: access.profile.Membership.userId }, data: { passwordHash: await bcrypt.hash(req.body.password, 10) } })
    }
    await tx.organizationStudentProfile.update({ where: { id: access.profile.id }, data: { name: typeof req.body.name === 'string' ? req.body.name.trim() || access.profile.name : undefined, gender: req.body.gender === undefined ? undefined : req.body.gender || null, enrollmentYear: req.body.enrollmentYear === undefined ? undefined : req.body.enrollmentYear ? Number(req.body.enrollmentYear) : null, targetContest: req.body.targetContest === undefined ? undefined : req.body.targetContest || null, headTeacherMembershipId: requestedTeacher, tags: req.body.tags === undefined ? undefined : req.body.tags ? JSON.stringify(req.body.tags) : null, notes: req.body.notes === undefined ? undefined : req.body.notes || null, avatar: req.body.avatar === undefined ? undefined : req.body.avatar || null } })
  })
  res.json({ success: true })
}, '更新学生失败'))

organizationMemberRouter.put('/students/:profileId/status', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const status = req.body.status
  if (status !== 'active' && status !== 'disabled') return res.status(400).json({ success: false, message: '状态参数无效' })
  const access = await canManageStudentProfile(req, req.params.profileId)
  if (!access.profile) return res.status(404).json({ success: false, message: '学生档案不存在' })
  if (!access.allowed) return res.status(403).json({ success: false, message: '无权管理该学生' })
  await prisma.organizationStudentProfile.update({ where: { id: access.profile.id }, data: { status } })
  res.json({ success: true })
}, '更新学生状态失败'))

organizationMemberRouter.delete('/students/:profileId', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const access = await canManageStudentProfile(req, req.params.profileId)
  if (!access.profile) return res.status(404).json({ success: false, message: '学生档案不存在' })
  if (!access.allowed) return res.status(403).json({ success: false, message: '无权管理该学生' })
  await prisma.$transaction([prisma.organizationStudentProfile.update({ where: { id: access.profile.id }, data: { status: 'archived' } }), prisma.organizationMembership.update({ where: { id: access.profile.membershipId }, data: { status: 'archived' } })])
  res.json({ success: true, message: '学生已移出校园' })
}, '移出学生失败'))


async function principalAccess(req: AuthRequest, organizationId: string) {
  return req.user?.organizationId === organizationId && req.user.role === 'school_principal'
}

organizationMemberRouter.post('/principal-transfer', authenticate, authorize('school_principal'), asyncHandler(async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId
  const newPrincipalMembershipId = typeof req.body.newPrincipalMembershipId === 'string' ? req.body.newPrincipalMembershipId : ''
  if (!organizationId || !newPrincipalMembershipId) return res.status(400).json({ success: false, message: '请选择新的学校负责人' })

  const currentMembershipId = req.user!.organizationMembershipId
  const [target, school] = await Promise.all([
    prisma.organizationMembership.findFirst({ where: { id: newPrincipalMembershipId, organizationId, status: 'active', memberRole: 'teacher' }, select: { id: true } }),
    prisma.school.findFirst({ where: { organizationId }, select: { id: true } })
  ])
  if (!target || !school || !currentMembershipId) return res.status(400).json({ success: false, message: '新负责人必须是当前校园的有效教师' })

  await prisma.$transaction(async tx => {
    await tx.organizationMembership.update({ where: { id: currentMembershipId }, data: { memberRole: 'teacher' } })
    await tx.organizationMembership.update({ where: { id: target.id }, data: { memberRole: 'school_principal' } })
    await tx.school.update({ where: { id: school.id }, data: { currentPrincipalMembershipId: target.id } })
  })
  res.json({ success: true, data: { principalMembershipId: target.id } })
}))

organizationMemberRouter.post('/teachers', authenticate, authorize('school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res); if (!organizationId || !await principalAccess(req, organizationId)) return
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  if (!username || !password || !name) return res.status(400).json({ success: false, message: '请填写用户名、密码和姓名' })
  if (password.length < 6) return res.status(400).json({ success: false, message: '密码至少 6 位' })
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (existing) return res.status(409).json({ success: false, message: '用户名已存在' })
  const data = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10), role: 'user', avatar: req.body.avatar || null, email: req.body.email || null, phone: req.body.phone || null } })
    const membership = await tx.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId, userId: user.id, memberRole: 'teacher', relationType: 'employee', status: 'active', joinedAt: new Date() } })
    const profile = await tx.organizationTeacherProfile.create({ data: { id: crypto.randomUUID(), membershipId: membership.id, name, email: req.body.email || null, phone: req.body.phone || null, title: req.body.title || null, avatar: req.body.avatar || null, bio: req.body.bio || null } })
    return { id: profile.id, membershipId: membership.id, userId: user.id }
  })
  res.status(201).json({ success: true, data })
}, '创建教师失败'))

organizationMemberRouter.put('/teachers/:profileId', authenticate, authorize('school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId || !await principalAccess(req, organizationId)) return
  const profile = await prisma.organizationTeacherProfile.findUnique({ where: { id: req.params.profileId }, include: { Membership: true } })
  if (!profile || profile.Membership.organizationId !== organizationId || profile.Membership.status !== 'active') return res.status(404).json({ success: false, message: '教师档案不存在' })
  if (typeof req.body.password === 'string' && req.body.password && req.body.password.length < 6) return res.status(400).json({ success: false, message: '密码至少 6 位' })
  await prisma.$transaction(async tx => {
    if (typeof req.body.password === 'string' && req.body.password) await tx.user.update({ where: { id: profile.Membership.userId }, data: { passwordHash: await bcrypt.hash(req.body.password, 10) } })
    await tx.organizationTeacherProfile.update({ where: { id: profile.id }, data: { name: typeof req.body.name === 'string' ? req.body.name.trim() || profile.name : undefined, email: req.body.email === undefined ? undefined : req.body.email || null, phone: req.body.phone === undefined ? undefined : req.body.phone || null, title: req.body.title === undefined ? undefined : req.body.title || null, avatar: req.body.avatar === undefined ? undefined : req.body.avatar || null, bio: req.body.bio === undefined ? undefined : req.body.bio || null } })
  })
  res.json({ success: true })
}, '更新教师失败'))

organizationMemberRouter.put('/teachers/:profileId/status', authenticate, authorize('school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId || !await principalAccess(req, organizationId)) return
  const status = req.body.status
  if (status !== 'active' && status !== 'disabled') return res.status(400).json({ success: false, message: '状态参数无效' })
  const profile = await prisma.organizationTeacherProfile.findUnique({ where: { id: req.params.profileId }, include: { Membership: true } })
  if (!profile || profile.Membership.organizationId !== organizationId || profile.Membership.status !== 'active') return res.status(404).json({ success: false, message: '教师档案不存在' })
  if (profile.Membership.id === req.user!.organizationMembershipId) return res.status(400).json({ success: false, message: '不能修改自己的状态' })
  await prisma.organizationTeacherProfile.update({ where: { id: profile.id }, data: { status } })
  res.json({ success: true })
}, '更新教师状态失败'))

organizationMemberRouter.delete('/teachers/:profileId', authenticate, authorize('school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId || !await principalAccess(req, organizationId)) return
  const profile = await prisma.organizationTeacherProfile.findUnique({ where: { id: req.params.profileId }, include: { Membership: true } })
  if (!profile || profile.Membership.organizationId !== organizationId || profile.Membership.status !== 'active') return res.status(404).json({ success: false, message: '教师档案不存在' })
  if (profile.Membership.memberRole === 'school_principal') return res.status(400).json({ success: false, message: '不能删除学校负责人' })
  await prisma.$transaction([prisma.organizationTeacherProfile.update({ where: { id: profile.id }, data: { status: 'archived' } }), prisma.organizationMembership.update({ where: { id: profile.membershipId }, data: { status: 'archived' } })])
  res.json({ success: true, message: '教师已移出校园' })
}, '移出教师失败'))
