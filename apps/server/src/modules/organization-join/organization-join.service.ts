import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { notificationService } from '../notification/notification.service'
import { syncOrganizationMembershipBaseRole } from '../authorization/membership-role-assignment'
import {
  resolveOrganizationAuthorization,
  resolveOrganizationAuthorizationsForOrganization,
} from '../authorization/capabilities'

export class OrganizationJoinError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code: string) {
    super(message)
    this.name = 'OrganizationJoinError'
  }
}

export type JoinActor = {
  userId: string
  role: string
  organizationId?: string | null
  organizationMembershipId?: string | null
}

function error(status: number, code: string, message: string): never {
  throw new OrganizationJoinError(status, message, code)
}
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const profileData = (value: unknown): Prisma.InputJsonValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Prisma.InputJsonValue : undefined
const isGlobal = (role: string) => role === 'super_admin' || role === 'platform_admin'
const relationForRole = (role: string, value: unknown) => {
  const requested = text(value, 32)
  if (role === 'student') return requested === 'preselected' ? 'preselected' : 'enrolled'
  if (role === 'teacher') return requested === 'external_coach' ? 'external_coach' : 'employee'
  error(422, 'JOIN_APPLICATION_ROLE_INVALID', '申请身份无效')
}

function requirePersonalActor(actor: JoinActor) {
  if (isGlobal(actor.role)) error(403, 'ORGANIZATION_JOIN_FORBIDDEN', '全局管理员不能申请加入学校')
}

async function expireInvitations() {
  await prisma.organizationInvitation.updateMany({ where: { status: 'pending', expiresAt: { lte: new Date() } }, data: { status: 'expired', respondedAt: new Date() } })
}

async function managerMembership(actor: JoinActor, organizationId: string) {
  if (actor.organizationId !== organizationId) error(403, 'ORGANIZATION_CONTEXT_REQUIRED', '请从对应校园身份进入')
  const authorization = await resolveOrganizationAuthorization(actor.userId, organizationId)
  if (!authorization || authorization.membershipId !== actor.organizationMembershipId) {
    error(403, 'JOIN_APPLICATION_FORBIDDEN', '无权管理该学校的加入流程')
  }
  const managesStudents = authorization.capabilities.has('membership.manage.students')
  const managesTeachers = authorization.capabilities.has('membership.manage.teachers')
  if (!managesStudents && !managesTeachers) error(403, 'JOIN_APPLICATION_FORBIDDEN', '无权管理该学校的加入流程')
  return { id: authorization.membershipId, managesStudents, managesTeachers }
}

async function audit(tx: Prisma.TransactionClient, input: { organizationId: string; actor: JoinActor; action: string; targetUserId?: string; sourceType?: string; sourceId?: string; metadata?: Prisma.InputJsonValue }) {
  await tx.organizationAuditLog.create({ data: {
    id: crypto.randomUUID(), organizationId: input.organizationId, actorUserId: input.actor.userId,
    actorMembershipId: input.actor.organizationMembershipId || null, action: input.action,
    targetUserId: input.targetUserId || null, sourceType: input.sourceType || null, sourceId: input.sourceId || null,
    metadata: input.metadata,
  } })
}

