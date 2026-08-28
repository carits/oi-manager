import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'

export class PlatformOrganizationError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code?: string) {
    super(message)
    this.name = 'PlatformOrganizationError'
  }
}

function badRequest(message: string): never { throw new PlatformOrganizationError(400, message) }
function notFound(message: string): never { throw new PlatformOrganizationError(404, message) }
function conflict(message: string): never { throw new PlatformOrganizationError(409, message) }

async function findSchool(organizationId: string) {
  const school = await prisma.school.findFirst({
    where: { organizationId, Organization: { type: 'school' } },
  })
  if (!school) notFound('学校不存在')
  return school
}

async function serializeSchool(school: Awaited<ReturnType<typeof findSchool>>) {
  const principal = school.currentPrincipalMembershipId
    ? await prisma.organizationTeacherProfile.findUnique({
        where: { membershipId: school.currentPrincipalMembershipId },
        include: { Membership: { include: { User: { select: { username: true } } } } },
      })
    : null
  const students = school.organizationId
    ? await prisma.organizationStudentProfile.count({
        where: { Membership: { organizationId: school.organizationId, status: 'active' } },
      })
    : 0
  return {
    ...school,
    schoolId: school.id,
    id: school.organizationId!,
    organizationId: school.organizationId,
    principal: principal ? {
      id: principal.membershipId,
      name: principal.name,
      title: principal.title,
      email: principal.email,
      user: principal.Membership.User,
    } : null,
    _count: { students },
  }
}

export async function listPlatformOrganizations(page: number, pageSize: number, skip: number) {
  const where = { Organization: { type: 'school' } }
  const [schools, total] = await Promise.all([
    prisma.school.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.school.count({ where }),
  ])
  const rows = await Promise.all(schools.map(school => serializeSchool(school as Awaited<ReturnType<typeof findSchool>>)))
  return paginatedResponse(rows, total, page, pageSize)
}

export async function getPlatformOrganization(organizationId: string) {
  return serializeSchool(await findSchool(organizationId))
}

function trimmed(body: any, key: string) {
  return typeof body[key] === 'string' ? body[key].trim() : ''
}

function optionalText(body: any, key: string) {
  return body[key] === undefined ? undefined : typeof body[key] === 'string' ? body[key].trim() || null : null
}

export async function createPlatformOrganization(body: any) {
  const name = trimmed(body, 'name')
  const username = trimmed(body, 'username')
  const teacherName = trimmed(body, 'teacherName')
  const password = typeof body.password === 'string' && body.password ? body.password : username
  if (!name || !username || !teacherName || !password) badRequest('请填写学校名称、负责人账号和姓名')
  if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) conflict('用户名已存在')

  const organizationId = await prisma.$transaction(async tx => {
    const organizationId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const membershipId = crypto.randomUUID()
    await tx.organization.create({ data: { id: organizationId, name, type: 'school', status: 'active' } })
    await tx.user.create({ data: { id: userId, username, passwordHash: await bcrypt.hash(password, 10), role: 'user' } })
    await tx.organizationMembership.create({
      data: { id: membershipId, organizationId, userId, memberRole: 'school_principal', relationType: 'employed', status: 'active', joinedAt: new Date() },
    })
    await tx.organizationTeacherProfile.create({
      data: {
        id: crypto.randomUUID(), membershipId, name: teacherName,
        title: trimmed(body, 'teacherTitle') || null,
        email: trimmed(body, 'contactEmail') || null,
        phone: trimmed(body, 'contactPhone') || null,
      },
    })
    await tx.school.create({
      data: {
        id: crypto.randomUUID(), name, organizationId, currentPrincipalMembershipId: membershipId,
        region: trimmed(body, 'region') || null,
        schoolType: trimmed(body, 'schoolType') || null,
        educationSystem: typeof body.educationSystem === 'string' ? body.educationSystem : '6-3-3',
        contactPerson: trimmed(body, 'contactPerson') || null,
        contactPhone: trimmed(body, 'contactPhone') || null,
        contactEmail: trimmed(body, 'contactEmail') || null,
      },
    })
    return organizationId
  })
  return { organizationId }
}

