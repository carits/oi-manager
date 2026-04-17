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
import { authenticate } from '../middleware/auth'
import { getUserTeacherId } from '../middleware/permissions'
import type { AuthRequest } from '../middleware/auth'

export const teamProblemListsRouter = Router()

/**
 * 判断用户是否可以管理团队题单（owner/admin 或教师成员）
 */
async function canManageTeamProblemList(userId: string, teamId: string): Promise<{ canAdd: boolean, role: string | null }> {
  // 超管直接通过
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'super_admin') return { canAdd: true, role: 'super_admin' }

  const teacherId = await getUserTeacherId(userId)

  // 检查是否是团队成员
  const member = await prisma.teamMember.findFirst({
    where: {
      teamId,
      ...(teacherId ? { userId: teacherId, userType: 'teacher' } : {}),
      status: 'active'
    }
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

    // 权限：团队成员可查看（超管也能看）
    if (role !== 'super_admin' && role !== 'platform_admin') {
      const teacherId = await getUserTeacherId(userId)
      const student = await prisma.student.findUnique({ where: { userId } })
      const member = await prisma.teamMember.findFirst({
        where: {
          teamId,
          OR: [
            ...(teacherId ? [{ userId: teacherId, userType: 'teacher' as const }] : []),
            ...(student ? [{ userId: student.id, userType: 'student' as const }] : [])
          ].filter(m => m !== null),
          status: 'active'
        }
      })
      if (!member) {
        return res.status(403).json({ success: false, message: '无权限查看该团队题单' })
      }
    }

    const items = await prisma.teamProblemList.findMany({
      where: { teamId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        ProblemList: {
          select: {
            id: true,
            title: true,
            description: true,
            ownerId: true,
            ownerType: true,
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

      // owner 名字
      let ownerName = '未知'
      if (item.ProblemList.ownerType === 'teacher') {
        const teacher = await prisma.teacher.findUnique({
          where: { userId: item.ProblemList.ownerId },
          select: { name: true }
        })
        ownerName = teacher?.name || '未知'
      } else if (item.ProblemList.ownerType === 'student') {
        const student = await prisma.student.findUnique({
          where: { userId: item.ProblemList.ownerId },
          select: { name: true }
        })
        ownerName = student?.name || '未知'
      }

      // 添加者名字
      let addedByName = '未知'
      const addedByUser = await prisma.user.findUnique({
        where: { id: item.addedBy },
        include: { Teacher: true, Student: true }
      })
      if (addedByUser?.Teacher) addedByName = addedByUser.Teacher.name
      else if (addedByUser?.Student) addedByName = addedByUser.Student.name

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

    if (!problemListId) {
      return res.status(400).json({ success: false, message: '缺少 problemListId' })
    }

    // 权限检查
    const { canAdd, role: teamRole } = await canManageTeamProblemList(userId, teamId)
    if (!canAdd) {
      return res.status(403).json({ success: false, message: '只有团队管理员或教师成员可添加题单' })
    }

    // 验证题单存在且自己是 owner
    const list = await prisma.problemList.findUnique({
      where: { id: problemListId }
    })
    if (!list) {
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
        teamId,
        problemListId,
        addedBy: userId,
        addedByRole: teamRole || 'teacher',
      }
    })

    res.json({ success: true, data: item })
  } catch (error) {
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
    if (role !== 'super_admin') {
      const teacherId = await getUserTeacherId(userId)
      const member = await prisma.teamMember.findFirst({
        where: {
          teamId,
          ...(teacherId ? { userId: teacherId, userType: 'teacher' } : {}),
          status: 'active'
        }
      })

      const isOwner = member?.role === 'owner'
      if (!isOwner && item.addedBy !== userId) {
        return res.status(403).json({ success: false, message: '只能移除自己添加的题单' })
      }
    }

    await prisma.teamProblemList.delete({ where: { id } })

    res.json({ success: true, message: '已移除' })
  } catch (error) {
    res.status(500).json({ success: false, message: '移除团队题单失败' })
  }
})
