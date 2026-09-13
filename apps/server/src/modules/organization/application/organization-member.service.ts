import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { calculateGrade, getAllGrades } from '@oi-manager/shared/utils/grade'
import { paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'
import { listContestRuntimesForDashboard } from '../../contest/contest-query.facade'
import { createContestRuntimeTx } from '../../contest/contest-command.service'
import { syncOrganizationMembershipBaseRole } from '../../authorization/membership-role-assignment'

export class OrganizationMemberError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code?: string) {
    super(message)
    this.name = 'OrganizationMemberError'
  }
}

export interface OrganizationActor {
  organizationId: string
  userId: string
  role: string
  organizationMembershipId?: string | null
}

function notFound(message: string): never { throw new OrganizationMemberError(404, message) }
function badRequest(message: string): never { throw new OrganizationMemberError(400, message) }
function forbidden(message: string): never { throw new OrganizationMemberError(403, message) }

function normalizeEducationSystemDetail(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const detail = value as Record<string, unknown>
  return {
    primaryYears: typeof detail.primaryYears === 'number' ? detail.primaryYears : undefined,
    middleYears: typeof detail.middleYears === 'number' ? detail.middleYears : undefined,
    highYears: typeof detail.highYears === 'number' ? detail.highYears : undefined,
  }
}

function maskContact(value: string | null) {
  if (!value) return null
  return value.length > 7 ? `${value.slice(0, 3)} **** ${value.slice(-4)}` : '已隐藏'
}

function maskEmail(value: string | null) {
  if (!value) return null
  const [name, domain] = value.split('@')
  return domain ? `${name.slice(0, 2) || '*'}***@${domain}` : '已隐藏'
}

function activityStatus(startTime: Date, endTime: Date) {
  const now = Date.now()
  if (now < startTime.getTime()) return 'upcoming'
  if (now <= endTime.getTime()) return 'ongoing'
  return 'finished'
}

async function schoolFor(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { School: true },
  })
  if (!organization?.School) notFound('未找到校园资料')
  return organization.School
}

export async function getCampus(actor: OrganizationActor) {
  const school = await schoolFor(actor.organizationId)
  const organization = await prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { joinPolicy: true } })
  const principal = school.currentPrincipalMembershipId
    ? await prisma.organizationTeacherProfile.findUnique({ where: { membershipId: school.currentPrincipalMembershipId }, select: { name: true, title: true } })
    : null
  const canViewContact = actor.role === 'school_principal'
  return {
    ...school,
    joinPolicy: organization?.joinPolicy || 'invite_only',
    principal,
    contactPhone: canViewContact ? school.contactPhone : maskContact(school.contactPhone),
    contactEmail: canViewContact ? school.contactEmail : maskEmail(school.contactEmail),
    contactMasked: !canViewContact,
  }
}

export async function updateCampus(actor: OrganizationActor, body: any) {
  const school = await schoolFor(actor.organizationId)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) badRequest('请填写校园名称')
  const text = (key: string) => body[key] === undefined ? undefined : typeof body[key] === 'string' ? body[key].trim() || null : null
  const educationSystem = ['6-3-3', '5-4-3', '6-3', '5-4', 'custom'].includes(body.educationSystem) ? body.educationSystem : undefined
  await prisma.school.update({ where: { id: school.id }, data: {
    name, shortName: text('shortName'), description: text('description'), region: text('region'),
    schoolType: text('schoolType'), schoolNature: text('schoolNature'), contactPerson: text('contactPerson'),
    contactPhone: text('contactPhone'), contactEmail: text('contactEmail'), educationSystem,
    educationSystemDetail: body.educationSystem === 'custom' ? body.educationSystemDetail : educationSystem ? null : undefined,
  } })
}

export async function updateCampusAnnouncement(actor: OrganizationActor, announcement: unknown) {
  const school = await schoolFor(actor.organizationId)
  await prisma.school.update({ where: { id: school.id }, data: { announcement: typeof announcement === 'string' ? announcement.trim() || null : null } })
}

