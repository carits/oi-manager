import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { fileService } from '../../lib/storage'
import logger from '../../lib/logger'
import { AccountRoleSchema, type AccountRole } from '@oi-manager/contracts'
import { organizationRoleFromRoleKeys } from '../authorization/capabilities'

export type WorkspaceMode = 'work' | 'personal'

export type LoginAccountResult =
  | { ok: false; message: string }
  | {
      ok: true
      user: { id: string; username: string; role: string; avatar: string | null; sessionVersion: number }
      accountRole: AccountRole
      workspaceMode: WorkspaceMode
      isGlobalAdmin: boolean
    }

async function writeLoginLog(data: {
  userId?: string
  username: string
  accountRoleSnapshot?: string
  result: string
  failureReason?: string
  ipAddress: string
  userAgent: string
}) {
  await prisma.loginLog.create({
    data: { id: crypto.randomUUID(), ...data },
  })
}

export async function loginAccount(params: {
  username: string
  password: string
  workspaceMode: WorkspaceMode
  ipAddress: string
  userAgent: string
}): Promise<LoginAccountResult> {
  const user = await prisma.user.findUnique({ where: { username: params.username } })
  if (!user) {
    await writeLoginLog({
      username: params.username, result: 'failed_user_not_found', failureReason: '用户名不存在',
      ipAddress: params.ipAddress, userAgent: params.userAgent,
    })
    return { ok: false, message: '用户名或密码错误' }
  }
  if (!await bcrypt.compare(params.password, user.passwordHash)) {
    await writeLoginLog({
      username: params.username, accountRoleSnapshot: user.role, result: 'failed_wrong_password', failureReason: '密码错误',
      ipAddress: params.ipAddress, userAgent: params.userAgent,
    })
    return { ok: false, message: '用户名或密码错误' }
  }
  if (user.status === 'disabled') {
    await writeLoginLog({
      userId: user.id, username: params.username, accountRoleSnapshot: user.role,
      result: 'failed_account_disabled', failureReason: '账号已被禁用',
      ipAddress: params.ipAddress, userAgent: params.userAgent,
    })
    return { ok: false, message: '该账号已被禁用，请联系管理员' }
  }
  const parsedAccountRole = AccountRoleSchema.safeParse(user.role)
  if (!parsedAccountRole.success) {
    await writeLoginLog({
      userId: user.id, username: params.username, accountRoleSnapshot: user.role, result: 'failed_invalid_account_role',
      failureReason: '账号全局角色未归一', ipAddress: params.ipAddress, userAgent: params.userAgent,
    })
    return { ok: false, message: '账号权限配置无效，请联系管理员' }
  }
  const accountRole = parsedAccountRole.data
  const isGlobalAdmin = accountRole === 'super_admin' || accountRole === 'platform_admin'
  await prisma.$transaction([
    prisma.personalProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} }),
    prisma.loginLog.create({
      data: {
        id: crypto.randomUUID(), userId: user.id, username: params.username,
        accountRoleSnapshot: user.role, result: 'success', ipAddress: params.ipAddress, userAgent: params.userAgent,
      },
    }),
  ])
  return {
    ok: true,
    user: { id: user.id, username: user.username, role: user.role, avatar: user.avatar, sessionVersion: user.sessionVersion },
    accountRole,
    workspaceMode: isGlobalAdmin ? 'work' : params.workspaceMode,
    isGlobalAdmin,
  }
}

export async function registerPersonalAccount(username: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10)
  try {
    return await prisma.$transaction(async tx => {
      const existing = await tx.user.findUnique({ where: { username }, select: { id: true } })
      if (existing) return null
      const user = await tx.user.create({
        data: { id: crypto.randomUUID(), username, passwordHash, role: 'user' },
      })
      await tx.personalProfile.create({ data: { userId: user.id } })
      return user
    })
  } catch (error: any) {
    if (error?.code === 'P2002') return null
    throw error
  }
}

