import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate, authorize, type AuthRequest } from '../middleware/auth'
import { parsePagination, paginatedResponse } from '../lib/pagination'
import { prisma } from '../prisma'

export const platformOrganizationRouter = Router()

// School and principal lifecycle is a global governance operation. Platform
// admins manage platform problems/OJ operations, but must not create, edit or
// enumerate school organizations through this route.
const superAdminOnly = [authenticate, authorize('super_admin')]

function schoolSelect() {
  return {
    id: true, name: true, shortName: true, region: true, schoolType: true,
    educationSystem: true, contactPerson: true, contactPhone: true, contactEmail: true,
    status: true, currentPrincipalMembershipId: true, createdAt: true,
    Organization: { select: { id: true, name: true, status: true } },
  } as const
}

async function serializeSchool(school: Awaited<ReturnType<typeof prisma.school.findFirst>>) {
  if (!school) return null
  const principal = school.currentPrincipalMembershipId
    ? await prisma.organizationTeacherProfile.findUnique({
        where: { membershipId: school.currentPrincipalMembershipId },
        include: { Membership: { include: { User: { select: { username: true } } } } },
      })
    : null
  const students = school.organizationId
    ? await prisma.organizationStudentProfile.count({ where: { Membership: { organizationId: school.organizationId, status: 'active' } } })
    : 0
  return {
    ...school,
    schoolId: school.id,
    id: school.organizationId!,
    organizationId: school.organizationId,
    principal: principal ? {
      id: principal.membershipId, name: principal.name, title: principal.title,
      email: principal.email, user: principal.Membership.User,
    } : null,
    _count: { students },
  }
}

platformOrganizationRouter.get('/', ...superAdminOnly, asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  const where = { Organization: { type: 'school' } }
  const [schools, total] = await Promise.all([
    prisma.school.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.school.count({ where }),
  ])
  const rows = await Promise.all(schools.map(serializeSchool))
  res.json({ success: true, data: { ...paginatedResponse(rows, total, page, pageSize) } })
}))

platformOrganizationRouter.get('/:organizationId', ...superAdminOnly, asyncHandler(async (req, res) => {
  const school = await prisma.school.findFirst({ where: { organizationId: req.params.organizationId, Organization: { type: 'school' } } })
  const data = await serializeSchool(school)
  if (!data) return res.status(404).json({ success: false, message: '学校不存在' })
  res.json({ success: true, data })
}))

platformOrganizationRouter.post('/', ...superAdminOnly, asyncHandler(async (req: AuthRequest, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const teacherName = typeof req.body.teacherName === 'string' ? req.body.teacherName.trim() : ''
  const password = typeof req.body.password === 'string' && req.body.password ? req.body.password : username
  if (!name || !username || !teacherName || !password) return res.status(400).json({ success: false, message: '请填写学校名称、负责人账号和姓名' })
  if (await prisma.user.findUnique({ where: { username } })) return res.status(409).json({ success: false, message: '用户名已存在' })
  const created = await prisma.$transaction(async tx => {
    const organizationId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const membershipId = crypto.randomUUID()
    const schoolId = crypto.randomUUID()
    await tx.organization.create({ data: { id: organizationId, name, type: 'school', status: 'active' } })
    await tx.user.create({ data: { id: userId, username, passwordHash: await bcrypt.hash(password, 10), role: 'user' } })
    await tx.organizationMembership.create({ data: { id: membershipId, organizationId, userId, memberRole: 'school_principal', relationType: 'employed', status: 'active', joinedAt: new Date() } })
    await tx.organizationTeacherProfile.create({ data: { id: crypto.randomUUID(), membershipId, name: teacherName, title: typeof req.body.teacherTitle === 'string' ? req.body.teacherTitle.trim() || null : null, email: typeof req.body.contactEmail === 'string' ? req.body.contactEmail.trim() || null : null, phone: typeof req.body.contactPhone === 'string' ? req.body.contactPhone.trim() || null : null } })
    await tx.school.create({ data: {
      id: schoolId, name, organizationId, currentPrincipalMembershipId: membershipId,
      region: typeof req.body.region === 'string' ? req.body.region.trim() || null : null,
      schoolType: typeof req.body.schoolType === 'string' ? req.body.schoolType.trim() || null : null,
      educationSystem: typeof req.body.educationSystem === 'string' ? req.body.educationSystem : '6-3-3',
      contactPerson: typeof req.body.contactPerson === 'string' ? req.body.contactPerson.trim() || null : null,
      contactPhone: typeof req.body.contactPhone === 'string' ? req.body.contactPhone.trim() || null : null,
      contactEmail: typeof req.body.contactEmail === 'string' ? req.body.contactEmail.trim() || null : null,
    } })
    return organizationId
  })
  res.status(201).json({ success: true, data: { organizationId: created } })
}))