async function memberTeamIds(actor: OrganizationActor) {
  const members = await prisma.teamMember.findMany({
    where: { userId: actor.userId, status: 'active', Team: { organizationId: actor.organizationId, scope: 'campus' } },
    select: { teamId: true },
  })
  return members.map(item => item.teamId)
}

export async function listOrganizationActivities(actor: OrganizationActor, type: 'homework' | 'contest') {
  const teamIds = await memberTeamIds(actor)
  const trainings = type === 'contest'
    ? await listContestRuntimesForDashboard({
      teamIds,
      resourceScope: 'campus',
      organizationId: actor.organizationId,
    })
    : teamIds.length ? await prisma.training.findMany({
      where: { organizationId: actor.organizationId, teamId: { in: teamIds }, type }, orderBy: { startTime: 'desc' },
      include: { _count: { select: { TrainingProblem: true } } },
    }) : []
  return trainings.map(training => ({
    id: training.id, title: training.title, description: training.description,
    startTime: training.startTime, endTime: training.endTime, status: activityStatus(training.startTime, training.endTime),
    format: training.format, teamId: training.teamId, problemCount: training._count.TrainingProblem,
    ...(type === 'contest' ? { source: training.teamId ? 'team' : 'school' } : {}), createdAt: training.createdAt,
  })).sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
}

export async function createOrganizationContest(actor: OrganizationActor, body: any) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const format = ['oi', 'ioi', 'icpc'].includes(body.format) ? body.format : 'ioi'
  const startTime = new Date(body.startTime)
  const endTime = new Date(body.endTime)
  if (!title || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    badRequest('请填写有效的比赛名称和时间范围')
  }
  return prisma.$transaction(async tx => {
    return createContestRuntimeTx(tx, {
      title, description: typeof body.description === 'string' ? body.description.trim() || null : null,
      format, scope: 'campus', teamId: null, organizationId: actor.organizationId, startTime, endTime,
      createdBy: actor.userId, problemIdVisible: Boolean(body.problemIdVisible), solutionVisible: Boolean(body.solutionVisible),
      includeAdminInRanking: Boolean(body.includeAdminInRanking), status: activityStatus(startTime, endTime),
    })
  })
}

