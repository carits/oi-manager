import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'
import { createSchoolOrganizationCore, findLegacySchoolNameConflict, lockSchoolCreation, normalizeSchoolName, SchoolNameConflictError } from './school-creation.service'
import { getSchoolReferenceSummaries, getSchoolReferenceSummary, SCHOOL_DIRECTORY_STATUSES, SchoolDirectoryGovernanceError, updateSchoolDirectoryStatus } from './school-directory-governance.service'
import { syncOrganizationMembershipBaseRole } from '../../authorization/membership-role-assignment'

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

async function serializeSchool(school: Awaited<ReturnType<typeof findSchool>>, prefetchedReferenceSummary?: Awaited<ReturnType<typeof getSchoolReferenceSummary>>) {
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
  const referenceSummary = school.directoryStatus === 'legacy' && school.organizationId
    ? prefetchedReferenceSummary || await getSchoolReferenceSummary(school.organizationId)
    : undefined
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
    ...(referenceSummary ? { referenceSummary } : {}),
  }
}

export async function listPlatformOrganizations(page: number, pageSize: number, skip: number, query: Record<string, unknown> = {}) {
  const requestedStatus = typeof query.directoryStatus === 'string' ? query.directoryStatus : ''
  if (requestedStatus && !SCHOOL_DIRECTORY_STATUSES.includes(requestedStatus as any)) throw new PlatformOrganizationError(400, '目录状态无效', 'SCHOOL_DIRECTORY_STATUS_INVALID')
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
  const where = {
    Organization: { type: 'school' },
    directoryStatus: requestedStatus || { not: 'legacy' },
    ...(q ? { OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { shortName: { contains: q, mode: 'insensitive' as const } },
      { id: { contains: q, mode: 'insensitive' as const } },
      { organizationId: { contains: q, mode: 'insensitive' as const } },
    ] } : {}),
  }
  const [schools, total] = await Promise.all([
    prisma.school.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.school.count({ where }),
  ])
  const referenceSummaries = requestedStatus === 'legacy'
    ? await getSchoolReferenceSummaries(schools.map(school => school.organizationId).filter((id): id is string => Boolean(id)))
    : new Map()
  const rows = await Promise.all(schools.map(school => serializeSchool(school as Awaited<ReturnType<typeof findSchool>>, school.organizationId ? referenceSummaries.get(school.organizationId) : undefined)))
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

