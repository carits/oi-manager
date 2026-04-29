/**
 * School Members Routes
 * 学校成员路由：教师/学生列表、成员管理
 */

import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate, AuthRequest } from '../../middleware/auth.js'
import { prisma } from '../../prisma.js'
import { canAccessSchool } from '../../middleware/permissions.js'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../../utils/validation.js'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../../lib/pagination'

export const schoolMembersRouter = Router()

// ==================== 获取学校的所有教师 ====================
// 必须放在 /:id 之前
schoolMembersRouter.get('/:id/teachers', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { page, pageSize, skip } = parsePagination(req.query, { defaultPageSize: 20 })

    // 资源级权限检查：只有本校用户可以查看
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的教师列表' })
    }

    const [teachers, total] = await Promise.all([
      prisma.teacher.findMany({
        where: { schoolId: id },
        select: {
          id: true,
          name: true,
          title: true,
          email: true,
          phone: true,
          User: {
            select: {
              id: true,
              username: true,
              role: true,
              status: true,
              phone: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.teacher.count({ where: { schoolId: id } })
    ])

    // 转换字段名：User -> user（符合前端契约）
    const teachersWithUser = teachers.map(t => {
      const { User, ...rest } = t
      return { ...rest, user: User }
    })

    res.json({
      success: true,
      data: paginatedResponse(teachersWithUser, total, page, pageSize)
    })
}))

// ==================== 获取学校学生 Rating 排名 ====================
schoolMembersRouter.get('/:id/student-rankings', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params

    // 资源级权限检查：只有本校用户可以查看
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的学生排名' })
    }

    // 获取学校信息（用于年级计算）
    const school = await prisma.school.findUnique({
      where: { id },
      select: { educationSystem: true, schoolType: true }
    })

    const { page, pageSize, skip } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 })

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where: { schoolId: id },
        include: {
          User: { select: { username: true, avatar: true } }
        },
        orderBy: { rating: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.student.count({ where: { schoolId: id } })
    ])

    // 将学校信息附加到每个学生
    const studentsWithSchool = students.map(s => ({
      ...s,
      school: {
        educationSystem: school?.educationSystem,
        schoolType: school?.schoolType
      }
    }))

    res.json({
      success: true,
      ...paginatedResponse(studentsWithSchool, total, page, pageSize)
    })
}))

// ==================== 获取学校学生列表（按年级分组） ====================
schoolMembersRouter.get('/:id/students-by-grade', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params

    // 资源级权限检查：只有本校用户可以查看
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的学生列表' })
    }

    const { page, pageSize, skip } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 })

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where: { schoolId: id },
        include: {
          User: { select: { username: true } },
          HeadTeacher: { select: { name: true } }
        },
        orderBy: [
          { enrollmentYear: 'asc' }, // 入学年份升序（越早入学年级越高）
          { name: 'asc' }
        ],
        skip,
        take: pageSize,
      }),
      prisma.student.count({ where: { schoolId: id } })
    ])

    // 按入学年份分组
    const grouped = students.reduce((acc, student) => {
      const year = student.enrollmentYear || 0
      if (!acc[year]) acc[year] = []
      acc[year].push(student)
      return acc
    }, {} as Record<number, typeof students>)

    res.json({
      success: true,
      data: grouped,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    })
}))

// ==================== 禁用/启用教师 ====================
// 仅学校负责人
schoolMembersRouter.put('/:id/teachers/:teacherId/status', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, teacherId } = req.params
    const { status } = req.body // 'active' | 'disabled'
    const userId = req.user!.userId

    // 验证当前用户是否为该学校负责人
    const currentTeacher = await prisma.teacher.findUnique({ where: { id: userId } })
    if (!currentTeacher) {
      return res.status(400).json({ success: false, message: '教师不存在' })
    }

    const school = await prisma.school.findUnique({ where: { id } })
    if (!school || school.currentPrincipalTeacherId !== currentTeacher.id) {
      return res.status(403).json({ success: false, message: '只有学校负责人可以操作' })
    }

    // 获取目标教师的用户ID
    const targetTeacher = await prisma.teacher.findUnique({ where: { id: teacherId } })
    if (!targetTeacher || targetTeacher.schoolId !== id) {
      return res.status(404).json({ success: false, message: '教师不存在或不属于该学校' })
    }

    // 不能禁用自己
    if (targetTeacher.id === currentTeacher.id) {
      return res.status(400).json({ success: false, message: '不能禁用自己' })
    }

    // 更新用户状态
    await prisma.user.update({
      where: { id: targetTeacher.id },
      data: { status }
    })

    res.json({ success: true, message: '操作成功' })
}))

// ==================== 学校负责人获取本校教师列表 ====================
schoolMembersRouter.get('/current/teachers', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 检查是否为学校负责人
    if (req.user?.role !== 'school_principal') {
      return res.status(403).json({ success: false, message: '只有学校负责人可以查看本校教师' })
    }

    // 获取当前用户的教师信息
    const teacher = await prisma.teacher.findFirst({
      where: { id: req.user!.userId }
    })

    if (!teacher || !teacher.schoolId) {
      return res.status(403).json({ success: false, message: '您还没有负责的学校' })
    }

    // 获取本校所有教师
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: teacher.schoolId },
      include: { User: { select: { username: true, email: true, phone: true, avatar: true } } },
      orderBy: { createdAt: 'desc' }
    })

    res.json({ success: true, data: teachers })
}))