export async function listOrganizationStudents(actor: OrganizationActor, query: any, page: number, pageSize: number) {
  const q = typeof query.q === 'string' ? query.q.trim() : ''
  const status = ['active', 'disabled'].includes(query.status) ? query.status : undefined
  const requestedTeacher = typeof query.headTeacherMembershipId === 'string' && query.headTeacherMembershipId ? query.headTeacherMembershipId : undefined
  const headTeacherMembershipId = actor.role === 'teacher' ? actor.organizationMembershipId || undefined : requestedTeacher
  const school = await schoolFor(actor.organizationId)
  const teamId = typeof query.teamId === 'string' && query.teamId ? query.teamId : undefined
  if (teamId) {
    const team = await prisma.team.findFirst({ where: { id: teamId, organizationId: actor.organizationId, scope: 'campus' }, select: { id: true } })
    if (!team) badRequest('筛选团队不存在或不属于当前学校')
  }
  const profileWhere = {
    Membership: { organizationId: actor.organizationId, status: 'active', ...(q ? { OR: [{ User: { username: { contains: q, mode: 'insensitive' as const } } }, { StudentProfile: { name: { contains: q, mode: 'insensitive' as const } } }] } : {}), ...(teamId ? { User: { TeamMember: { some: { teamId, status: 'active', userType: 'student' } } } } : {}) },
    ...(status ? { status } : {}), ...(headTeacherMembershipId ? { headTeacherMembershipId } : {}),
  }
  const grade = typeof query.grade === 'string' && query.grade ? query.grade : undefined
  const [profiles, unfilteredTotal] = await Promise.all([prisma.organizationStudentProfile.findMany({
    where: profileWhere,
    orderBy: [{ enrollmentYear: 'desc' }, { name: 'asc' }],
    ...(!grade ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    include: { Membership: { include: { User: { select: { id: true, username: true, avatar: true, status: true } } } } },
  }), grade ? Promise.resolve(0) : prisma.organizationStudentProfile.count({ where: profileWhere })])
  const teacherIds = [...new Set(profiles.map(item => item.headTeacherMembershipId).filter((id): id is string => Boolean(id)))]
  const teachers = teacherIds.length ? await prisma.organizationTeacherProfile.findMany({ where: { membershipId: { in: teacherIds } }, select: { membershipId: true, name: true } }) : []
  const names = new Map(teachers.map(item => [item.membershipId, item.name]))
  const rows = profiles.map(profile => ({
    id: profile.id, membershipId: profile.membershipId, userId: profile.Membership.userId, name: profile.name,
    gender: profile.gender, enrollmentYear: profile.enrollmentYear, rating: profile.rating, status: profile.status,
    headTeacherMembershipId: profile.headTeacherMembershipId,
    headTeacher: profile.headTeacherMembershipId ? { id: profile.headTeacherMembershipId, name: names.get(profile.headTeacherMembershipId) || '-' } : null,
    user: profile.Membership.User,
  }))
  const educationDetail = normalizeEducationSystemDetail(school.educationSystemDetail)
  const filtered = grade ? rows.filter(profile => calculateGrade({ enrollmentYear: profile.enrollmentYear, educationSystem: school.educationSystem, educationSystemDetail: educationDetail, schoolType: school.schoolType }) === grade) : rows
  const start = (page - 1) * pageSize
  return {
    ...paginatedResponse(grade ? filtered.slice(start, start + pageSize) : filtered, grade ? filtered.length : unfilteredTotal, page, pageSize),
    filters: { grades: getAllGrades(school.schoolType, school.educationSystem, educationDetail).filter(Boolean) },
  }
}

export async function listOrganizationTeachers(actor: OrganizationActor, query: any, page: number, pageSize: number) {
  const q = typeof query.q === 'string' ? query.q.trim() : ''
  const status = ['active', 'disabled'].includes(query.status) ? query.status : undefined
  const role = ['school_principal', 'teacher'].includes(query.role) ? query.role : undefined
  const profiles = await prisma.organizationTeacherProfile.findMany({
    where: { Membership: { organizationId: actor.organizationId, status: 'active', ...(role ? { memberRole: role } : {}), ...(q ? { OR: [{ User: { username: { contains: q, mode: 'insensitive' } } }, { TeacherProfile: { name: { contains: q, mode: 'insensitive' } } }] } : {}) }, ...(status ? { status } : {}) },
    orderBy: { name: 'asc' }, include: { Membership: { include: { User: { select: { id: true, username: true, avatar: true, status: true } } } } },
  })
  const rows = profiles.map(profile => ({ id: profile.id, membershipId: profile.membershipId, userId: profile.Membership.userId, name: profile.name, title: profile.title, email: profile.email, phone: profile.phone, status: profile.status, memberRole: profile.Membership.memberRole, user: profile.Membership.User }))
  const start = (page - 1) * pageSize
  return paginatedResponse(rows.slice(start, start + pageSize), rows.length, page, pageSize)
}

async function validateTeacher(organizationId: string, membershipId?: string | null) {
  if (!membershipId) return
  const teacher = await prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } })
  if (!teacher) badRequest('指定的主教练不存在')
}

async function studentAccess(actor: OrganizationActor, profileId: string) {
  const profile = await prisma.organizationStudentProfile.findUnique({ where: { id: profileId }, include: { Membership: true } })
  if (!profile || profile.Membership.organizationId !== actor.organizationId || profile.Membership.status !== 'active') notFound('学生档案不存在')
  if (actor.role !== 'school_principal' && profile.headTeacherMembershipId !== actor.organizationMembershipId) forbidden('无权管理该学生')
  return profile
}

