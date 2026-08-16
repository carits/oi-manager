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
