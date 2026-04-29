/**
 * School Principal Routes
 * 学校负责人路由：设置、创建、转移、日志
 */

import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate, AuthRequest } from '../../middleware/auth.js'
import { prisma } from '../../prisma.js'
import { asyncHandler } from '../../lib/asyncHandler'

export const schoolPrincipalRouter = Router()

// ==================== 设置学校负责人 ====================
// 仅超管可操作
schoolPrincipalRouter.put('/:id/principal', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 检查是否为 SUPER_ADMIN
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有超级管理员可以设置学校负责人' })
    }

    const { id } = req.params
    const { teacherId } = req.body

    if (!teacherId) {
      return res.status(400).json({ success: false, message: '请指定负责人教师' })
    }

    // 检查学校是否存在
    const school = await prisma.school.findUnique({ where: { id } })
    if (!school) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    // 检查教师是否存在且属于该学校
    const teacher = await prisma.teacher.findFirst({
      where: { id: teacherId, schoolId: id }
    })
    if (!teacher) {
      return res.status(400).json({ success: false, message: '该教师不属于本学校' })
    }

    // 检查教师状态
    if (teacher.status === 'disabled') {
      return res.status(400).json({ success: false, message: '无法指定禁用的教师为负责人' })
    }

    const oldPrincipalId = school.currentPrincipalTeacherId

    // 获取新负责人的 userId
    const newPrincipalTeacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { id: true }
    })

    // 获取旧负责人的 userId（如果存在）
    let oldPrincipalUserId: string | null = null
    if (oldPrincipalId) {
      const oldPrincipalTeacher = await prisma.teacher.findUnique({
        where: { id: oldPrincipalId },
        select: { id: true }
      })
      oldPrincipalUserId = oldPrincipalTeacher?.id || null
    }

    // 使用事务确保原子性
    const transactionOperations = [
      // 更新学校负责人
      prisma.school.update({
        where: { id },
        data: { currentPrincipalTeacherId: teacherId }
      }),
      // 更新新负责人的 user 角色
      prisma.user.update({
        where: { id: newPrincipalTeacher!.id },
        data: { role: 'school_principal' }
      }),
      // 记录日志
      prisma.principalTransferLog.create({
        data: {
          schoolId: id,
          oldPrincipalTeacherId: oldPrincipalId,
          newPrincipalTeacherId: teacherId,
          operatorId: req.user!.userId,
          result: 'success',
          message: '超管指定负责人'
        }
      })
    ]

    // 如果有旧负责人，更新其角色为普通教师
    if (oldPrincipalId && oldPrincipalUserId) {
      transactionOperations.push(
        // 更新原负责人的 user 角色
        prisma.user.update({
          where: { id: oldPrincipalUserId },
          data: { role: 'teacher' }
        })
      )
    }

    await prisma.$transaction(transactionOperations)

    // 重新查询学校数据，包含更新后的负责人信息
    const updatedSchool = await prisma.school.findUnique({
      where: { id }
    })

    // 手动查询负责人信息
    let principal = null
    if (updatedSchool?.currentPrincipalTeacherId) {
      principal = await prisma.teacher.findUnique({
        where: { id: updatedSchool.currentPrincipalTeacherId },
        include: {
          User: {
            select: { username: true, role: true }
          }
        }
      })
    }

    res.json({
      success: true,
      message: '设置负责人成功',
      data: {
        ...updatedSchool,
        principal
      }
    })
}))