export async function createOrganizationStudent(actor: OrganizationActor, body: any) {
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!username || !password || !name) badRequest('请填写用户名、密码和姓名')
  if (password.length < 6) badRequest('密码至少 6 位')
  const headTeacherMembershipId = actor.role === 'school_principal' && typeof body.headTeacherMembershipId === 'string' ? body.headTeacherMembershipId : actor.organizationMembershipId
  await validateTeacher(actor.organizationId, headTeacherMembershipId)
  if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) throw new OrganizationMemberError(409, '用户名已存在')
  return prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10), role: 'user', avatar: body.avatar || null } })
    const membership = await tx.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId: actor.organizationId, userId: user.id, memberRole: 'student', relationType: 'enrolled', status: 'active', joinedAt: new Date() } })
    await syncOrganizationMembershipBaseRole(tx, membership.id, 'student', { source: 'organization_member', grantedBy: actor.userId })
    const profile = await tx.organizationStudentProfile.create({ data: { id: crypto.randomUUID(), membershipId: membership.id, name, gender: body.gender || null, enrollmentYear: body.enrollmentYear ? Number(body.enrollmentYear) : null, targetContest: body.targetContest || null, headTeacherMembershipId: headTeacherMembershipId || null, tags: body.tags ? JSON.stringify(body.tags) : null, notes: body.notes || null, avatar: body.avatar || null } })
    return { id: profile.id, membershipId: membership.id, userId: user.id }
  })
}

export async function updateOrganizationStudent(actor: OrganizationActor, profileId: string, body: any) {
  const profile = await studentAccess(actor, profileId)
  const requestedTeacher = actor.role === 'school_principal' && typeof body.headTeacherMembershipId === 'string' ? body.headTeacherMembershipId : undefined
  if (requestedTeacher !== undefined) await validateTeacher(actor.organizationId, requestedTeacher)
  if (typeof body.password === 'string' && body.password && body.password.length < 6) badRequest('密码至少 6 位')
  await prisma.$transaction(async tx => {
    if (typeof body.password === 'string' && body.password) await tx.user.update({
      where: { id: profile.Membership.userId },
      data: { passwordHash: await bcrypt.hash(body.password, 10), sessionVersion: { increment: 1 } },
    })
    await tx.organizationStudentProfile.update({ where: { id: profile.id }, data: {
      name: typeof body.name === 'string' ? body.name.trim() || profile.name : undefined,
      gender: body.gender === undefined ? undefined : body.gender || null,
      enrollmentYear: body.enrollmentYear === undefined ? undefined : body.enrollmentYear ? Number(body.enrollmentYear) : null,
      targetContest: body.targetContest === undefined ? undefined : body.targetContest || null,
      headTeacherMembershipId: requestedTeacher, tags: body.tags === undefined ? undefined : body.tags ? JSON.stringify(body.tags) : null,
      notes: body.notes === undefined ? undefined : body.notes || null, avatar: body.avatar === undefined ? undefined : body.avatar || null,
    } })
  })
}

export async function setOrganizationStudentStatus(actor: OrganizationActor, profileId: string, status: unknown) {
  if (!['active', 'disabled'].includes(String(status))) badRequest('状态参数无效')
  const profile = await studentAccess(actor, profileId)
  await prisma.organizationStudentProfile.update({ where: { id: profile.id }, data: { status: String(status) } })
}

export async function archiveOrganizationStudent(actor: OrganizationActor, profileId: string) {
  const profile = await studentAccess(actor, profileId)
  await prisma.$transaction([
    prisma.organizationStudentProfile.update({ where: { id: profile.id }, data: { status: 'archived' } }),
    prisma.organizationMembership.update({ where: { id: profile.membershipId }, data: { status: 'archived' } }),
  ])
}

export async function transferOrganizationPrincipal(actor: OrganizationActor, newPrincipalMembershipId: unknown) {
  const targetId = typeof newPrincipalMembershipId === 'string' ? newPrincipalMembershipId : ''
  if (!targetId || !actor.organizationMembershipId) badRequest('请选择新的学校负责人')
  const [target, school] = await Promise.all([
    prisma.organizationMembership.findFirst({ where: { id: targetId, organizationId: actor.organizationId, status: 'active', memberRole: 'teacher' }, select: { id: true } }),
    prisma.school.findFirst({ where: { organizationId: actor.organizationId }, select: { id: true } }),
  ])
  if (!target || !school) badRequest('新负责人必须是当前校园的有效教师')
  await prisma.$transaction(async tx => {
    await tx.organizationMembership.update({ where: { id: actor.organizationMembershipId! }, data: { memberRole: 'teacher' } })
    await tx.organizationMembership.update({ where: { id: target.id }, data: { memberRole: 'school_principal' } })
    await syncOrganizationMembershipBaseRole(tx, actor.organizationMembershipId!, 'teacher', { source: 'principal_transfer', grantedBy: actor.userId })
    await syncOrganizationMembershipBaseRole(tx, target.id, 'school_principal', { source: 'principal_transfer', grantedBy: actor.userId })
    await tx.school.update({ where: { id: school.id }, data: { currentPrincipalMembershipId: target.id } })
  })
  return { principalMembershipId: target.id }
}

