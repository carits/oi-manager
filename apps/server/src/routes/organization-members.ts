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
    res.status(403).json({ success: false, code: 'ORGANIZATION_CONTEXT_REQUIRED', message: '?????????????????' })
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

organizationMemberRouter.get('/students', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const { page, pageSize } = parsePagination(req.query)
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const status = req.query.status === 'active' || req.query.status === 'disabled' ? req.query.status : undefined
  const headTeacherMembershipId = typeof req.query.headTeacherMembershipId === 'string' && req.query.headTeacherMembershipId ? req.query.headTeacherMembershipId : undefined
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { School: { select: { id: true, schoolType: true, educationSystem: true, educationSystemDetail: true } } } })
  if (!organization?.School) return res.status(404).json({ success: false, message: '???????' })
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
  const rows = profiles.map(profile => ({ id: profile.id, membershipId: profile.membershipId, userId: profile.Membership.userId, name: profile.name, gender: profile.gender, enrollmentYear: profile.enrollmentYear, rating: profile.rating, status: profile.status, headTeacherMembershipId: profile.headTeacherMembershipId, user: profile.Membership.User }))
  const grade = typeof req.query.grade === 'string' && req.query.grade ? req.query.grade : undefined
  const filtered = grade ? rows.filter(profile => calculateGrade({ enrollmentYear: profile.enrollmentYear, educationSystem: school.educationSystem, educationSystemDetail: normalizeEducationSystemDetail(school.educationSystemDetail), schoolType: school.schoolType }) === grade) : rows
  const start = (page - 1) * pageSize
  res.json({ success: true, data: { ...paginatedResponse(filtered.slice(start, start + pageSize), filtered.length, page, pageSize), filters: { grades: getAllGrades(school.schoolType, school.educationSystem, normalizeEducationSystemDetail(school.educationSystemDetail)).filter(Boolean) } } })
}, '????????'))

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
}, '????????'))


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
  if (!username || !password || !name) return res.status(400).json({ success: false, message: '?????????????' })
  if (password.length < 6) return res.status(400).json({ success: false, message: '?????? 6 ?' })
  const headTeacherMembershipId = req.user!.role === 'school_principal' && typeof req.body.headTeacherMembershipId === 'string'
    ? req.body.headTeacherMembershipId
    : req.user!.organizationMembershipId
  if (headTeacherMembershipId) {
    const teacher = await prisma.organizationMembership.findFirst({ where: { id: headTeacherMembershipId, organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } })
    if (!teacher) return res.status(400).json({ success: false, message: '??????????' })
  }
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (existing) return res.status(409).json({ success: false, message: '??????' })
  const data = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10), role: 'user', avatar: req.body.avatar || null } })
    const membership = await tx.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId, userId: user.id, memberRole: 'student', relationType: 'enrolled', status: 'active', joinedAt: new Date() } })
    const profile = await tx.organizationStudentProfile.create({ data: { id: crypto.randomUUID(), membershipId: membership.id, name, gender: req.body.gender || null, enrollmentYear: req.body.enrollmentYear ? Number(req.body.enrollmentYear) : null, targetContest: req.body.targetContest || null, headTeacherMembershipId: headTeacherMembershipId || null, tags: req.body.tags ? JSON.stringify(req.body.tags) : null, notes: req.body.notes || null, avatar: req.body.avatar || null } })
    return { id: profile.id, membershipId: membership.id, userId: user.id }
  })
  res.status(201).json({ success: true, data })
}, '????????'))

organizationMemberRouter.put('/students/:profileId', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const access = await canManageStudentProfile(req, req.params.profileId)
  if (!access.profile) return res.status(404).json({ success: false, message: '???????' })
  if (!access.allowed) return res.status(403).json({ success: false, message: '??????????????????' })
  const requestedTeacher = req.user!.role === 'school_principal' && typeof req.body.headTeacherMembershipId === 'string' ? req.body.headTeacherMembershipId : undefined
  if (requestedTeacher !== undefined && requestedTeacher) {
    const teacher = await prisma.organizationMembership.findFirst({ where: { id: requestedTeacher, organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } })
    if (!teacher) return res.status(400).json({ success: false, message: '??????????' })
  }
  await prisma.$transaction(async tx => {
    if (typeof req.body.password === 'string' && req.body.password) {
      if (req.body.password.length < 6) throw new Error('PASSWORD_TOO_SHORT')
      await tx.user.update({ where: { id: access.profile.Membership.userId }, data: { passwordHash: await bcrypt.hash(req.body.password, 10) } })
    }
    await tx.organizationStudentProfile.update({ where: { id: access.profile.id }, data: { name: typeof req.body.name === 'string' ? req.body.name.trim() || access.profile.name : undefined, gender: req.body.gender === undefined ? undefined : req.body.gender || null, enrollmentYear: req.body.enrollmentYear === undefined ? undefined : req.body.enrollmentYear ? Number(req.body.enrollmentYear) : null, targetContest: req.body.targetContest === undefined ? undefined : req.body.targetContest || null, headTeacherMembershipId: requestedTeacher, tags: req.body.tags === undefined ? undefined : req.body.tags ? JSON.stringify(req.body.tags) : null, notes: req.body.notes === undefined ? undefined : req.body.notes || null, avatar: req.body.avatar === undefined ? undefined : req.body.avatar || null } })
  })
  res.json({ success: true })
}, '????????'))

organizationMemberRouter.put('/students/:profileId/status', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const status = req.body.status
  if (status !== 'active' && status !== 'disabled') return res.status(400).json({ success: false, message: '??????' })
  const access = await canManageStudentProfile(req, req.params.profileId)
  if (!access.profile) return res.status(404).json({ success: false, message: '???????' })
  if (!access.allowed) return res.status(403).json({ success: false, message: '???????' })
  await prisma.$transaction([prisma.organizationStudentProfile.update({ where: { id: access.profile.id }, data: { status } }), prisma.user.update({ where: { id: access.profile.Membership.userId }, data: { status } })])
  res.json({ success: true })
}, '????????'))

organizationMemberRouter.delete('/students/:profileId', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationContext(req, res)
  if (!organizationId) return
  const access = await canManageStudentProfile(req, req.params.profileId)
  if (!access.profile) return res.status(404).json({ success: false, message: '???????' })
  if (!access.allowed) return res.status(403).json({ success: false, message: '???????' })
  await prisma.$transaction([prisma.organizationStudentProfile.update({ where: { id: access.profile.id }, data: { status: 'archived' } }), prisma.organizationMembership.update({ where: { id: access.profile.membershipId }, data: { status: 'archived' } })])
  res.json({ success: true, message: '???????????' })
}, '????????'))
