import crypto from 'crypto'
import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate, AuthRequest, isAdmin, isSuperAdmin, isPersonalWorkspace, requireWorkspace } from '../middleware/auth.js'
import { prisma } from '../prisma.js'
import { CreatePlatformAdminRequest, ResetUserPasswordRequest, GetUsersQueryParams } from '@oi-manager/shared'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../utils/validation.js'
import { passwordResetLimiter } from '../middleware/rateLimiter.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { parsePagination, paginatedResponse } from '../lib/pagination.js'

export const userRouter = Router()

// 获取用户公开信息（所有登录用户可访问）
userRouter.get('/:userId/profile', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId } = req.params
    const { userType } = req.query

    if (!userType || !['teacher', 'student', 'user'].includes(userType as string)) {
      return res.status(400).json({ success: false, message: 'userType 参数无效' })
    }

    if (isPersonalWorkspace(req.user) || userType === 'user') {
      const publicUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, avatar: true, bio: true, status: true }
      })

      if (!publicUser || publicUser.status !== 'active') {
        return res.status(404).json({ success: false, message: 'User not found' })
      }

      return res.json({
        success: true,
        data: {
          id: publicUser.id,
          username: publicUser.username,
          avatar: publicUser.avatar,
          bio: publicUser.bio,
          userType: 'user'
        }
      })
    }

    let profileData: any = null

    if (userType === 'teacher') {
      const teacher = await prisma.teacher.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          schoolId: true,
          School_Teacher_schoolIdToSchool: { select: { id: true, name: true } }
        }
      })

      if (!teacher) {
        return res.status(404).json({ success: false, message: '用户不存在' })
      }

      // 获取 User 表的头像和用户名（优先使用 User 表的）
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, avatar: true, bio: true }
      })

      profileData = {
        id: teacher.id,
        name: teacher.name,
        username: user?.username || '',
        avatar: user?.avatar || teacher.avatar,
        bio: user?.bio || teacher.bio,
        userType: 'teacher',
        school: teacher.School_Teacher_schoolIdToSchool
      }
    } else {
      const student = await prisma.student.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          avatar: true,
          schoolId: true,
          School: { select: { id: true, name: true } }
        }
      })

      if (!student) {
        return res.status(404).json({ success: false, message: '用户不存在' })
      }

      // 获取 User 表的头像和用户名（优先使用 User 表的）
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, avatar: true, bio: true }
      })

      profileData = {
        id: student.id,
        name: student.name,
        username: user?.username || '',
        avatar: user?.avatar || student.avatar,
        bio: user?.bio || '',
        userType: 'student',
        school: student.School
      }
    }

    res.json({ success: true, data: profileData })
}, '服务器错误'))

// 获取所有用户列表（super_admin, platform_admin）
userRouter.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 权限检查
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { role, status, schoolId, keyword } = req.query as unknown as GetUsersQueryParams
    const { page, pageSize, skip } = parsePagination(req.query)

    // 构建查询条件
    const where: any = {}

    // 平台管理员只能查看普通用户（学校负责人、教师、学生），不能查看超管和其他平台管理员
    if (req.user!.role === 'platform_admin') {
      // 如果前端传了 role 参数，需要检查是否在允许范围内
      if (role) {
        if (!['school_principal', 'teacher', 'student'].includes(role)) {
          // 如果请求查看超管或平台管理员，返回空结果
          return res.json({
            success: true,
            data: {
              users: [],
              total: 0,
              page,
              pageSize,
              totalPages: 0
            }
          })
        }
        where.role = role
      } else {
        // 如果没有指定 role，限制只能看到这三种角色
        where.role = { in: ['school_principal', 'teacher', 'student'] }
      }
    } else {
      // 超级管理员可以看到所有角色
      if (role) where.role = role
    }

    if (status) where.status = status
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
      ]
    }

    // 如果指定了学校ID，需要通过 teacher 或 student 关联查询
    if (schoolId) {
      where.OR = [
        { Teacher: { schoolId } },
        { Student: { schoolId } }
      ]
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          School: {
            select: {
              id: true,
              name: true
            }
          },
          Teacher: {
            select: {
              id: true,
              name: true
            }
          },
          Student: {
            select: {
              id: true,
              name: true
            }
          },
          Admin: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ])

    // 格式化响应
    const formattedUsers = users.map(user => {
      // 从 Teacher/Student/Admin 获取姓名，如果没有则为空
      const name = user.Teacher?.name || user.Student?.name || user.Admin?.name || ''
      // 所有用户都有 schoolId，直接从 User.School 获取学校信息
      const schoolName = user.School?.name || ''

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        phone: user.phone,
        email: user.email,
        bio: user.bio,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        profile: {
          name,
          schoolId: user.schoolId,
          schoolName
        }
      }
    })

    res.json({
      success: true,
      data: {
        users: formattedUsers,
        ...paginatedResponse(formattedUsers, total, page, pageSize),
      }
    })
}, '服务器错误'))

