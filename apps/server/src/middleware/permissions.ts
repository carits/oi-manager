/**
 * 资源级权限判断。
 *
 * 校园上下文只来自请求中的 organizationId 与有效成员关系；不读取
 * 旧校园档案不参与任何权限判断。
 */
import { prisma } from '../prisma'
import { AuthRequest, getAccountRole, isPersonalContextForTeams } from './auth'
import logger from '../lib/logger'
import {
  organizationCapabilityScope,
  resolveOrganizationAuthorization,
} from '../modules/authorization/capabilities'

function logPermissionDenied(req: AuthRequest, action: string, resourceType: string, resourceId: string, reason?: string): void {
  logger.security('permission_denied', {
    userId: req.user?.userId,
    role: req.user?.accountRole,
    action: 'access_resource',
    metadata: { resourceType, resourceId, attemptedAction: action, reason }
  })
}

async function getActiveMembership(req: AuthRequest) {
  const organizationId = req.user?.organizationId
  if (!organizationId || !req.user) return null
  return prisma.organizationMembership.findFirst({
    where: { organizationId, userId: req.user.userId, status: 'active' },
    select: { id: true, organizationId: true, Organization: { select: { School: { select: { id: true } } } } }
  })
}

async function findStudentProfile(req: AuthRequest, profileId: string) {
  if (!req.user?.organizationId) return null
  return prisma.organizationStudentProfile.findFirst({
    where: {
      id: profileId,
      Membership: { organizationId: req.user.organizationId, status: 'active', memberRole: 'student' }
    },
    select: { id: true, membershipId: true, headTeacherMembershipId: true, Membership: { select: { userId: true } } }
  })
}

async function findTeacherProfile(req: AuthRequest, profileId: string) {
  if (!req.user?.organizationId) return null
  return prisma.organizationTeacherProfile.findFirst({
    where: {
      id: profileId,
      Membership: { organizationId: req.user.organizationId, status: 'active', memberRole: { in: ['teacher', 'school_principal'] } }
    },
    select: { id: true, membershipId: true, Membership: { select: { userId: true } } }
  })
}

export async function canViewStudent(req: AuthRequest, profileId: string): Promise<boolean> {
  if (!req.user) return false
  if (!isPersonalContextForTeams(req.user) && ['super_admin', 'platform_admin'].includes(getAccountRole(req.user)!)) return true
  const student = await findStudentProfile(req, profileId)
  if (!student) {
    logPermissionDenied(req, 'view_student', 'student', profileId, '学生档案不存在或不在当前校园')
    return false
  }
  const authorization = await resolveOrganizationAuthorization(req.user.userId, req.user.organizationId!)
  const hasAccess = student.Membership.userId === req.user.userId
    || Boolean(authorization?.capabilities.has('membership.view.students'))
  if (!hasAccess) logPermissionDenied(req, 'view_student', 'student', profileId, '学生只能查看自己的组织档案')
  return hasAccess
}

export async function canManageStudent(req: AuthRequest, profileId: string): Promise<boolean> {
  if (!req.user) return false
  if (!isPersonalContextForTeams(req.user) && getAccountRole(req.user) === 'super_admin') return true
  const student = await findStudentProfile(req, profileId)
  if (!student) {
    logPermissionDenied(req, 'manage_student', 'student', profileId, '学生档案不存在或不在当前校园')
    return false
  }
  const authorization = await resolveOrganizationAuthorization(req.user.userId, req.user.organizationId!)
  const scope = authorization ? organizationCapabilityScope(authorization, 'membership.manage.students') : 'none'
  if (scope === 'all') return true
  if (scope === 'none') {
    logPermissionDenied(req, 'manage_student', 'student', profileId, '需要教师或负责人权限')
    return false
  }
  const membership = await getActiveMembership(req)
  const hasAccess = student.headTeacherMembershipId === membership?.id
  if (!hasAccess) logPermissionDenied(req, 'manage_student', 'student', profileId, '教师只能管理自己负责的学生')
  return hasAccess
}

