import crypto from 'crypto'
import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { teamService } from '../team.service'
import { teamRepository } from '../team.repository'
import type { MemberType } from '../team.types'

export async function isTeamIdAvailable(teamId: string) {
  return !await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
}

export async function uploadTeamAvatar(teamId: string, user: any, file: Express.Multer.File) {
  const { isOwner } = await teamService.isTeamAdmin(teamId, user)
  if (!isOwner) throw new Error('NOT_OWNER')
  const result = await fileService.uploadFromMulter(file, {
    category: 'avatar', ownerType: 'team', ownerId: teamId, isPublic: true,
  })
  const avatar = `/api/files/${result.id}/public`
  try {
    await teamRepository.update(teamId, { avatar })
  } catch (error) {
    await fileService.softDelete(result.id).catch(() => undefined)
    throw error
  }
  return { avatar, fileId: result.id, originalName: result.originalName }
}

export async function processInvitation(input: {
  invitationId: string
  teamId: string
  userId: string
  userType: MemberType
  operatorType: MemberType
  accepted: boolean
}) {
  return prisma.$transaction(async tx => {
    const result = input.accepted
      ? await tx.teamMember.updateMany({
          where: { id: input.invitationId, status: 'pending', invitedBy: { not: null }, userId: input.userId },
          data: { status: 'active', joinedAt: new Date() },
        })
      : await tx.teamMember.deleteMany({
          where: { id: input.invitationId, status: 'pending', invitedBy: { not: null }, userId: input.userId },
        })
    if (result.count === 0) throw new Error('ALREADY_PROCESSED')
    await tx.teamOperationLog.create({
      data: {
        id: crypto.randomUUID(), teamId: input.teamId, operatorId: input.userId,
        operatorType: input.operatorType, action: input.accepted ? 'invite_accept' : 'invite_reject',
        targetId: input.userId, targetType: input.userType,
      },
    })
  })
}

export async function removeMemberWithLog(teamId: string, member: any, userId: string, operatorType: MemberType) {
  return prisma.$transaction(async tx => {
    const deleted = await tx.teamMember.deleteMany({ where: { id: member.id, teamId } })
    if (!deleted.count) throw new Error('MEMBER_NOT_FOUND')
    await tx.teamOperationLog.create({
      data: {
        id: crypto.randomUUID(), teamId, operatorId: userId, operatorType,
        action: 'member_remove', targetId: member.userId, targetType: member.userType,
        oldValue: member.role, newValue: 'removed',
      },
    })
  })
}

export async function findUsernames(userIds: string[]) {
  if (!userIds.length) return []
  return prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
}

export async function changeMemberRoleWithLog(input: {
  teamId: string
  member: any
  role: 'admin' | 'member'
  operatorId: string
  operatorType: MemberType
}) {
  return prisma.$transaction(async tx => {
    const changed = await tx.teamMember.updateMany({
      where: { id: input.member.id, teamId: input.teamId, role: input.member.role },
      data: { role: input.role },
    })
    if (!changed.count) throw new Error('MEMBER_CHANGED')
    await tx.teamOperationLog.create({
      data: {
        id: crypto.randomUUID(), teamId: input.teamId, operatorId: input.operatorId,
        operatorType: input.operatorType, action: 'role_change', targetId: input.member.userId,
        targetType: input.member.userType, oldValue: input.member.role, newValue: input.role,
      },
    })
    return tx.teamMember.findUniqueOrThrow({ where: { id: input.member.id } })
  })
}

export async function listPendingJoinMembers(teamId: string) {
  return prisma.teamMember.findMany({
    where: { teamId, status: 'pending', invitedBy: null },
    orderBy: { joinedAt: 'desc' },
  })
}

export async function findPendingJoinMember(requestId: string, scope: string) {
  return prisma.teamMember.findFirst({
    where: {
      OR: [{ id: requestId }, { userId: requestId }],
      status: 'pending', invitedBy: null, Team: { scope },
    },
  })
}

export async function decideJoinRequest(input: {
  member: any
  accepted: boolean
  operatorId: string
  operatorType: MemberType
}) {
  return prisma.$transaction(async tx => {
    const changed = input.accepted
      ? await tx.teamMember.updateMany({
          where: { id: input.member.id, status: 'pending', invitedBy: null },
          data: { status: 'active', joinedAt: new Date() },
        })
      : await tx.teamMember.deleteMany({ where: { id: input.member.id, status: 'pending', invitedBy: null } })
    if (!changed.count) throw new Error('ALREADY_PROCESSED')
    await tx.teamOperationLog.create({
      data: {
        id: crypto.randomUUID(), teamId: input.member.teamId, operatorId: input.operatorId,
        operatorType: input.operatorType, action: input.accepted ? 'join_approve' : 'join_reject',
        targetId: input.member.userId, targetType: input.member.userType,
      },
    })
  })
}