// ==================== 创建学校负责人 ====================
// 仅超管可操作
schoolPrincipalRouter.post('/:id/principal', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有超级管理员可以创建学校负责人' })
    }

    const { id } = req.params
    const { username, password, teacherName, teacherTitle, email, phone } = req.body

    if (!username || !teacherName) {
      return res.status(400).json({ success: false, message: '账号和姓名不能为空' })
    }

    // 检查学校是否存在
    const school = await prisma.school.findUnique({ where: { id } })
    if (!school) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    // 检查用户名是否已存在
    const existingUser = await prisma.user.findUnique({ where: { username } })
    if (existingUser) {
      return res.status(400).json({ success: false, message: '用户名已存在' })
    }

    // 验证账号格式
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, message: '账号只能包含字母、数字和下划线' })
    }
    if (username.length < 3) {
      return res.status(400).json({ success: false, message: '账号至少3个字符' })
    }

    // 使用事务创建负责人及相关数据，确保原子性
    const hashedPassword = await bcrypt.hash(password || username, 10)

    const result = await prisma.$transaction(async (tx) => {
      // 1. 创建用户
      const user = await tx.user.create({
        data: {
          username,
          passwordHash: hashedPassword,
          role: 'school_principal',
          email: email || null,
          phone: phone || null,
          schoolId: id
        }
      })

      // 2. 创建教师并关联学校
      const teacher = await tx.teacher.create({
        data: {
          id: user.id,
          name: teacherName,
          email: email || null,
          phone: phone || null,
          title: teacherTitle || '校长',
          status: 'active',
          schoolId: id
        }
      })

      // 3. 更新学校的负责人
      await tx.school.update({
        where: { id },
        data: { currentPrincipalTeacherId: teacher.id }
      })

      return { teacher, user }
    })

    res.json({
      success: true,
      data: {
        teacher: {
          id: result.teacher.id,
          name: result.teacher.name,
          title: result.teacher.title,
          user: { username: result.user.username }
        }
      }
    })
}))

// ==================== 获取学校负责人变更日志 ====================
schoolPrincipalRouter.get('/:id/principal-logs', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params

    // 资源级权限检查：只有本校用户和超管可查看
    const { canAccessSchool } = await import('../../middleware/permissions.js')
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的日志' })
    }

    const logs = await prisma.principalTransferLog.findMany({
      where: { schoolId: id },
      orderBy: { createdAt: 'desc' }
    })

    res.json({ success: true, data: logs })
}))

// ==================== 学校负责人转移负责人 ====================
schoolPrincipalRouter.post('/current/principal-transfer', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 检查是否为学校负责人
    if (req.user?.role !== 'school_principal') {
      return res.status(403).json({ success: false, message: '只有学校负责人可以转移负责人' })
    }

    const { newTeacherId } = req.body

    if (!newTeacherId) {
      return res.status(400).json({ success: false, message: '请选择新负责人' })
    }

    // 获取当前负责人信息
    const currentPrincipal = await prisma.teacher.findFirst({
      where: { id: req.user!.userId }
    })

    if (!currentPrincipal || !currentPrincipal.schoolId) {
      return res.status(403).json({ success: false, message: '您还不是学校负责人' })
    }

    // 检查新负责人是否是本校教师
    const newPrincipal = await prisma.teacher.findFirst({
      where: { id: newTeacherId, schoolId: currentPrincipal.schoolId }
    })

    if (!newPrincipal) {
      return res.status(400).json({ success: false, message: '请选择本校的教师作为新负责人' })
    }

    if (newPrincipal.status === 'disabled') {
      return res.status(400).json({ success: false, message: '不能选择禁用的教师作为新负责人' })
    }

    // 检查是否只有一位教师（即只有负责人自己）
    const teacherCount = await prisma.teacher.count({
      where: { schoolId: currentPrincipal.schoolId }
    })

    if (teacherCount < 2) {
      return res.status(400).json({ success: false, message: '学校只有一位教师，无法转移负责人' })
    }

    // 获取新旧负责人的 userId
    const oldPrincipalUserId = currentPrincipal.id
    const newPrincipalTeacher = await prisma.teacher.findUnique({
      where: { id: newTeacherId },
      select: { id: true }
    })

    if (!newPrincipalTeacher) {
      return res.status(404).json({ success: false, message: '新负责人不存在' })
    }

    // 使用事务确保原子性
    await prisma.$transaction([
      // 更新学校负责人
      prisma.school.update({
        where: { id: currentPrincipal.schoolId },
        data: { currentPrincipalTeacherId: newTeacherId }
      }),
      // 原负责人的 user 角色降级为普通教师
      prisma.user.update({
        where: { id: oldPrincipalUserId },
        data: { role: 'teacher' }
      }),
      // 新负责人的 user 角色升级
      prisma.user.update({
        where: { id: newPrincipalTeacher.id },
        data: { role: 'school_principal' }
      }),
      // 记录日志
      prisma.principalTransferLog.create({
        data: {
          schoolId: currentPrincipal.schoolId,
          oldPrincipalTeacherId: currentPrincipal.id,
          newPrincipalTeacherId: newTeacherId,
          operatorId: req.user!.userId,
          result: 'success',
          message: '学校负责人转移'
        }
      })
    ])

    res.json({ success: true, message: '负责人转移成功' })
}))