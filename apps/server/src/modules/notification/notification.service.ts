import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { getUserDisplayName } from '../team/team.utils'
import type { MemberType, TeamScope } from '../team/team.types'

type NotificationInput = {
  userId: string
  scope?: TeamScope
  contextType?: 'account' | 'organization'
  organizationId?: string | null
  type: string
  title: string
  body: string
  href: string
  sourceType: string
  sourceId: string
}

type NotificationDb = typeof prisma | Prisma.TransactionClient

function notificationContext(input: NotificationInput) {
  const contextType = input.contextType || (input.scope === 'campus' && input.organizationId ? 'organization' : 'account')
  const organizationId = contextType === 'organization' ? input.organizationId || null : null
  return {
    scope: contextType === 'organization' ? 'campus' as const : 'personal' as const,
    contextType,
    contextKey: contextType === 'organization' && organizationId ? `organization:${organizationId}` : 'account',
    organizationId,
  }
}

function teamHref(teamId: string) {
  return `team:${teamId}`
}

export const notificationService = {
  async create(input: NotificationInput, db: NotificationDb = prisma) {
    const context = notificationContext(input)
    const data = {
      userId: input.userId, type: input.type, title: input.title, body: input.body,
      href: input.href, sourceType: input.sourceType, sourceId: input.sourceId, ...context,
    }
    return db.userNotification.upsert({
      where: { userId_contextKey_type_sourceType_sourceId: { userId: input.userId, contextKey: context.contextKey, type: input.type, sourceType: input.sourceType, sourceId: input.sourceId } },
      create: { id: crypto.randomUUID(), ...data },
      update: { type: input.type, title: input.title, body: input.body, href: input.href, readAt: null }
    })
  },

  async createTeamInvitation(input: { recipientId: string; scope: TeamScope; invitationId: string; teamId: string; teamName: string; inviterId: string; inviterType: MemberType; organizationId?: string }) {
    const inviterName = await getUserDisplayName(input.inviterId, input.inviterType, input.scope, input.organizationId)
    return this.create({
      userId: input.recipientId,
      scope: input.scope,
      type: 'team_invitation',
      title: '收到团队邀请',
      body: `${inviterName} 邀请你加入「${input.teamName}」`,
      href: teamHref(input.teamId),
      sourceType: 'team_invitation',
      sourceId: input.invitationId,
      organizationId: input.organizationId,
    })
  },

  async createTeamJoinRequest(input: { recipientIds: string[]; scope: TeamScope; requestId: string; teamId: string; teamName: string; applicantId: string; applicantType: MemberType; organizationId?: string }) {
    const applicantName = await getUserDisplayName(input.applicantId, input.applicantType, input.scope, input.organizationId)
    await Promise.all(input.recipientIds.map(userId => this.create({
      userId,
      scope: input.scope,
      type: 'team_join_request',
      title: '收到加入申请',
      body: `${applicantName} 申请加入「${input.teamName}」`,
      href: teamHref(input.teamId),
      sourceType: 'team_join_request',
      sourceId: input.requestId,
      organizationId: input.organizationId,
    })))
  },

  async createJoinDecision(input: { recipientId: string; scope: TeamScope; requestId: string; teamId: string; teamName: string; approved: boolean; organizationId?: string }) {
    return this.create({
      userId: input.recipientId,
      scope: input.scope,
      type: input.approved ? 'team_join_approved' : 'team_join_rejected',
      title: input.approved ? '加入申请已通过' : '加入申请未通过',
      body: input.approved ? `你已加入「${input.teamName}」` : `「${input.teamName}」未通过你的加入申请`,
      href: teamHref(input.teamId),
      sourceType: 'team_join_decision',
      sourceId: input.requestId,
      organizationId: input.organizationId,
    })
  },

  async createInvitationResponse(input: { recipientId: string; scope: TeamScope; invitationId: string; teamId: string; teamName: string; memberId: string; memberType: MemberType; accepted: boolean; organizationId?: string }) {
    const memberName = await getUserDisplayName(input.memberId, input.memberType, input.scope, input.organizationId)
    return this.create({
      userId: input.recipientId,
      scope: input.scope,
      type: input.accepted ? 'team_invitation_accepted' : 'team_invitation_rejected',
      title: input.accepted ? '团队邀请已接受' : '团队邀请被拒绝',
      body: input.accepted ? `${memberName} 已加入「${input.teamName}」` : `${memberName} 拒绝加入「${input.teamName}」`,
      href: teamHref(input.teamId),
      sourceType: 'team_invitation_response',
      sourceId: input.invitationId,
      organizationId: input.organizationId,
    })
  },

  async markSourceRead(userId: string, scope: TeamScope, sourceType: string, sourceId: string) {
    return prisma.userNotification.updateMany({ where: { userId, scope, sourceType, sourceId, readAt: null }, data: { readAt: new Date() } })
  },

  async markSourceReadForScope(scope: TeamScope, sourceType: string, sourceId: string) {
    return prisma.userNotification.updateMany({ where: { scope, sourceType, sourceId, readAt: null }, data: { readAt: new Date() } })
  }
}
