/**
 * 学校题单 API
 * @description 学校收录个人题单的管理接口
 * 权限规则：
 * - 添加：学校负责人 or 本校教师（只能添加自己是 owner 的题单）
 * - 删除：学校负责人可删所有，教师只能删自己添加的
 * - 查看：本校所有成员（含学生）
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import { authenticate } from '../middleware/auth'
import { canAccessSchool, getUserSchoolId } from '../middleware/permissions'
import type { AuthRequest } from '../middleware/auth'

export const schoolProblemListsRouter = Router()

/**
 * GET /:schoolId/problem-lists
 * 获取学校题单列表（本校成员可见）
 */
schoolProblemListsRouter.get('/:schoolId/problem-lists', authenticate, async (req: AuthRequest, res) => {
  try {
    const { schoolId } = req.params

    // 权限：本校成员可查看
    const hasAccess = await canAccessSchool(req, schoolId)
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: '无权限查看该校题单' })
    }

    const items = await prisma.schoolProblemList.findMany({
      where: { schoolId },
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

    // 获取题单条目数和 owner 名字
    const data = await Promise.all(items.map(async (item) => {
      // 获取条目总数
      const entryCount = await prisma.problemListEntry.count({
        where: { ProblemListSection: { problemListId: item.problemListId } }
      })

      // 获取 owner 名字
      let ownerName = '未知'
      if (item.ProblemList.ownerType === 'teacher') {
        const teacher = await prisma.teacher.findUnique({
          where: { id: item.ProblemList.ownerId },
          select: { name: true }
        })
        ownerName = teacher?.name || '未知'
      } else if (item.ProblemList.ownerType === 'student') {
        const student = await prisma.student.findUnique({
          where: { id: item.ProblemList.ownerId },
          select: { name: true }
        })
        ownerName = student?.name || '未知'
      }

      // 获取添加者名字
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
    res.status(500).json({ success: false, message: '获取学校题单列表失败' })
  }
})

/**
 * POST /:schoolId/problem-lists
 * 添加题单到学校
 * Body: { problemListId }
 */
schoolProblemListsRouter.post('/:schoolId/problem-lists', authenticate, async (req: AuthRequest, res) => {
  try {
    const { schoolId } = req.params
    const { problemListId } = req.body
    const userId = req.user!.userId

    if (!problemListId) {
      return res.status(400).json({ success: false, message: '缺少 problemListId' })
    }

    // 权限检查：学校负责人 or 本校教师
    const role = req.user!.role
    if (role !== 'super_admin' && role !== 'school_principal' && role !== 'teacher') {
      return res.status(403).json({ success: false, message: '只有学校负责人或教师可添加题单' })
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

    // 验证学校归属
    const userSchoolId = await getUserSchoolId(userId)
    if (userSchoolId !== schoolId) {
      return res.status(403).json({ success: false, message: '只能向本校添加题单' })
    }

    // 检查是否已添加
    const existing = await prisma.schoolProblemList.findUnique({
      where: { schoolId_problemListId: { schoolId, problemListId } }
    })
    if (existing) {
      return res.status(409).json({ success: false, message: '该题单已在学校题单库中' })
    }

    // 确定角色
    const addedByRole = role === 'school_principal' ? 'principal' : 'teacher'

    const item = await prisma.schoolProblemList.create({
      data: {
        id: crypto.randomUUID(),
        schoolId,
        problemListId,
        addedBy: userId,
        addedByRole,
      }
    })

    res.json({ success: true, data: item })
  } catch (error) {
    res.status(500).json({ success: false, message: '添加学校题单失败' })
  }
})

/**
 * DELETE /:schoolId/problem-lists/:id
 * 从学校移除题单
 */
schoolProblemListsRouter.delete('/:schoolId/problem-lists/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { schoolId, id } = req.params
    const userId = req.user!.userId
    const role = req.user!.role

    // 查找记录
    const item = await prisma.schoolProblemList.findUnique({
      where: { id }
    })
    if (!item) {
      return res.status(404).json({ success: false, message: '记录不存在' })
    }
    if (item.schoolId !== schoolId) {
      return res.status(400).json({ success: false, message: '题单不属于该学校' })
    }

    // 权限检查：学校负责人可删所有，教师只能删自己添加的
    if (role !== 'super_admin') {
      // 判断是否是学校负责人
      const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { currentPrincipalTeacherId: true }
      })
      const teacher = await prisma.teacher.findUnique({
        where: { id: userId },
        select: { id: true }
      })
      const isPrincipal = teacher && school?.currentPrincipalTeacherId === teacher.id

      if (!isPrincipal && item.addedBy !== userId) {
        return res.status(403).json({ success: false, message: '只能移除自己添加的题单' })
      }
    }

    await prisma.schoolProblemList.delete({ where: { id } })

    res.json({ success: true, message: '已移除' })
  } catch (error) {
    res.status(500).json({ success: false, message: '移除学校题单失败' })
  }
})