platformOrganizationRouter.post('/:organizationId/principal', ...superAdminOnly, asyncHandler(async (req, res) => {
  const school = await prisma.school.findFirst({ where: { organizationId: req.params.organizationId, Organization: { type: 'school' } } })
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const name = typeof req.body.teacherName === 'string' ? req.body.teacherName.trim() : ''
  const password = typeof req.body.password === 'string' && req.body.password ? req.body.password : username
  if (!school) return res.status(404).json({ success: false, message: '学校不存在' })
  if (!username || !name || !password) return res.status(400).json({ success: false, message: '请填写负责人账号、姓名和密码' })
  if (await prisma.user.findUnique({ where: { username } })) return res.status(409).json({ success: false, message: '用户名已存在' })
  const principal = await prisma.$transaction(async tx => {
    const userId = crypto.randomUUID()
    const membershipId = crypto.randomUUID()
    const user = await tx.user.create({ data: { id: userId, username, passwordHash: await bcrypt.hash(password, 10), role: 'user' } })
    await tx.organizationMembership.updateMany({ where: { organizationId: req.params.organizationId, memberRole: 'school_principal' }, data: { memberRole: 'teacher' } })
    await tx.organizationMembership.create({ data: { id: membershipId, organizationId: req.params.organizationId, userId, memberRole: 'school_principal', relationType: 'employed', status: 'active', joinedAt: new Date() } })
    const profile = await tx.organizationTeacherProfile.create({ data: { id: crypto.randomUUID(), membershipId, name, title: typeof req.body.teacherTitle === 'string' ? req.body.teacherTitle.trim() || null : null, email: typeof req.body.email === 'string' ? req.body.email.trim() || null : null, phone: typeof req.body.phone === 'string' ? req.body.phone.trim() || null : null } })
    await tx.school.update({ where: { id: school.id }, data: { currentPrincipalMembershipId: membershipId } })
    return { id: membershipId, name: profile.name, title: profile.title, email: profile.email, user: { username: user.username } }
  })
  res.status(201).json({ success: true, data: { teacher: principal } })
}))

platformOrganizationRouter.put('/:organizationId', ...superAdminOnly, asyncHandler(async (req, res) => {
  const school = await prisma.school.findFirst({ where: { organizationId: req.params.organizationId, Organization: { type: 'school' } } })
  if (!school) return res.status(404).json({ success: false, message: '学校不存在' })
  const text = (key: string) => req.body[key] === undefined ? undefined : typeof req.body[key] === 'string' ? req.body[key].trim() || null : null
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : undefined
  await prisma.$transaction([
    prisma.school.update({ where: { id: school.id }, data: { name, region: text('region'), schoolType: text('schoolType'), educationSystem: req.body.educationSystem === undefined ? undefined : req.body.educationSystem, contactPerson: text('contactPerson'), contactPhone: text('contactPhone'), contactEmail: text('contactEmail') } }),
    ...(name ? [prisma.organization.update({ where: { id: req.params.organizationId }, data: { name } })] : []),
  ])
  res.json({ success: true })
}))

platformOrganizationRouter.get('/:organizationId/students', ...superAdminOnly, asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  const where = { Membership: { organizationId: req.params.organizationId, status: 'active' } }
  const [profiles, total] = await Promise.all([
    prisma.organizationStudentProfile.findMany({ where, skip, take: pageSize, include: { Membership: { include: { User: { select: { username: true } } } } }, orderBy: { name: 'asc' } }),
    prisma.organizationStudentProfile.count({ where }),
  ])
  const ids = profiles.map(item => item.headTeacherMembershipId).filter((id): id is string => Boolean(id))
  const teachers = ids.length ? await prisma.organizationTeacherProfile.findMany({ where: { membershipId: { in: ids } }, select: { membershipId: true, name: true } }) : []
  const names = new Map(teachers.map(item => [item.membershipId, item.name]))
  res.json({ success: true, data: paginatedResponse(profiles.map(profile => ({ id: profile.id, name: profile.name, enrollmentYear: profile.enrollmentYear, rating: profile.rating, user: profile.Membership.User, headTeacher: profile.headTeacherMembershipId ? { name: names.get(profile.headTeacherMembershipId) || '-' } : null })), total, page, pageSize) })
}))

platformOrganizationRouter.get('/:organizationId/teachers', ...superAdminOnly, asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  const where = { Membership: { organizationId: req.params.organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } }
  const [profiles, total] = await Promise.all([
    prisma.organizationTeacherProfile.findMany({ where, skip, take: pageSize, include: { Membership: { include: { User: { select: { id: true, username: true, status: true } } } } }, orderBy: { name: 'asc' } }),
    prisma.organizationTeacherProfile.count({ where }),
  ])
  res.json({ success: true, data: paginatedResponse(profiles.map(profile => ({ id: profile.membershipId, name: profile.name, title: profile.title, email: profile.email, phone: profile.phone, user: { ...profile.Membership.User, role: profile.Membership.memberRole } })), total, page, pageSize) })
}))

platformOrganizationRouter.put('/:organizationId/principal', ...superAdminOnly, asyncHandler(async (req, res) => {
  const membershipId = typeof req.body.membershipId === 'string' ? req.body.membershipId : ''
  const school = await prisma.school.findFirst({ where: { organizationId: req.params.organizationId, Organization: { type: 'school' } } })
  if (!school) return res.status(404).json({ success: false, message: '学校不存在' })
  const membership = await prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId: req.params.organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } })
  if (!membership) return res.status(400).json({ success: false, message: '负责人必须是本校有效教师' })
  await prisma.$transaction([
    prisma.organizationMembership.updateMany({ where: { organizationId: req.params.organizationId, memberRole: 'school_principal' }, data: { memberRole: 'teacher' } }),
    prisma.organizationMembership.update({ where: { id: membershipId }, data: { memberRole: 'school_principal' } }),
    prisma.school.update({ where: { id: school.id }, data: { currentPrincipalMembershipId: membershipId } }),
  ])
  const profile = await prisma.organizationTeacherProfile.findUnique({ where: { membershipId }, include: { Membership: { include: { User: { select: { username: true } } } } } })
  res.json({ success: true, data: { principal: profile ? { id: membershipId, name: profile.name, title: profile.title, email: profile.email, user: profile.Membership.User } : null } })
}))
