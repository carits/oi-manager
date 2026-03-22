import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate, AuthRequest, isAdmin, isSuperAdmin } from '../middleware/auth.js'
import { prisma } from '../prisma.js'
import { CreatePlatformAdminRequest, ResetUserPasswordRequest, GetUsersQueryParams } from '../../../../packages/shared/src/index.js'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../utils/validation.js'

export const userRouter = Router()

// 获取用户公开信息（所有登录用户可访问）
userRouter.get('/:userId/profile', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params
    const { userType } = req.query

    if (!userType || !['teacher', 'student'].includes(userType as string)) {
      return res.status(400).json({ success: false, message: 'userType 参数无效' })
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
          school: { select: { id: true, name: true } },
          userId: true
        }
      })

      if (!teacher) {
        return res.status(404).json({ success: false, message: '用户不存在' })
      }

      // 获取 User 表的头像和用户名（优先使用 User 表的）
      const user = teacher.userId ? await prisma.user.findUnique({
        where: { id: teacher.userId },
        select: { username: true, avatar: true, bio: true }
      }) : null

      profileData = {
        id: teacher.id,
        name: teacher.name,
        username: user?.username || '',
        avatar: user?.avatar || teacher.avatar,
        bio: user?.bio || teacher.bio,
        userType: 'teacher',
        school: teacher.school
      }
    } else {
      const student = await prisma.student.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          avatar: true,
          schoolId: true,
          school: { select: { id: true, name: true } },
          userId: true
        }
      })

      if (!student) {
        return res.status(404).json({ success: false, message: '用户不存在' })
      }

      // 获取 User 表的头像和用户名（优先使用 User 表的）
      const user = student.userId ? await prisma.user.findUnique({
        where: { id: student.userId },
        select: { username: true, avatar: true, bio: true }
      }) : null

      profileData = {
        id: student.id,
        name: student.name,
        username: user?.username || '',
        avatar: user?.avatar || student.avatar,
        bio: user?.bio || '',
        userType: 'student',
        school: student.school
      }
    }

    res.json({ success: true, data: profileData })
  } catch (error) {
    console.error('Get user profile error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取所有用户列表（super_admin, platform_admin）
userRouter.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 权限检查
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { role, status, schoolId, keyword, page = 1, pageSize = 20 } = req.query as unknown as GetUsersQueryParams

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
              page: Number(page),
              pageSize: Number(pageSize),
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
        { teacher: { schoolId } },
        { student: { schoolId } }
      ]
    }

    const skip = (Number(page) - 1) * Number(pageSize)
    const take = Number(pageSize)

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        include: {
          teacher: {
            select: {
              id: true,
              name: true,
              schoolId: true,
              school: { select: { id: true, name: true } }
            }
          },
          student: {
            select: {
              id: true,
              name: true,
              schoolId: true,
              school: { select: { id: true, name: true } }
            }
          },
          admin: {
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
    const formattedUsers = users.map(user => ({
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
      profile: user.teacher ? {
        id: user.teacher.id,
        name: user.teacher.name,
        schoolId: user.teacher.schoolId || undefined,
        schoolName: user.teacher.school?.name
      } : user.student ? {
        id: user.student.id,
        name: user.student.name,
        schoolId: user.student.schoolId || undefined,
        schoolName: user.student.school?.name
      } : user.admin ? {
        id: user.admin.id,
        name: user.admin.name
      } : undefined
    }))

    res.json({
      success: true,
      data: {
        users: formattedUsers,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize))
      }
    })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取用户详情（super_admin, platform_admin）
userRouter.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { id } = req.params

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        teacher: {
          include: {
            school: { select: { id: true, name: true } }
          }
        },
        student: {
          include: {
            school: { select: { id: true, name: true } }
          }
        },
        admin: true
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
      profile: user.teacher ? {
        id: user.teacher.id,
        name: user.teacher.name,
        schoolId: user.teacher.schoolId || undefined,
        schoolName: user.teacher.school?.name
      } : user.student ? {
        id: user.student.id,
        name: user.student.name,
        schoolId: user.student.schoolId || undefined,
        schoolName: user.student.school?.name
      } : user.admin ? {
        id: user.admin.id,
        name: user.admin.name
      } : undefined
    }

    res.json({ success: true, data: response })
  } catch (error) {
    console.error('Get user detail error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建平台管理员（仅 super_admin）
userRouter.post('/platform-admin', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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

    // 创建用户和管理员档案
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: 'platform_admin',
        phone,
        email,
        bio,
        admin: {
          create: {
            name
          }
        }
      },
      include: {
        admin: true
      }
    })

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        role: user.role,
        adminId: user.admin?.id
      }
    })
  } catch (error) {
    console.error('Create platform admin error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 启用/禁用用户（super_admin, platform_admin）
userRouter.put('/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
          targetUserId: id,
          operatorUserId: req.user!.userId,
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
  } catch (error) {
    console.error('Update user status error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 重置用户密码（super_admin, platform_admin）
userRouter.post('/:id/reset-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
          targetUserId: id,
          operatorUserId: req.user!.userId,
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
  } catch (error) {
    console.error('Reset password error:', error)

    // 记录失败日志
    try {
      await prisma.passwordResetLog.create({
        data: {
          targetUserId: req.params.id,
          operatorUserId: req.user!.userId,
          operatorRole: req.user!.role,
          resetMethod: req.body.resetMethod || 'manual_set',
          result: 'failed',
          message: error instanceof Error ? error.message : '未知错误'
        }
      })
    } catch (logError) {
      console.error('Failed to log password reset error:', logError)
    }

    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取用户操作日志（super_admin, platform_admin）
userRouter.get('/:id/logs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const { id } = req.params

    const [passwordResetLogs, statusLogs] = await Promise.all([
      prisma.passwordResetLog.findMany({
        where: { targetUserId: id },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.userStatusLog.findMany({
        where: { targetUserId: id },
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
  } catch (error) {
    console.error('Get user logs error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
