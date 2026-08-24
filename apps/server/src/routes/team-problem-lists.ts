import crypto from 'crypto'
/**
 * 团队题单 API
 * @description 团队收录个人题单的管理接口
 * 权限规则：
 * - 添加：团队 owner/admin 或团队教师成员（只能添加自己是 owner 的题单）
 * - 删除：团队 owner 可删所有，admin 只能删自己添加的
 * - 查看：团队成员可见
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import { authenticate, isPersonalContextForTeams } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'
import { teamService } from '../modules/team/team.service'
import { classifyClientError } from '../lib/asyncHandler'

export const teamProblemListsRouter = Router()

function sendKnownTeamProblemListError(res: any, error: unknown): boolean {
  const clientError = classifyClientError(error)
  if (!clientError) return false
  res.status(clientError.status).json({
    success: false,
    message: clientError.message,
    ...(clientError.code ? { code: clientError.code } : {}),
  })
  return true
}

/**
 * 判断用户是否可以管理团队题单（owner/admin 或教师成员）
 */
async function canManageTeamProblemList(
  user: NonNullable<AuthRequest['user']>,
  teamId: string,
): Promise<{ canAdd: boolean, role: string | null }> {
  const userId = user.userId
  // 超管直接通过
  if (!isPersonalContextForTeams(user) && user.role === 'super_admin') {
    return { canAdd: true, role: 'super_admin' }
  }

  // 检查是否是团队成员
  const member = await prisma.teamMember.findFirst({
    where: { teamId, userId, status: 'active' }
  })

  if (!member) return { canAdd: false, role: null }

  // owner 和 admin 可以添加
  if (member.role === 'owner') return { canAdd: true, role: 'owner' }
  if (member.role === 'admin') return { canAdd: true, role: 'admin' }

  // 教师成员也可以添加
  if (member.userType === 'teacher') return { canAdd: true, role: 'teacher' }

  return { canAdd: false, role: null }
}

/**
 * GET /:teamId/problem-lists
 * 获取团队题单列表（团队成员可见）
 */
teamProblemListsRouter.get('/:teamId/problem-lists', authenticate, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params
    const userId = req.user!.userId
    const role = req.user!.role
    const team = await teamService.assertTeamScope(teamId, req.user!)

    // 权限：团队成员可查看（超管也能看）
    if (isPersonalContextForTeams(req.user) || (role !== 'super_admin' && role !== 'platform_admin')) {
      const member = await prisma.teamMember.findFirst({
        where: { teamId, userId, status: 'active' }
      })
      if (!member) {
        return res.status(403).json({ success: false, message: '无权限查看该团队题单' })
      }
    }

    const items = await prisma.teamProblemList.findMany({
      where: { teamId, ProblemList: { scope: team.scope } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        ProblemList: {
          select: {
            id: true,
            title: true,
            description: true,
            ownerId: true,
            ownerType: true,
            scope: true,
            _count: { select: { ProblemListSection: true } }
          }
        }
      }
    })

    // 获取题单条目数和 owner/添加者名字
    const data = await Promise.all(items.map(async (item) => {
      const entryCount = await prisma.problemListEntry.count({
        where: { ProblemListSection: { problemListId: item.problemListId } }
      })

      // 所有题单所有者与添加者均使用全局 userId；校园显示名从团队所在组织档案读取。
      const [ownerUser, addedByUser] = await Promise.all([
        prisma.user.findUnique({ where: { id: item.ProblemList.ownerId }, select: { username: true } }),
        prisma.user.findUnique({ where: { id: item.addedBy }, select: { username: true } }),
      ])
      let ownerName = ownerUser?.username || '未知'
      let addedByName = addedByUser?.username || '未知'
      if (team.scope === 'campus' && team.organizationId) {
        const memberships = await prisma.organizationMembership.findMany({
          where: {
            organizationId: team.organizationId,
            userId: { in: [item.ProblemList.ownerId, item.addedBy] },
          },
          select: {
            userId: true,
            TeacherProfile: { select: { name: true } },
            StudentProfile: { select: { name: true } },
          },
        })
        const displayName = (userId: string, fallback: string) => {
          const member = memberships.find(entry => entry.userId === userId)
          return member?.TeacherProfile?.name || member?.StudentProfile?.name || fallback
        }
        ownerName = displayName(item.ProblemList.ownerId, ownerName)
        addedByName = displayName(item.addedBy, addedByName)
      }

      return {
        id: item.id,
        problemListId: item.problemListId,
        addedBy: item.addedBy,
        addedByName,
        addedByRole: item.addedByRole,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        problemList: {
          id: item.ProblemList.id,
          title: item.ProblemList.title,
          description: item.ProblemList.description,
          ownerId: item.ProblemList.ownerId,
          ownerName,
          ownerType: item.ProblemList.ownerType,
          sectionCount: item.ProblemList._count.ProblemListSection,
          entryCount
        }
      }
    }))

    res.json({ success: true, data })
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_SCOPE_MISMATCH') {
      return res.status(403).json({ success: false, message: '该团队不属于当前使用模式' })
    }
    if (sendKnownTeamProblemListError(res, error)) return
    res.status(500).json({ success: false, message: '获取团队题单列表失败' })
  }
})