export async function canViewTeacher(req: AuthRequest, profileId: string): Promise<boolean> {
  if (!req.user) return false
  if (!isPersonalContextForTeams(req.user) && ['super_admin', 'platform_admin'].includes(getAccountRole(req.user)!)) return true
  const teacher = await findTeacherProfile(req, profileId)
  const authorization = await resolveOrganizationAuthorization(req.user.userId, req.user.organizationId!)
  const hasAccess = Boolean(teacher && authorization?.capabilities.has('organization.view'))
  if (!hasAccess) logPermissionDenied(req, 'view_teacher', 'teacher', profileId, '教师档案不存在或不在当前校园')
  return hasAccess
}

export async function canManageTeacher(req: AuthRequest, profileId: string): Promise<boolean> {
  if (!req.user) return false
  if (getAccountRole(req.user) === 'super_admin') return true
  const authorization = req.user.organizationId
    ? await resolveOrganizationAuthorization(req.user.userId, req.user.organizationId)
    : null
  if (!authorization?.capabilities.has('membership.manage.teachers')) {
    logPermissionDenied(req, 'manage_teacher', 'teacher', profileId, '需要校园负责人权限')
    return false
  }
  const teacher = await findTeacherProfile(req, profileId)
  const membership = await getActiveMembership(req)
  const hasAccess = !!teacher && teacher.membershipId !== membership?.id
  if (!hasAccess) logPermissionDenied(req, 'manage_teacher', 'teacher', profileId, '不能管理自己或教师不在当前校园')
  return hasAccess
}

export async function canViewTeam(req: AuthRequest, teamId: string): Promise<boolean> {
  const accountRole = getAccountRole(req.user)
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true, scope: true, isPublic: true }
  })
  if (!team) {
    logPermissionDenied(req, 'view_team', 'team', teamId, '团队不存在')
    return false
  }
  const expectedScope = isPersonalContextForTeams(req.user) ? 'personal' : 'campus'
  if (team.scope !== expectedScope || (team.scope === 'campus' && team.organizationId !== req.user?.organizationId)) {
    logPermissionDenied(req, 'view_team', 'team', teamId, '团队不属于当前上下文')
    return false
  }
  if (!isPersonalContextForTeams(req.user) && (accountRole === 'super_admin' || accountRole === 'platform_admin')) return true
  if (team.isPublic) return true
  const member = await prisma.teamMember.findFirst({ where: { teamId, userId: req.user?.userId, status: 'active' } })
  const hasAccess = !!member
  if (!hasAccess) logPermissionDenied(req, 'view_team', 'team', teamId, '私有团队仅限成员查看')
  return hasAccess
}

export async function canManageTeam(req: AuthRequest, teamId: string): Promise<boolean> {
  const accountRole = getAccountRole(req.user)
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { scope: true, organizationId: true } })
  const expectedScope = isPersonalContextForTeams(req.user) ? 'personal' : 'campus'
  if (!team || team.scope !== expectedScope || (team.scope === 'campus' && team.organizationId !== req.user?.organizationId)) {
    logPermissionDenied(req, 'manage_team', 'team', teamId, '团队不属于当前上下文')
    return false
  }
  if (!isPersonalContextForTeams(req.user) && accountRole === 'super_admin') return true
  const member = await prisma.teamMember.findFirst({ where: { teamId, userId: req.user?.userId, status: 'active' } })
  const hasAccess = member?.role === 'owner' || member?.role === 'admin'
  if (!hasAccess) logPermissionDenied(req, 'manage_team', 'team', teamId, '需要团队所有者或管理员权限')
  return hasAccess
}

export async function getTeamMemberRole(teamId: string, userId: string): Promise<'owner' | 'admin' | 'member' | null> {
  const member = await prisma.teamMember.findFirst({ where: { teamId, userId, status: 'active' } })
  return member?.role as 'owner' | 'admin' | 'member' | null || null
}