export async function createOrganizationTeacher(actor: OrganizationActor, body: any) {
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!username || !password || !name) badRequest('请填写用户名、密码和姓名')
  if (password.length < 6) badRequest('密码至少 6 位')
  if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) throw new OrganizationMemberError(409, '用户名已存在')
  return prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10), role: 'user', avatar: body.avatar || null, email: body.email || null, phone: body.phone || null } })
    const membership = await tx.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId: actor.organizationId, userId: user.id, memberRole: 'teacher', relationType: 'employee', status: 'active', joinedAt: new Date() } })
    await syncOrganizationMembershipBaseRole(tx, membership.id, 'teacher', { source: 'organization_member', grantedBy: actor.userId })
    const profile = await tx.organizationTeacherProfile.create({ data: { id: crypto.randomUUID(), membershipId: membership.id, name, email: body.email || null, phone: body.phone || null, title: body.title || null, avatar: body.avatar || null, bio: body.bio || null } })
    return { id: profile.id, membershipId: membership.id, userId: user.id }
  })
}

async function teacherProfile(actor: OrganizationActor, profileId: string) {
  const profile = await prisma.organizationTeacherProfile.findUnique({ where: { id: profileId }, include: { Membership: true } })
  if (!profile || profile.Membership.organizationId !== actor.organizationId || profile.Membership.status !== 'active') notFound('教师档案不存在')
  return profile
}

export async function updateOrganizationTeacher(actor: OrganizationActor, profileId: string, body: any) {
  const profile = await teacherProfile(actor, profileId)
  if (typeof body.password === 'string' && body.password && body.password.length < 6) badRequest('密码至少 6 位')
  await prisma.$transaction(async tx => {
    if (typeof body.password === 'string' && body.password) await tx.user.update({
      where: { id: profile.Membership.userId },
      data: { passwordHash: await bcrypt.hash(body.password, 10), sessionVersion: { increment: 1 } },
    })
    await tx.organizationTeacherProfile.update({ where: { id: profile.id }, data: {
      name: typeof body.name === 'string' ? body.name.trim() || profile.name : undefined,
      email: body.email === undefined ? undefined : body.email || null, phone: body.phone === undefined ? undefined : body.phone || null,
      title: body.title === undefined ? undefined : body.title || null, avatar: body.avatar === undefined ? undefined : body.avatar || null,
      bio: body.bio === undefined ? undefined : body.bio || null,
    } })
  })
}

export async function setOrganizationTeacherStatus(actor: OrganizationActor, profileId: string, status: unknown) {
  if (!['active', 'disabled'].includes(String(status))) badRequest('状态参数无效')
  const profile = await teacherProfile(actor, profileId)
  if (profile.Membership.id === actor.organizationMembershipId) badRequest('不能修改自己的状态')
  await prisma.organizationTeacherProfile.update({ where: { id: profile.id }, data: { status: String(status) } })
}

export async function archiveOrganizationTeacher(actor: OrganizationActor, profileId: string) {
  const profile = await teacherProfile(actor, profileId)
  if (profile.Membership.memberRole === 'school_principal') badRequest('不能删除学校负责人')
  await prisma.$transaction([
    prisma.organizationTeacherProfile.update({ where: { id: profile.id }, data: { status: 'archived' } }),
    prisma.organizationMembership.update({ where: { id: profile.membershipId }, data: { status: 'archived' } }),
  ])
}