export async function createPlatformOrganizationPrincipal(organizationId: string, body: any) {
  const school = await findSchool(organizationId)
  const username = trimmed(body, 'username')
  const name = trimmed(body, 'teacherName')
  const password = typeof body.password === 'string' && body.password ? body.password : username
  if (!username || !name || !password) badRequest('请填写负责人账号、姓名和密码')
  if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) conflict('用户名已存在')

  return prisma.$transaction(async tx => {
    const userId = crypto.randomUUID()
    const membershipId = crypto.randomUUID()
    const user = await tx.user.create({ data: { id: userId, username, passwordHash: await bcrypt.hash(password, 10), role: 'user' } })
    await tx.organizationMembership.updateMany({ where: { organizationId, memberRole: 'school_principal' }, data: { memberRole: 'teacher' } })
    await tx.organizationMembership.create({
      data: { id: membershipId, organizationId, userId, memberRole: 'school_principal', relationType: 'employed', status: 'active', joinedAt: new Date() },
    })
    const profile = await tx.organizationTeacherProfile.create({
      data: {
        id: crypto.randomUUID(), membershipId, name,
        title: trimmed(body, 'teacherTitle') || null,
        email: trimmed(body, 'email') || null,
        phone: trimmed(body, 'phone') || null,
      },
    })
    await tx.school.update({ where: { id: school.id }, data: { currentPrincipalMembershipId: membershipId } })
    return { id: membershipId, name: profile.name, title: profile.title, email: profile.email, user: { username: user.username } }
  })
}

export async function updatePlatformOrganization(organizationId: string, body: any) {
  const school = await findSchool(organizationId)
  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  await prisma.$transaction([
    prisma.school.update({
      where: { id: school.id },
      data: {
        name,
        region: optionalText(body, 'region'),
        schoolType: optionalText(body, 'schoolType'),
        educationSystem: body.educationSystem === undefined ? undefined : body.educationSystem,
        contactPerson: optionalText(body, 'contactPerson'),
        contactPhone: optionalText(body, 'contactPhone'),
        contactEmail: optionalText(body, 'contactEmail'),
      },
    }),
    ...(name ? [prisma.organization.update({ where: { id: organizationId }, data: { name } })] : []),
  ])
}

export async function listPlatformOrganizationStudents(organizationId: string, page: number, pageSize: number, skip: number) {
  await findSchool(organizationId)
  const where = { Membership: { organizationId, status: 'active' } }
  const [profiles, total] = await Promise.all([
    prisma.organizationStudentProfile.findMany({
      where, skip, take: pageSize,
      include: { Membership: { include: { User: { select: { username: true } } } } },
      orderBy: { name: 'asc' },
    }),
    prisma.organizationStudentProfile.count({ where }),
  ])
  const ids = profiles.map(item => item.headTeacherMembershipId).filter((id): id is string => Boolean(id))
  const teachers = ids.length
    ? await prisma.organizationTeacherProfile.findMany({ where: { membershipId: { in: ids } }, select: { membershipId: true, name: true } })
    : []
  const names = new Map(teachers.map(item => [item.membershipId, item.name]))
  const rows = profiles.map(profile => ({
    id: profile.id, name: profile.name, enrollmentYear: profile.enrollmentYear, rating: profile.rating,
    user: profile.Membership.User,
    headTeacher: profile.headTeacherMembershipId ? { name: names.get(profile.headTeacherMembershipId) || '-' } : null,
  }))
  return paginatedResponse(rows, total, page, pageSize)
}

export async function listPlatformOrganizationTeachers(organizationId: string, page: number, pageSize: number, skip: number) {
  await findSchool(organizationId)
  const where = { Membership: { organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } }
  const [profiles, total] = await Promise.all([
    prisma.organizationTeacherProfile.findMany({
      where, skip, take: pageSize,
      include: { Membership: { include: { User: { select: { id: true, username: true, status: true } } } } },
      orderBy: { name: 'asc' },
    }),
    prisma.organizationTeacherProfile.count({ where }),
  ])
  const rows = profiles.map(profile => ({
    id: profile.membershipId, name: profile.name, title: profile.title, email: profile.email, phone: profile.phone,
    user: { ...profile.Membership.User, role: profile.Membership.memberRole },
  }))
  return paginatedResponse(rows, total, page, pageSize)
}

export async function transferPlatformOrganizationPrincipal(organizationId: string, membershipId: unknown) {
  const selectedMembershipId = typeof membershipId === 'string' ? membershipId : ''
  const school = await findSchool(organizationId)
  const membership = await prisma.organizationMembership.findFirst({
    where: { id: selectedMembershipId, organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } },
  })
  if (!membership) badRequest('负责人必须是本校有效教师')
  await prisma.$transaction([
    prisma.organizationMembership.updateMany({ where: { organizationId, memberRole: 'school_principal' }, data: { memberRole: 'teacher' } }),
    prisma.organizationMembership.update({ where: { id: selectedMembershipId }, data: { memberRole: 'school_principal' } }),
    prisma.school.update({ where: { id: school.id }, data: { currentPrincipalMembershipId: selectedMembershipId } }),
  ])
  const profile = await prisma.organizationTeacherProfile.findUnique({
    where: { membershipId: selectedMembershipId },
    include: { Membership: { include: { User: { select: { username: true } } } } },
  })
  return profile ? {
    id: selectedMembershipId, name: profile.name, title: profile.title, email: profile.email, user: profile.Membership.User,
  } : null
}