export async function listOrganizationDirectory(actor: JoinActor, query: Record<string, unknown>) {
  requirePersonalActor(actor)
  await expireInvitations()
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))
  const q = text(query.q, 100)
  const where: Prisma.OrganizationWhereInput = {
    type: 'school', status: 'active', School: { is: { status: 'active', directoryStatus: 'verified' } },
    ...(q ? { OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { School: { is: { shortName: { contains: q, mode: 'insensitive' } } } },
      { School: { is: { region: { contains: q, mode: 'insensitive' } } } },
    ] } : {}),
  }
  const [items, total] = await Promise.all([
    prisma.organization.findMany({ where, include: {
      School: { select: { shortName: true, region: true, schoolType: true, schoolNature: true } },
      Membership: { where: { userId: actor.userId }, select: { id: true, status: true, memberRole: true, relationType: true }, take: 1 },
      JoinApplications: { where: { userId: actor.userId, status: 'pending' }, select: { id: true, status: true }, take: 1 },
      Invitations: { where: { userId: actor.userId, status: 'pending' }, select: { id: true, status: true, expiresAt: true }, take: 1 },
    }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.organization.count({ where }),
  ])
  return { items: items.map(item => ({
    id: item.id, name: item.name, shortName: item.School?.shortName || null, type: item.type,
    region: item.School?.region || null, schoolType: item.School?.schoolType || null,
    schoolNature: item.School?.schoolNature || null, joinPolicy: item.joinPolicy,
    relationship: item.Membership[0] ? { type: 'membership', ...item.Membership[0] }
      : item.JoinApplications[0] ? { type: 'application', ...item.JoinApplications[0] }
      : item.Invitations[0] ? { type: 'invitation', ...item.Invitations[0] }
      : null,
  })), total, page, pageSize }
}

export async function listMyOrganizations(actor: JoinActor) {
  requirePersonalActor(actor)
  await expireInvitations()
  const [memberships, applications, invitations] = await Promise.all([
    prisma.organizationMembership.findMany({ where: { userId: actor.userId, status: { in: ['active', 'disabled', 'archived'] }, Organization: { School: { is: { directoryStatus: { not: 'legacy' } } } } }, include: { Organization: { include: { School: true } } }, orderBy: { updatedAt: 'desc' } }),
    prisma.organizationJoinApplication.findMany({ where: { userId: actor.userId, Organization: { School: { is: { directoryStatus: { not: 'legacy' } } } } }, include: { Organization: { include: { School: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.organizationInvitation.findMany({ where: { userId: actor.userId, Organization: { School: { is: { directoryStatus: { not: 'legacy' } } } } }, include: { Organization: { include: { School: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ])
  return { memberships, applications, invitations }
}

export async function createJoinApplication(actor: JoinActor, body: Record<string, unknown>) {
  requirePersonalActor(actor)
  const organizationId = text(body.organizationId, 100)
  const requestedRole = text(body.requestedRole, 20)
  const realName = text(body.realName, 80)
  if (!organizationId || !realName) error(422, 'JOIN_APPLICATION_INVALID', '请选择学校并填写真实姓名')
  const requestedRelationType = relationForRole(requestedRole, body.requestedRelationType ?? body.relationType)
  const recentCount = await prisma.organizationJoinApplication.count({ where: { userId: actor.userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } } })
  if (recentCount >= 10) error(429, 'JOIN_APPLICATION_RATE_LIMITED', '今日申请次数已达上限')
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, type: 'school', status: 'active', School: { is: { status: 'active', directoryStatus: 'verified' } } } })
  if (!organization) error(404, 'ORGANIZATION_NOT_FOUND', '学校不存在')
  if (organization.joinPolicy !== 'approval') error(409, 'ORGANIZATION_JOIN_CLOSED', organization.joinPolicy === 'invite_only' ? '该学校仅支持邀请加入' : '该学校暂不接受加入申请')
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: actor.userId } } })
  if (membership?.status === 'active') error(409, 'ORGANIZATION_ALREADY_MEMBER', '你已经是该学校成员')
  if (membership?.status === 'disabled') error(409, 'ORGANIZATION_MEMBERSHIP_DISABLED', '你在该学校的成员身份已停用，请联系学校负责人')
  const invitation = await prisma.organizationInvitation.findFirst({ where: { organizationId, userId: actor.userId, status: 'pending' } })
  if (invitation) error(409, 'ORGANIZATION_INVITATION_PENDING', '该学校已邀请你加入，请先处理邀请')
  const existing = await prisma.organizationJoinApplication.findFirst({ where: { organizationId, userId: actor.userId, status: 'pending' } })
  if (existing) error(409, 'JOIN_APPLICATION_EXISTS', '你已有一条等待审核的申请')
  const recipientCapability = requestedRole === 'teacher' ? 'membership.manage.teachers' : 'membership.manage.students'
  const recipients = (await resolveOrganizationAuthorizationsForOrganization(organizationId))
    .filter(item => item.capabilities.has(recipientCapability))
  return prisma.$transaction(async tx => {
    const application = await tx.organizationJoinApplication.create({ data: {
      id: crypto.randomUUID(), organizationId, userId: actor.userId, requestedRole, requestedRelationType,
      realName, profileData: profileData(body.profileData), message: text(body.message, 1000) || null,
    } })
    for (const recipient of recipients) await notificationService.create({
      userId: recipient.userId, contextType: 'organization', organizationId,
      type: 'organization_join_application_received', title: '收到加入申请',
      body: `${realName} 申请以${requestedRole === 'teacher' ? '教师' : '学生'}身份加入「${organization.name}」`,
      href: `/org/${organizationId}/management?tab=applications&applicationId=${application.id}`,
      sourceType: 'organization_join_application', sourceId: application.id,
    }, tx)
    await audit(tx, { organizationId, actor, action: 'join_application_submitted', targetUserId: actor.userId, sourceType: 'join_application', sourceId: application.id })
    return application
  })
}

export async function cancelJoinApplication(actor: JoinActor, id: string) {
  const application = await prisma.organizationJoinApplication.findFirst({ where: { id, userId: actor.userId } })
  if (!application) error(404, 'JOIN_APPLICATION_NOT_FOUND', '申请不存在')
  await prisma.$transaction(async tx => {
    const updated = await tx.organizationJoinApplication.updateMany({ where: { id, userId: actor.userId, status: 'pending' }, data: { status: 'cancelled' } })
    if (!updated.count) error(409, 'JOIN_APPLICATION_ALREADY_PROCESSED', '该申请已经被处理')
    await audit(tx, { organizationId: application.organizationId, actor, action: 'join_application_cancelled', targetUserId: actor.userId, sourceType: 'join_application', sourceId: id })
  })
}

export async function listJoinApplications(actor: JoinActor, organizationId: string, query: Record<string, unknown>) {
  const manager = await managerMembership(actor, organizationId)
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(String(query.status)) ? String(query.status) : undefined
  const requestedRole = !manager.managesTeachers ? 'student' : ['student', 'teacher'].includes(String(query.role)) ? String(query.role) : undefined
  const q = text(query.q, 100)
  const where: Prisma.OrganizationJoinApplicationWhereInput = { organizationId, ...(status ? { status } : {}), ...(requestedRole ? { requestedRole } : {}), ...(q ? { OR: [{ realName: { contains: q, mode: 'insensitive' } }, { User: { username: { contains: q, mode: 'insensitive' } } }] } : {}) }
  const [items, total, pending] = await Promise.all([
    prisma.organizationJoinApplication.findMany({ where, include: { User: { select: { username: true, avatar: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.organizationJoinApplication.count({ where }),
    prisma.organizationJoinApplication.count({ where: { organizationId, status: 'pending', ...(!manager.managesTeachers ? { requestedRole: 'student' } : {}) } }),
  ])
  return { items, total, pending, page, pageSize }
}

export async function getJoinApplication(actor: JoinActor, organizationId: string, id: string) {
  const manager = await managerMembership(actor, organizationId)
  const application = await prisma.organizationJoinApplication.findFirst({ where: { id, organizationId, ...(!manager.managesTeachers ? { requestedRole: 'student' } : {}) }, include: { User: { select: { username: true, avatar: true } } } })
  if (!application) error(404, 'JOIN_APPLICATION_NOT_FOUND', '申请不存在')
  return application
}

async function activateMembership(tx: Prisma.TransactionClient, input: { organizationId: string; userId: string; role: string; relationType: string; realName: string; profile: Record<string, unknown>; headTeacherMembershipId?: string | null }) {
  const existing = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } } })
  if (existing?.status === 'active') error(409, 'ORGANIZATION_ALREADY_MEMBER', '该用户已经是学校成员')
  if (existing?.status === 'disabled') error(409, 'ORGANIZATION_MEMBERSHIP_DISABLED', '该成员已停用，请先在成员管理中启用')
  const membership = existing
    ? await tx.organizationMembership.update({ where: { id: existing.id }, data: { memberRole: input.role, relationType: input.relationType, status: 'active', invitedBy: null, joinedAt: new Date() } })
    : await tx.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId: input.organizationId, userId: input.userId, memberRole: input.role, relationType: input.relationType, status: 'active', joinedAt: new Date() } })
  await syncOrganizationMembershipBaseRole(tx, membership.id, input.role, { source: 'organization_join' })
  if (input.role === 'student') {
    await tx.organizationTeacherProfile.updateMany({ where: { membershipId: membership.id }, data: { status: 'archived' } })
    await tx.organizationStudentProfile.upsert({ where: { membershipId: membership.id }, create: {
      id: crypto.randomUUID(), membershipId: membership.id, name: input.realName,
      enrollmentYear: Number(input.profile.enrollmentYear) || null, headTeacherMembershipId: input.headTeacherMembershipId || null, status: 'active',
    }, update: { name: input.realName, enrollmentYear: Number(input.profile.enrollmentYear) || null, headTeacherMembershipId: input.headTeacherMembershipId || null, status: 'active' } })
  } else {
    await tx.organizationStudentProfile.updateMany({ where: { membershipId: membership.id }, data: { status: 'archived' } })
    await tx.organizationTeacherProfile.upsert({ where: { membershipId: membership.id }, create: {
      id: crypto.randomUUID(), membershipId: membership.id, name: input.realName, title: text(input.profile.title, 100) || null, status: 'active',
    }, update: { name: input.realName, title: text(input.profile.title, 100) || null, status: 'active' } })
  }
  return membership
}

export async function decideJoinApplication(actor: JoinActor, organizationId: string, id: string, decision: 'approve' | 'reject', body: Record<string, unknown>) {
  const manager = await managerMembership(actor, organizationId)
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`
    const application = await tx.organizationJoinApplication.findFirst({ where: { id, organizationId } })
    if (!application) error(404, 'JOIN_APPLICATION_NOT_FOUND', '申请不存在')
    if (application.status !== 'pending') error(409, 'JOIN_APPLICATION_ALREADY_PROCESSED', '该申请已经被处理')
    if (!manager.managesTeachers && application.requestedRole !== 'student') error(403, 'JOIN_APPLICATION_FORBIDDEN', '当前权限只能审批学生申请')
    const decisionMessage = text(body.decisionMessage, 500) || null
    const internalReviewNote = text(body.internalReviewNote, 1000) || null
    if (decision === 'reject') {
      await tx.organizationJoinApplication.update({ where: { id }, data: { status: 'rejected', reviewedByUserId: actor.userId, reviewedByMembershipId: manager.id, reviewedAt: new Date(), decisionMessage, internalReviewNote } })
      await audit(tx, { organizationId, actor, action: 'join_application_rejected', targetUserId: application.userId, sourceType: 'join_application', sourceId: id })
      await notificationService.create({ userId: application.userId, contextType: 'account', type: 'organization_join_application_rejected', title: '加入申请未通过', body: decisionMessage || '学校未通过你的加入申请', href: '/personal/organizations', sourceType: 'organization_join_application_decision', sourceId: id }, tx)
      return { status: 'rejected' }
    }
    const relationType = relationForRole(application.requestedRole, body.relationType || application.requestedRelationType)
    let headTeacherMembershipId = application.requestedRole === 'student' ? text(body.headTeacherMembershipId, 100) || null : null
    if (!manager.managesTeachers) headTeacherMembershipId = manager.id
    if (headTeacherMembershipId) {
      const teacher = await tx.organizationMembership.findFirst({ where: { id: headTeacherMembershipId, organizationId, status: 'active', TeacherProfile: { is: { status: 'active' } } } })
      if (!teacher) error(422, 'HEAD_TEACHER_INVALID', '指定教师不存在或不可用')
    }
    const baseProfile = application.profileData && typeof application.profileData === 'object' && !Array.isArray(application.profileData) ? application.profileData as Record<string, unknown> : {}
    const providedProfile = body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile) ? body.profile as Record<string, unknown> : {}
    const membership = await activateMembership(tx, { organizationId, userId: application.userId, role: application.requestedRole, relationType, realName: text(providedProfile.name, 80) || application.realName, profile: { ...baseProfile, ...providedProfile }, headTeacherMembershipId })
    await tx.organizationJoinApplication.update({ where: { id }, data: { status: 'approved', reviewedByUserId: actor.userId, reviewedByMembershipId: manager.id, reviewedAt: new Date(), decisionMessage, internalReviewNote } })
    await tx.organizationInvitation.updateMany({ where: { organizationId, userId: application.userId, status: 'pending' }, data: { status: 'revoked', respondedAt: new Date() } })
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } })
    await audit(tx, { organizationId, actor, action: 'join_application_approved', targetUserId: application.userId, sourceType: 'join_application', sourceId: id, metadata: { membershipId: membership.id } })
    await notificationService.create({ userId: application.userId, contextType: 'account', type: 'organization_join_application_approved', title: '加入申请已通过', body: `你已加入「${organization.name}」`, href: `/org/${organizationId}/overview`, sourceType: 'organization_join_application_decision', sourceId: id }, tx)
    return { status: 'approved', membershipId: membership.id }
  }, { isolationLevel: 'Serializable' })
}

export async function createOrganizationInvitation(actor: JoinActor, organizationId: string, body: Record<string, unknown>) {
  const manager = await managerMembership(actor, organizationId)
  const memberRole = text(body.memberRole, 20) === 'teacher' ? 'teacher' : 'student'
  if (!manager.managesTeachers && memberRole !== 'student') error(403, 'ORGANIZATION_INVITATION_FORBIDDEN', '当前权限只能邀请学生')
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, type: 'school', status: 'active', School: { is: { directoryStatus: { not: 'legacy' } } } } })
  if (!organization) error(404, 'ORGANIZATION_NOT_FOUND', '学校不存在')
  if (organization.joinPolicy === 'closed') error(409, 'ORGANIZATION_JOIN_CLOSED', '该学校已关闭加入和邀请')
  const username = text(body.username, 80)
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } })
  if (!target) error(404, 'USER_NOT_FOUND', '用户不存在')
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: target.id } } })
  if (membership?.status === 'active') error(409, 'ORGANIZATION_ALREADY_MEMBER', '该用户已经是学校成员')
  if (membership?.status === 'disabled') error(409, 'ORGANIZATION_MEMBERSHIP_DISABLED', '该成员已停用，请先在成员管理中启用')
  const application = await prisma.organizationJoinApplication.findFirst({ where: { organizationId, userId: target.id, status: 'pending' } })
  if (application) error(409, 'JOIN_APPLICATION_PENDING', '该用户已有待审核申请，请直接处理申请')
  if (await prisma.organizationInvitation.findFirst({ where: { organizationId, userId: target.id, status: 'pending' } })) error(409, 'ORGANIZATION_INVITATION_EXISTS', '该用户已有待处理邀请')
  const relationType = relationForRole(memberRole, body.relationType)
  const requestedHeadTeacherId = memberRole === 'student' ? !manager.managesTeachers ? manager.id : text(body.headTeacherMembershipId, 100) || null : null
  if (requestedHeadTeacherId) {
    const assignedTeacher = await prisma.organizationMembership.findFirst({ where: { id: requestedHeadTeacherId, organizationId, status: 'active', TeacherProfile: { is: { status: 'active' } } }, select: { id: true } })
    if (!assignedTeacher) error(422, 'HEAD_TEACHER_INVALID', '指定教师不存在或不可用')
  }
  const invitation = await prisma.$transaction(async tx => {
    const created = await tx.organizationInvitation.create({ data: {
      id: crypto.randomUUID(), organizationId, userId: target.id, memberRole, relationType,
      invitedByUserId: actor.userId, invitedByMembershipId: manager.id,
      headTeacherMembershipId: requestedHeadTeacherId,
      profileData: profileData(body.profileData), message: text(body.message, 1000) || null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    } })
    await audit(tx, { organizationId, actor, action: 'invitation_created', targetUserId: target.id, sourceType: 'organization_invitation', sourceId: created.id })
    await notificationService.create({ userId: target.id, contextType: 'account', type: 'organization_invitation', title: '收到学校邀请', body: `${organization.name} 邀请你以${memberRole === 'teacher' ? '教师' : '学生'}身份加入`, href: '/personal/organizations', sourceType: 'organization_invitation', sourceId: created.id }, tx)
    return created
  })
  return invitation
}

export async function listOrganizationInvitations(actor: JoinActor, organizationId: string, query: Record<string, unknown>) {
  const manager = await managerMembership(actor, organizationId)
  await expireInvitations()
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))
  const status = ['pending', 'accepted', 'declined', 'revoked', 'expired'].includes(String(query.status)) ? String(query.status) : undefined
  const where: Prisma.OrganizationInvitationWhereInput = { organizationId, ...(status ? { status } : {}), ...(!manager.managesTeachers ? { memberRole: 'student', invitedByMembershipId: manager.id } : {}) }
  const [items, total, pending] = await Promise.all([
    prisma.organizationInvitation.findMany({ where, include: { User: { select: { username: true, avatar: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.organizationInvitation.count({ where }), prisma.organizationInvitation.count({ where: { ...where, status: 'pending' } }),
  ])
  return { items, total, pending, page, pageSize }
}

export async function revokeOrganizationInvitation(actor: JoinActor, organizationId: string, id: string) {
  const manager = await managerMembership(actor, organizationId)
  const invitation = await prisma.organizationInvitation.findFirst({ where: { id, organizationId, ...(!manager.managesTeachers ? { invitedByMembershipId: manager.id, memberRole: 'student' } : {}) } })
  if (!invitation) error(404, 'ORGANIZATION_INVITATION_NOT_FOUND', '邀请不存在')
  await prisma.$transaction(async tx => {
    const result = await tx.organizationInvitation.updateMany({ where: { id, status: 'pending' }, data: { status: 'revoked', respondedAt: new Date() } })
    if (!result.count) error(409, 'ORGANIZATION_INVITATION_ALREADY_PROCESSED', '该邀请已经被处理')
    await audit(tx, { organizationId, actor: { ...actor, organizationMembershipId: manager.id }, action: 'invitation_revoked', targetUserId: invitation.userId, sourceType: 'organization_invitation', sourceId: id })
  })
}

export async function respondToInvitation(actor: JoinActor, id: string, decision: 'accept' | 'decline') {
  requirePersonalActor(actor)
  return prisma.$transaction(async tx => {
    const invitation = await tx.organizationInvitation.findFirst({ where: { id, userId: actor.userId } })
    if (!invitation) error(404, 'ORGANIZATION_INVITATION_NOT_FOUND', '邀请不存在')
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invitation.organizationId}))`
    const current = await tx.organizationInvitation.findUniqueOrThrow({ where: { id } })
    const available = await tx.school.findFirst({ where: { organizationId: current.organizationId, directoryStatus: { not: 'legacy' } }, select: { id: true } })
    if (!available) error(404, 'ORGANIZATION_NOT_AVAILABLE', '该组织不可用')
    if (current.status !== 'pending') error(409, 'ORGANIZATION_INVITATION_ALREADY_PROCESSED', '该邀请已经被处理')
    if (current.expiresAt && current.expiresAt <= new Date()) {
      await tx.organizationInvitation.update({ where: { id }, data: { status: 'expired', respondedAt: new Date() } })
      error(409, 'ORGANIZATION_INVITATION_EXPIRED', '该邀请已经过期')
    }
    if (decision === 'decline') {
      await tx.organizationInvitation.update({ where: { id }, data: { status: 'declined', respondedAt: new Date() } })
      await tx.userNotification.updateMany({ where: { userId: actor.userId, contextKey: 'account', sourceType: 'organization_invitation', sourceId: id, readAt: null }, data: { readAt: new Date() } })
      await audit(tx, { organizationId: current.organizationId, actor, action: 'invitation_declined', targetUserId: actor.userId, sourceType: 'organization_invitation', sourceId: id })
      return { status: 'declined' }
    }
    const p = current.profileData && typeof current.profileData === 'object' && !Array.isArray(current.profileData) ? current.profileData as Record<string, unknown> : {}
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { username: true } })
    const membership = await activateMembership(tx, { organizationId: current.organizationId, userId: actor.userId, role: current.memberRole, relationType: current.relationType, realName: text(p.name, 80) || user.username, profile: p, headTeacherMembershipId: current.headTeacherMembershipId })
    await tx.organizationInvitation.update({ where: { id }, data: { status: 'accepted', respondedAt: new Date() } })
    await tx.userNotification.updateMany({ where: { userId: actor.userId, contextKey: 'account', sourceType: 'organization_invitation', sourceId: id, readAt: null }, data: { readAt: new Date() } })
    await tx.organizationJoinApplication.updateMany({ where: { organizationId: current.organizationId, userId: actor.userId, status: 'pending' }, data: { status: 'cancelled' } })
    await audit(tx, { organizationId: current.organizationId, actor, action: 'invitation_accepted', targetUserId: actor.userId, sourceType: 'organization_invitation', sourceId: id, metadata: { membershipId: membership.id } })
    await notificationService.create({ userId: current.invitedByUserId, contextType: 'organization', organizationId: current.organizationId, type: 'organization_invitation_accepted', title: '学校邀请已接受', body: `${user.username} 已接受邀请`, href: `/org/${current.organizationId}/management?tab=invitations`, sourceType: 'organization_invitation_response', sourceId: id }, tx)
    return { status: 'accepted', membershipId: membership.id, organizationId: current.organizationId }
  }, { isolationLevel: 'Serializable' })
}