// ==================== 学校负责人创建本校教师 ====================
schoolMembersRouter.post('/current/teachers', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 检查是否为学校负责人
    if (req.user?.role !== 'school_principal') {
      return res.status(403).json({ success: false, message: '只有学校负责人可以创建本校教师' })
    }

    const { name, username, password, email, phone, bio, title } = req.body

    if (!name || !username || !password) {
      return res.status(400).json({ success: false, message: '姓名、用户名、密码不能为空' })
    }

    // 至少需要提供一个联系方式
    if (!email && !phone) {
      return res.status(400).json({ success: false, message: '至少需要提供邮箱或手机号其中一个' })
    }

    // 验证用户名
    const usernameValidation = validateUsername(username)
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message })
    }

    // 验证密码
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message })
    }

    // 验证手机号
    if (phone) {
      const phoneValidation = validatePhone(phone)
      if (!phoneValidation.valid) {
        return res.status(400).json({ success: false, message: phoneValidation.message })
      }
    }

    // 验证邮箱
    if (email) {
      const emailValidation = validateEmail(email)
      if (!emailValidation.valid) {
        return res.status(400).json({ success: false, message: emailValidation.message })
      }
    }

    // 获取当前用户的教师信息
    const currentTeacher = await prisma.teacher.findFirst({
      where: { id: req.user!.userId }
    })

    if (!currentTeacher || !currentTeacher.schoolId) {
      return res.status(403).json({ success: false, message: '您还没有负责的学校' })
    }

    // 检查学校状态
    const school = await prisma.school.findUnique({ where: { id: currentTeacher.schoolId } })
    if (school?.status === 'disabled') {
      return res.status(400).json({ success: false, message: '学校已停用，无法创建教师' })
    }

    // 检查用户名是否已存在
    const existingUser = await prisma.user.findUnique({ where: { username } })
    if (existingUser) {
      return res.status(400).json({ success: false, message: '用户名已存在' })
    }

    // 创建用户
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: hashedPassword,
        role: 'teacher',
        schoolId: currentTeacher.schoolId, // 用户必须绑定学校
        email,
        phone,
        avatar: null,
        bio
      }
    })

    // 创建教师
    const newTeacher = await prisma.teacher.create({
      data: {
        id: user.id,
        name,
        email,
        phone,
        bio,
        title,
        status: 'active',
        schoolId: currentTeacher.schoolId
      }
    })

    res.json({ success: true, data: newTeacher })
}))

// ==================== 学校负责人编辑本校教师 ====================
schoolMembersRouter.put('/current/teachers/:teacherId', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 检查是否为学校负责人
    if (req.user?.role !== 'school_principal') {
      return res.status(403).json({ success: false, message: '只有学校负责人可以编辑本校教师' })
    }

    const { teacherId } = req.params
    const { name, email, phone, bio, title, status } = req.body

    // 获取当前用户的教师信息
    const currentTeacher = await prisma.teacher.findFirst({
      where: { id: req.user!.userId }
    })

    if (!currentTeacher || !currentTeacher.schoolId) {
      return res.status(403).json({ success: false, message: '您还没有负责的学校' })
    }

    // 检查目标教师是否属于本校
    const targetTeacher = await prisma.teacher.findFirst({
      where: { id: teacherId, schoolId: currentTeacher.schoolId }
    })

    if (!targetTeacher) {
      return res.status(404).json({ success: false, message: '教师不存在或不属于本校' })
    }

    // 验证联系方式：至少需要一个
    const finalEmail = email !== undefined ? email : targetTeacher.email
    const finalPhone = phone !== undefined ? phone : targetTeacher.phone
    if (!finalEmail && !finalPhone) {
      return res.status(400).json({ success: false, message: '至少需要保留邮箱或手机号其中一个' })
    }

    // 验证手机号
    if (phone) {
      const phoneValidation = validatePhone(phone)
      if (!phoneValidation.valid) {
        return res.status(400).json({ success: false, message: phoneValidation.message })
      }
    }

    // 验证邮箱
    if (email) {
      const emailValidation = validateEmail(email)
      if (!emailValidation.valid) {
        return res.status(400).json({ success: false, message: emailValidation.message })
      }
    }

    // 检查目标教师是否是学校负责人（通过 user.role 判断）
    const targetUser = await prisma.user.findUnique({
      where: { id: targetTeacher.id }
    })

    // 如果是编辑负责人，不允许通过此接口修改
    if (targetUser?.role === 'school_principal' && teacherId !== currentTeacher.id) {
      return res.status(400).json({ success: false, message: '请使用转移负责人功能来变更负责人' })
    }

    // 更新教师信息
    const updatedTeacher = await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        ...(name && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(bio !== undefined && { bio }),
        ...(title !== undefined && { title }),
        ...(status && { status })
      }
    })

    // 如果是禁用操作，检查是否是负责人（通过 user.role 判断）
    if (status === 'disabled' && targetUser?.role === 'school_principal') {
      return res.status(400).json({ success: false, message: '请先转移负责人再禁用' })
    }

    res.json({ success: true, data: updatedTeacher })
}))