/**
 * POST /:teamId/problem-lists
 * 添加题单到团队
 * Body: { problemListId }
 */
teamProblemListsRouter.post('/:teamId/problem-lists', authenticate, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params
    const { problemListId } = req.body
    const userId = req.user!.userId
    await teamService.assertTeamScope(teamId, req.user!)

    // 校园模式：学生不能添加团队题单；个人模式可以
    if (req.user!.role === 'student' && !isPersonalContextForTeams(req.user)) {
      return res.status(403).json({ success: false, message: '校园模式下学生不能添加团队题单' })
    }

    if (!problemListId) {
      return res.status(400).json({ success: false, message: '缺少 problemListId' })
    }

    // 权限检查
    const { canAdd, role: teamRole } = await canManageTeamProblemList(req.user!, teamId)
    if (!canAdd) {
      return res.status(403).json({ success: false, message: '只有团队管理员或教师成员可添加题单' })
    }

    // 验证题单存在且自己是 owner
    const list = await prisma.problemList.findUnique({
      where: { id: problemListId }
    })
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { scope: true } })
    if (!list || !team || list.scope !== team.scope) {
      return res.status(404).json({ success: false, message: '题单不存在' })
    }
    if (list.ownerId !== userId) {
      return res.status(403).json({ success: false, message: '只能添加自己是 owner 的题单' })
    }

    // 检查是否已添加
    const existing = await prisma.teamProblemList.findUnique({
      where: { teamId_problemListId: { teamId, problemListId } }
    })
    if (existing) {
      return res.status(409).json({ success: false, message: '该题单已在团队题单库中' })
    }

    const item = await prisma.teamProblemList.create({
      data: {
        id: crypto.randomUUID(),
        teamId,
        problemListId,
        addedBy: userId,
        addedByRole: teamRole || 'teacher',
      }
    })

    res.json({ success: true, data: item })
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_SCOPE_MISMATCH') {
      return res.status(403).json({ success: false, message: '该团队不属于当前使用模式' })
    }
    if (sendKnownTeamProblemListError(res, error)) return
    res.status(500).json({ success: false, message: '添加团队题单失败' })
  }
})

/**
 * DELETE /:teamId/problem-lists/:id
 * 从团队移除题单
 */
teamProblemListsRouter.delete('/:teamId/problem-lists/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { teamId, id } = req.params
    const userId = req.user!.userId
    const role = req.user!.role
    await teamService.assertTeamScope(teamId, req.user!)

    // 校园模式：学生不能移除团队题单；个人模式可以
    if (role === 'student' && !isPersonalContextForTeams(req.user)) {
      return res.status(403).json({ success: false, message: '校园模式下学生不能移除团队题单' })
    }

    // 查找记录
    const item = await prisma.teamProblemList.findUnique({
      where: { id }
    })
    if (!item) {
      return res.status(404).json({ success: false, message: '记录不存在' })
    }
    if (item.teamId !== teamId) {
      return res.status(400).json({ success: false, message: '题单不属于该团队' })
    }

    // 权限：owner 可删所有，非 owner 只能删自己添加的
    if (isPersonalContextForTeams(req.user) || role !== 'super_admin') {
      const member = await prisma.teamMember.findFirst({
        where: { teamId, userId, status: 'active' }
      })

      const isOwner = member?.role === 'owner'
      if (!isOwner && item.addedBy !== userId) {
        return res.status(403).json({ success: false, message: '只能移除自己添加的题单' })
      }
    }

    await prisma.teamProblemList.delete({ where: { id } })

    res.json({ success: true, message: '已移除' })
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_SCOPE_MISMATCH') {
      return res.status(403).json({ success: false, message: '该团队不属于当前使用模式' })
    }
    if (sendKnownTeamProblemListError(res, error)) return
    res.status(500).json({ success: false, message: '移除团队题单失败' })
  }
})