export async function createPlatformOrganization(body: any, actorUserId?: string) {
  const name = trimmed(body, 'name')
  const username = trimmed(body, 'username')
  const teacherName = trimmed(body, 'teacherName')
  const password = typeof body.password === 'string' && body.password ? body.password : username
  if (!name || !username || !teacherName || !password) badRequest('请填写学校名称、负责人账号和姓名')
  if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) conflict('用户名已存在')

  const passwordHash = await bcrypt.hash(password, 10)
  try {
    return await prisma.$transaction(async tx => {
      const result = await createSchoolOrganizationCore(tx, {
        name, shortName: trimmed(body, 'shortName') || null, region: trimmed(body, 'region'),
        schoolType: trimmed(body, 'schoolType'), schoolNature: trimmed(body, 'schoolNature') || null,
        educationSystem: typeof body.educationSystem === 'string' ? body.educationSystem : '6-3-3',
        contactPerson: trimmed(body, 'contactPerson') || null, contactPhone: trimmed(body, 'contactPhone') || null,
        contactEmail: trimmed(body, 'contactEmail') || null, principalName: teacherName,
        principalTitle: trimmed(body, 'teacherTitle') || null,
      }, { type: 'new', userId: crypto.randomUUID(), username, passwordHash })
      await tx.platformAuditLog.create({ data: {
        id: crypto.randomUUID(), actorUserId: actorUserId || null, action: 'organization_created_directly', targetType: 'organization',
        targetId: result.organizationId, metadata: { nameKey: result.nameKey },
      } })
      return { organizationId: result.organizationId }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof SchoolNameConflictError) conflict(error.message)
    throw error
  }
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
    const formerPrincipals = await tx.organizationMembership.findMany({ where: { organizationId, memberRole: 'school_principal' }, select: { id: true } })
    await tx.organizationMembership.updateMany({ where: { organizationId, memberRole: 'school_principal' }, data: { memberRole: 'teacher' } })
    for (const principal of formerPrincipals) {
      await syncOrganizationMembershipBaseRole(tx, principal.id, 'teacher', { source: 'principal_transfer' })
    }
    await tx.organizationMembership.create({
      data: { id: membershipId, organizationId, userId, memberRole: 'school_principal', relationType: 'employee', status: 'active', joinedAt: new Date() },
    })
    await syncOrganizationMembershipBaseRole(tx, membershipId, 'school_principal', { source: 'principal_transfer' })
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
  await prisma.$transaction(async tx => {
    let nameKey: string | null | undefined
    if (name) {
      await lockSchoolCreation(tx)
      if (school.directoryStatus === 'legacy') {
        nameKey = null
      } else {
        nameKey = normalizeSchoolName(name)
        const duplicate = await tx.school.findFirst({ where: { nameKey, id: { not: school.id }, directoryStatus: { not: 'legacy' } }, select: { id: true } }) || await findLegacySchoolNameConflict(tx, nameKey, school.id)
        if (duplicate) throw new SchoolNameConflictError()
      }
    }
    await tx.school.update({
      where: { id: school.id },
      data: {
        name, nameKey,
        region: optionalText(body, 'region'),
        schoolType: optionalText(body, 'schoolType'),
        educationSystem: body.educationSystem === undefined ? undefined : body.educationSystem,
        contactPerson: optionalText(body, 'contactPerson'),
        contactPhone: optionalText(body, 'contactPhone'),
        contactEmail: optionalText(body, 'contactEmail'),
      },
    })
    if (name) await tx.organization.update({ where: { id: organizationId }, data: { name } })
  }, { isolationLevel: 'Serializable' }).catch(error => {
    if (error instanceof SchoolNameConflictError) conflict(error.message)
    throw error
  })
}

export async function changePlatformOrganizationDirectoryStatus(organizationId: string, body: any, actorUserId: string) {
  try {
    const result = await updateSchoolDirectoryStatus({
      organizationId, actorUserId, status: body?.status, reason: body?.reason,
      expectedUpdatedAt: body?.expectedUpdatedAt, confirmLegacy: body?.confirmLegacy,
    })
    return { school: await serializeSchool(result.school as Awaited<ReturnType<typeof findSchool>>), references: result.references }
  } catch (error) {
    if (error instanceof SchoolDirectoryGovernanceError) throw new PlatformOrganizationError(error.statusCode, error.message, error.code)
    throw error
  }
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
  await prisma.$transaction(async tx => {
    const formerPrincipals = await tx.organizationMembership.findMany({ where: { organizationId, memberRole: 'school_principal' }, select: { id: true } })
    await tx.organizationMembership.updateMany({ where: { organizationId, memberRole: 'school_principal' }, data: { memberRole: 'teacher' } })
    for (const principal of formerPrincipals) {
      await syncOrganizationMembershipBaseRole(tx, principal.id, 'teacher', { source: 'principal_transfer' })
    }
    await tx.organizationMembership.update({ where: { id: selectedMembershipId }, data: { memberRole: 'school_principal' } })
    await syncOrganizationMembershipBaseRole(tx, selectedMembershipId, 'school_principal', { source: 'principal_transfer' })
    await tx.school.update({ where: { id: school.id }, data: { currentPrincipalMembershipId: selectedMembershipId } })
  })
  const profile = await prisma.organizationTeacherProfile.findUnique({
    where: { membershipId: selectedMembershipId },
    include: { Membership: { include: { User: { select: { username: true } } } } },
  })
  return profile ? {
    id: selectedMembershipId, name: profile.name, title: profile.title, email: profile.email, user: profile.Membership.User,
  } : null
}