// 获取用户详情（super_admin, platform_admin）
userRouter.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { id } = req.params

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        Teacher: {
          include: {
            School_Teacher_schoolIdToSchool: { select: { id: true, name: true } }
          }
        },
        Student: {
          include: {
            School: { select: { id: true, name: true } }
          }
        },
        Admin: true
      }
    })

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' })
    }

    // 平台管理员不能查看超管和其他平台管理员
    if (req.user!.role === 'platform_admin') {
      if (user.role === 'super_admin' || user.role === 'platform_admin') {
        return res.status(403).json({ success: false, message: '权限不足' })
      }
    }

    const response = {
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
      phone: user.phone,
      email: user.email,
      bio: user.bio,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      profile: user.Teacher ? {
        id: user.Teacher.id,
        name: user.Teacher.name,
        schoolId: user.Teacher.schoolId || undefined,
        schoolName: user.Teacher.School_Teacher_schoolIdToSchool?.name
      } : user.Student ? {
        id: user.Student.id,
        name: user.Student.name,
        schoolId: user.Student.schoolId || undefined,
        schoolName: user.Student.School?.name
      } : user.Admin ? {
        id: user.Admin.id,
        name: user.Admin.name
      } : undefined
    }

    res.json({ success: true, data: response })
}, '服务器错误'))

// 创建平台管理员（仅 super_admin）
userRouter.post('/platform-admin', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!isSuperAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '只有超级管理员可以创建平台管理员' })
    }

    const { username, password, name, phone, email, bio } = req.body as CreatePlatformAdminRequest

    // 验证必填字段
    if (!username || !password || !name) {
      return res.status(400).json({ success: false, message: '用户名、密码和姓名为必填项' })
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

    // 检查用户名是否已存在
    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) {
      return res.status(400).json({ success: false, message: '用户名已存在' })
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10)

    // 获取平台学校 ID（用于绑定系统管理员）
    const platformSchoolId = 'platform-school-00000000'

    // 创建用户和管理员档案（共享主键：User.id = Admin.id）
    const userId = crypto.randomUUID()
    const user = await prisma.user.create({
      data: {
        id: userId,
        username,
        passwordHash,
        role: 'platform_admin',
        schoolId: platformSchoolId, // 系统管理员绑定到平台学校
        phone,
        email,
        bio,
        Admin: {
          create: {
            name,
            schoolId: platformSchoolId // Admin 也需要 schoolId
          }
        }
      },
      include: {
        Admin: true
      }
    })

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        role: user.role,
        adminId: user.Admin?.id
      }
    })
}, '服务器错误'))

// 启用/禁用用户（super_admin, platform_admin）
userRouter.put('/:id/status', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { id } = req.params
    const { status, reason = '' } = req.body

    if (!status || !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, message: '状态值无效' })
    }

    // 获取目标用户
    const targetUser = await prisma.user.findUnique({ where: { id } })
    if (!targetUser) {
      return res.status(404).json({ success: false, message: '用户不存在' })
    }

    // 平台管理员不能操作其他平台管理员或超级管理员
    if (req.user!.role === 'platform_admin' && (targetUser.role === 'platform_admin' || targetUser.role === 'super_admin')) {
      return res.status(403).json({ success: false, message: '平台管理员不能操作其他管理员账号' })
    }

    // 使用事务更新状态并记录日志
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { status }
      }),
      prisma.userStatusLog.create({
        data: {
          id: crypto.randomUUID(),
          targetId: id,
          operatorId: req.user!.userId,
          operatorRole: req.user!.role,
          oldStatus: targetUser.status,
          newStatus: status,
          reason
        }
      })
    ])

    res.json({
      success: true,
      data: {
        userId: updatedUser.id,
        status: updatedUser.status
      }
    })
}, '服务器错误'))

// 重置用户密码（super_admin, platform_admin）
userRouter.post('/:id/reset-password', passwordResetLimiter, authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { id } = req.params
    const { newPassword, resetMethod } = req.body as { newPassword: string; resetMethod: string }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '密码长度至少为6位' })
    }

    // 获取目标用户
    const targetUser = await prisma.user.findUnique({ where: { id } })
    if (!targetUser) {
      return res.status(404).json({ success: false, message: '用户不存在' })
    }

    // 平台管理员不能重置其他平台管理员或超级管理员的密码
    if (req.user!.role === 'platform_admin' && (targetUser.role === 'platform_admin' || targetUser.role === 'super_admin')) {
      return res.status(403).json({ success: false, message: '平台管理员不能重置其他管理员密码' })
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(newPassword, 10)

    // 使用事务更新密码并记录日志
    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { passwordHash }
      }),
      prisma.passwordResetLog.create({
        data: {
          id: crypto.randomUUID(),
          targetId: id,
          operatorId: req.user!.userId,
          operatorRole: req.user!.role,
          resetMethod: resetMethod || 'manual_set',
          result: 'success'
        }
      })
    ])

    res.json({
      success: true,
      message: '密码重置成功'
    })
}, '服务器错误'))

// 获取用户操作日志（super_admin, platform_admin）
userRouter.get('/:id/logs', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { id } = req.params

    const [passwordResetLogs, statusLogs] = await Promise.all([
      prisma.passwordResetLog.findMany({
        where: { targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.userStatusLog.findMany({
        where: { targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    ])

    res.json({
      success: true,
      data: {
        passwordResetLogs: passwordResetLogs.map(log => ({
          ...log,
          createdAt: log.createdAt.toISOString()
        })),
        statusLogs: statusLogs.map(log => ({
          ...log,
          createdAt: log.createdAt.toISOString()
        }))
      }
    })
}, '服务器错误'))