export async function loadCurrentAccount(
  userId: string,
  requestedOrganizationId?: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return { status: 'missing' as const }
  if (user.status === 'disabled') return { status: 'disabled' as const }
  const isGlobalAdmin = ['super_admin', 'platform_admin'].includes(user.role)
  const membership = isGlobalAdmin || !requestedOrganizationId ? null
    : await prisma.organizationMembership.findFirst({
        where: { organizationId: requestedOrganizationId, userId, status: 'active' },
        include: { StudentProfile: true, TeacherProfile: true, RoleAssignments: { select: { roleKey: true } } },
      })
  const organizationId = membership?.organizationId
  const organizationRole = membership ? organizationRoleFromRoleKeys(membership.RoleAssignments.map(item => item.roleKey)) : null
  let profile: any = null
  if (membership?.memberRole === 'student' && membership.StudentProfile) {
    profile = {
      id: membership.StudentProfile.id, name: membership.StudentProfile.name,
      avatar: membership.StudentProfile.avatar, rating: membership.StudentProfile.rating,
      enrollmentYear: membership.StudentProfile.enrollmentYear,
    }
  } else if (membership && membership.memberRole !== 'student' && membership.TeacherProfile) {
    profile = {
      id: membership.TeacherProfile.id, name: membership.TeacherProfile.name,
      avatar: membership.TeacherProfile.avatar, organizationRole,
      title: membership.TeacherProfile.title,
    }
  } else if (isGlobalAdmin) profile = { id: user.id, name: user.username }
  return {
    status: 'ok' as const,
    user,
    membership,
    organizationRole,
    organizationId,
    profile,
    isGlobalAdmin,
  }
}

export async function resolveWorkspaceSwitch(userId: string, workspaceMode: WorkspaceMode) {
  if (workspaceMode === 'personal') {
    await prisma.personalProfile.upsert({ where: { userId }, create: { userId }, update: {} })
  }
}

export async function updateAccountProfile(
  payload: JwtPayload,
  data: { avatar?: string | null; phone?: string | null; email?: string | null; bio?: string | null },
) {
  return prisma.user.update({
    where: { id: payload.userId },
    data: { avatar: data.avatar, phone: data.phone, email: data.email, bio: data.bio },
  })
}

function publicFileId(url: string | null | undefined) {
  return url?.match(/^\/api\/files\/([^/]+)\/public$/)?.[1] || null
}

export async function uploadAccountAvatar(payload: JwtPayload, file: Express.Multer.File) {
  const oldUser = await prisma.user.findUnique({ where: { id: payload.userId }, select: { avatar: true } })
  const uploaded = await fileService.uploadFromMulter(file, {
    category: 'avatar', ownerType: 'user', ownerId: payload.userId, isPublic: true,
  })
  const avatar = `/api/files/${uploaded.id}/public`
  try {
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: payload.userId }, data: { avatar } })
      if (!payload.organizationMembershipId) return
      const membership = await tx.organizationMembership.findFirst({
        where: { id: payload.organizationMembershipId, userId: payload.userId, status: 'active' },
        select: { memberRole: true },
      })
      if (membership?.memberRole === 'student') {
        await tx.organizationStudentProfile.updateMany({
          where: { membershipId: payload.organizationMembershipId }, data: { avatar },
        })
      } else if (membership) {
        await tx.organizationTeacherProfile.updateMany({
          where: { membershipId: payload.organizationMembershipId }, data: { avatar },
        })
      }
    })
  } catch (error) {
    await fileService.hardDelete(uploaded.id).catch(() => {})
    throw error
  }
  const oldFileId = publicFileId(oldUser?.avatar)
  if (oldFileId && oldFileId !== uploaded.id) await fileService.hardDelete(oldFileId).catch(() => {})
  return { avatar, fileId: uploaded.id, originalName: uploaded.originalName }
}

export async function changeAccountPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
  if (!user) return { ok: false as const, statusCode: 404, message: '用户不存在' }
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
    return { ok: false as const, statusCode: 400, message: '当前密码错误' }
  }
  if (currentPassword === newPassword) {
    return { ok: false as const, statusCode: 400, message: '新密码不能与当前密码相同' }
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  })
  logger.audit('password_change_success', { userId, action: 'password_change' })
  return { ok: true as const, sessionVersion: updated.sessionVersion }
}

export async function revokeOtherAccountSessions(userId: string) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  })
  logger.audit('other_sessions_revoked', { userId, action: 'session_revoke' })
  return updated.sessionVersion
}