export async function updateJoinPolicy(actor: JoinActor, organizationId: string, value: unknown) {
  const policy = text(value, 32)
  if (!['invite_only', 'approval', 'closed'].includes(policy)) error(422, 'ORGANIZATION_JOIN_POLICY_INVALID', '加入策略无效')
  if (actor.role !== 'super_admin') {
    const manager = await managerMembership(actor, organizationId)
    const authorization = await resolveOrganizationAuthorization(actor.userId, organizationId)
    if (!authorization?.capabilities.has('organization.settings') || authorization.membershipId !== manager.id) {
      error(403, 'ORGANIZATION_JOIN_POLICY_FORBIDDEN', '当前身份无权修改加入策略')
    }
  }
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, type: 'school', School: { is: { directoryStatus: { not: 'legacy' } } } } })
  if (!organization) error(404, 'ORGANIZATION_NOT_FOUND', '学校不存在')
  await prisma.$transaction([
    prisma.organization.update({ where: { id: organizationId }, data: { joinPolicy: policy } }),
    prisma.organizationAuditLog.create({ data: { id: crypto.randomUUID(), organizationId, actorUserId: actor.userId, actorMembershipId: actor.organizationMembershipId || null, action: 'join_policy_updated', metadata: { policy } } }),
  ])
  return { joinPolicy: policy }
}
