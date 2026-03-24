import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { prisma } from '../prisma.js'
import { canAccessSchool, canManageSchool } from '../middleware/permissions.js'
import bcrypt from 'bcryptjs'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../utils/validation.js'
import { calculateGrade } from '../../../../packages/shared/src/utils/grade.js'

export const schoolRouter = Router()

// 获取学校列表
// 性能优化：批量加载负责人信息，避免 N+1 查询
schoolRouter.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 获取当前用户信息
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { teacher: true }
    })

    let schoolFilter = {}
    // 非超管只能看到自己的学校
    if (user?.role !== 'super_admin' && user?.teacher?.schoolId) {
      schoolFilter = { id: user.teacher.schoolId }
    }

    const schools = await prisma.school.findMany({
      where: Object.keys(schoolFilter).length > 0 ? schoolFilter : undefined,
      include: {
        _count: {
          select: {
            teams: true,
            teachers: true,
            students: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // 收集所有负责人 ID
    const principalIds = schools
      .map(s => s.currentPrincipalTeacherId)
      .filter(Boolean) as string[]

    // 批量查询所有负责人信息（1 次查询代替 N 次）
    const principals = await prisma.teacher.findMany({
      where: { id: { in: principalIds } },
      select: {
        id: true,
        name: true,
        user: { select: { username: true } }
      }
    })

    // 创建 ID -> principal 的映射
    const principalMap = new Map(principals.map(p => [p.id, p]))

    // 组装结果
    const schoolsWithPrincipal = schools.map(school => ({
      ...school,
      principal: school.currentPrincipalTeacherId
        ? principalMap.get(school.currentPrincipalTeacherId) || null
        : null
    }))

    res.json({
      success: true,
      data: {
        list: schoolsWithPrincipal,
        total: schoolsWithPrincipal.length
      }
    })
  } catch (error) {
    console.error('Get schools error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学校的所有教师（包括负责人）- 必须放在 /:id 之前
schoolRouter.get('/:id/teachers', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 20

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
          user: {
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
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.teacher.count({ where: { schoolId: id } })
    ])

    res.json({
      success: true,
      data: {
        list: teachers,
        total,
        page,
        pageSize
      }
    })
  } catch (error) {
    console.error('Get school teachers error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学校学生 Rating 排名
schoolRouter.get('/:id/student-rankings', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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

    const students = await prisma.student.findMany({
      where: { schoolId: id },
      include: {
        user: { select: { username: true, avatar: true } }
      },
      orderBy: { rating: 'desc' }
    })

    // 将学校信息附加到每个学生
    const studentsWithSchool = students.map(s => ({
      ...s,
      school: {
        educationSystem: school?.educationSystem,
        schoolType: school?.schoolType
      }
    }))

    res.json({ success: true, data: studentsWithSchool })
  } catch (error) {
    console.error('Get student rankings error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学校学生列表（按年级分组）
schoolRouter.get('/:id/students-by-grade', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    // 资源级权限检查：只有本校用户可以查看
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的学生列表' })
    }

    const students = await prisma.student.findMany({
      where: { schoolId: id },
      include: {
        user: { select: { username: true } },
        headTeacher: { select: { name: true } }
      },
      orderBy: [
        { enrollmentYear: 'asc' }, // 入学年份升序（越早入学年级越高）
        { name: 'asc' }
      ]
    })

    // 按入学年份分组
    const grouped = students.reduce((acc, student) => {
      const year = student.enrollmentYear || 0
      if (!acc[year]) acc[year] = []
      acc[year].push(student)
      return acc
    }, {} as Record<number, typeof students>)

    res.json({ success: true, data: grouped })
  } catch (error) {
    console.error('Get students by grade error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 禁用/启用教师（仅学校负责人）
schoolRouter.put('/:id/teachers/:teacherId/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id, teacherId } = req.params
    const { status } = req.body // 'active' | 'disabled'
    const userId = req.user!.userId

    // 验证当前用户是否为该学校负责人
    const currentTeacher = await prisma.teacher.findUnique({ where: { userId } })
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
      where: { id: targetTeacher.userId },
      data: { status }
    })

    res.json({ success: true, message: '操作成功' })
  } catch (error) {
    console.error('Update teacher status error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学校详情
schoolRouter.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        teachers: {
          select: {
            id: true,
            name: true,
            title: true,
            email: true
          }
        },
        _count: {
          select: {
            teams: true,
            teachers: true,
            students: true
          }
        }
      }
    })

    if (!school) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    // 资源级权限检查：超管可查看所有，其他角色限本校
    const role = req.user!.role
    if (role !== 'super_admin' && role !== 'platform_admin') {
      const userSchoolId = await (await import('../middleware/permissions.js')).getUserSchoolId(req.user!.userId)
      if (userSchoolId !== id) {
        // 非本校用户只能看到基本信息，不返回教师列表
        return res.json({
          success: true,
          data: {
            id: school.id,
            name: school.name,
            shortName: school.shortName,
            region: school.region,
            schoolType: school.schoolType,
            educationSystem: school.educationSystem,
            _count: school._count
          }
        })
      }
    }

    // 获取负责人信息
    let principal = null
    if (school.currentPrincipalTeacherId) {
      principal = await prisma.teacher.findUnique({
        where: { id: school.currentPrincipalTeacherId },
        select: {
          id: true,
          name: true,
          title: true,
          email: true,
          phone: true,
          user: { select: { username: true } }
        }
      })
    }

    res.json({
      success: true,
      data: {
        ...school,
        principal
      }
    })
  } catch (error) {
    console.error('Get school error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建学校 - 仅超管可创建
schoolRouter.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 检查是否为 SUPER_ADMIN
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有超级管理员可以创建学校' })
    }

    const { name, region, schoolType, educationSystem, contactPerson, contactPhone, contactEmail, username, password, teacherName, teacherTitle } = req.body

    if (!name) {
      return res.status(400).json({ success: false, message: '学校名称不能为空' })
    }

    if (!username || !teacherName) {
      return res.status(400).json({ success: false, message: '必须提供学校负责人信息（账号和姓名）' })
    }

    // 验证用户名
    const usernameValidation = validateUsername(username)
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message })
    }

    // 验证密码
    const passwordValidation = validatePassword(password || username)
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message })
    }

    // 验证联系电话
    if (contactPhone) {
      const phoneValidation = validatePhone(contactPhone)
      if (!phoneValidation.valid) {
        return res.status(400).json({ success: false, message: phoneValidation.message })
      }
    }

    // 验证联系邮箱
    if (contactEmail) {
      const emailValidation = validateEmail(contactEmail)
      if (!emailValidation.valid) {
        return res.status(400).json({ success: false, message: emailValidation.message })
      }
    }

    // 检查学校名称是否已存在
    const existingSchool = await prisma.school.findFirst({ where: { name } })
    if (existingSchool) {
      return res.status(400).json({ success: false, message: '学校名称已存在' })
    }

    // 检查用户名是否已存在
    const existingUser = await prisma.user.findUnique({ where: { username } })
    if (existingUser) {
      return res.status(400).json({ success: false, message: '用户名已存在' })
    }

    // 验证和规范化学制
    let normalizedEducationSystem = educationSystem
    if (educationSystem && educationSystem !== '') {
      normalizedEducationSystem = educationSystem.replace(/\s+/g, '')
      const normalized = normalizedEducationSystem.replace(/[+\-]/g, '')
      if (normalized === '333' || normalizedEducationSystem === '3+3+3' || normalizedEducationSystem === '3-3-3') {
        normalizedEducationSystem = '6-3-3'
      } else if (normalized === '443' || normalizedEducationSystem === '4+4+3' || normalizedEducationSystem === '4-4-3') {
        normalizedEducationSystem = '5-4-3'
      }
      const validEducationSystems = ['6-3-3', '5-4-3']
      if (!validEducationSystems.includes(normalizedEducationSystem)) {
        return res.status(400).json({ success: false, message: '无效的学制，请选择 6-3-3 或 5-4-3' })
      }
    }

    // 使用事务创建学校及相关数据，确保原子性
    const hashedPassword = await bcrypt.hash(password || username, 10)

    const result = await prisma.$transaction(async (tx) => {
      // 1. 创建用户
      const user = await tx.user.create({
        data: {
          username,
          passwordHash: hashedPassword,
          role: 'school_principal',
          email: contactEmail || null,
          phone: contactPhone || null
        }
      })

      // 2. 创建学校（先创建，后续更新负责人）
      const school = await tx.school.create({
        data: {
          name,
          region: region || null,
          schoolType: schoolType || null,
          educationSystem: normalizedEducationSystem || '6-3-3',
          contactPerson: contactPerson || null,
          contactPhone: contactPhone || null,
          contactEmail: contactEmail || null,
          status: 'active',
          currentPrincipalTeacherId: 'temp' // 临时占位，下面立即更新
        }
      })

      // 3. 创建教师并关联学校
      const teacher = await tx.teacher.create({
        data: {
          userId: user.id,
          name: teacherName,
          email: contactEmail || null,
          phone: contactPhone || null,
          title: teacherTitle || '校长',
          status: 'active',
          schoolId: school.id
        }
      })

      // 4. 更新学校的负责人
      await tx.school.update({
        where: { id: school.id },
        data: { currentPrincipalTeacherId: teacher.id }
      })

      return { school, teacher, user }
    })

    res.json({
      success: true,
      data: result.school
    })
  } catch (error) {
    console.error('Create school error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新学校 - 仅超管可更新
schoolRouter.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { name, announcement, region, schoolType, educationSystem, contactPerson, contactPhone, contactEmail, status, currentPrincipalTeacherId } = req.body
    const userRole = req.user!.role
    const userId = req.user!.userId

    // 验证学校类型
    const validSchoolTypes = ['小学', '初中', '高中', '小学+初中', '初中+高中', '小学+初中+高中']
    if (schoolType && !validSchoolTypes.includes(schoolType)) {
      return res.status(400).json({ success: false, message: '无效的学校类型' })
    }

    // 验证和规范化学制
    let normalizedEducationSystem = educationSystem
    if (educationSystem && educationSystem !== '') {
      // 移除所有空格
      normalizedEducationSystem = educationSystem.replace(/\s+/g, '')

      // 转换常见格式
      if (normalizedEducationSystem === '3+3+3' || normalizedEducationSystem === '3-3-3') {
        normalizedEducationSystem = '6-3-3'
      } else if (normalizedEducationSystem === '4+4+3' || normalizedEducationSystem === '4-4-3') {
        normalizedEducationSystem = '5-4-3'
      }

      const validEducationSystems = ['6-3-3', '5-4-3']
      if (!validEducationSystems.includes(normalizedEducationSystem)) {
        return res.status(400).json({ success: false, message: '无效的学制，请选择 6-3-3 或 5-4-3' })
      }
    }

    const existing = await prisma.school.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    if (userRole === 'super_admin') {
      // 超管可以编辑所有字段
      // 如果更新名称，检查是否重复
      if (name && name !== existing.name) {
        const nameExists = await prisma.school.findUnique({ where: { name } })
        if (nameExists) {
          return res.status(400).json({ success: false, message: '学校名称已存在' })
        }
      }

      const school = await prisma.school.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(announcement !== undefined && { announcement: announcement || null }),
          ...(region !== undefined && { region: region || null }),
          ...(schoolType !== undefined && { schoolType: schoolType || null }),
          ...(educationSystem !== undefined && { educationSystem: normalizedEducationSystem || '6-3-3' }),
          ...(contactPerson !== undefined && { contactPerson: contactPerson || null }),
          ...(contactPhone !== undefined && { contactPhone: contactPhone || null }),
          ...(contactEmail !== undefined && { contactEmail: contactEmail || null }),
          ...(status !== undefined && { status }),
          ...(currentPrincipalTeacherId !== undefined && { currentPrincipalTeacherId: currentPrincipalTeacherId || null })
        }
      })

      res.json({
        success: true,
        data: school
      })
    } else if (userRole === 'school_principal') {
      // 学校负责人只能编辑自己学校的基本信息
      const teacher = await prisma.teacher.findUnique({ where: { userId } })
      if (!teacher) {
        return res.status(400).json({ success: false, message: '教师不存在' })
      }

      if (existing.currentPrincipalTeacherId !== teacher.id) {
        return res.status(403).json({ success: false, message: '只有本校负责人可以编辑学校信息' })
      }

      // 如果更新名称，检查是否重复
      if (name && name !== existing.name) {
        const nameExists = await prisma.school.findUnique({ where: { name } })
        if (nameExists) {
          return res.status(400).json({ success: false, message: '学校名称已存在' })
        }
      }

      // 只允许编辑基本信息字段（不包括 status 和 currentPrincipalTeacherId）
      const school = await prisma.school.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(announcement !== undefined && { announcement: announcement || null }),
          ...(region !== undefined && { region: region || null }),
          ...(schoolType !== undefined && { schoolType: schoolType || null }),
          ...(educationSystem !== undefined && { educationSystem: normalizedEducationSystem || '6-3-3' }),
          ...(contactPerson !== undefined && { contactPerson: contactPerson || null }),
          ...(contactPhone !== undefined && { contactPhone: contactPhone || null }),
          ...(contactEmail !== undefined && { contactEmail: contactEmail || null })
        }
      })

      res.json({
        success: true,
        data: school
      })
    } else {
      return res.status(403).json({ success: false, message: '权限不足' })
    }
  } catch (error) {
    console.error('Update school error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除学校 - 仅超管可删除
schoolRouter.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 检查是否为 SUPER_ADMIN
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有超级管理员可以删除学校' })
    }

    const { id } = req.params

    const existing = await prisma.school.findUnique({
      where: { id },
      include: {
        _count: { select: { teams: true, teachers: true, students: true } }
      }
    })

    if (!existing) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    // 检查是否有关联数据
    if (existing._count.teams > 0 || existing._count.teachers > 0 || existing._count.students > 0) {
      return res.status(400).json({
        success: false,
        message: '该学校下存在团队、教师或学生，无法删除'
      })
    }

    await prisma.school.delete({ where: { id } })

    res.json({
      success: true,
      message: '删除成功'
    })
  } catch (error) {
    console.error('Delete school error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 初始化数据（创建默认学校并修复数据）
schoolRouter.post('/init', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 1. 创建默认学校
    const defaultSchool = await prisma.school.upsert({
      where: { id: 'default-school' },
      update: {},
      create: {
        id: 'default-school',
        name: '第一中学',
        description: '默认学校'
      }
    })

    // 2. 清理没有 schoolId 的团队（设置为默认学校）
    const teamsWithoutSchool = await prisma.team.findMany({
      where: { schoolId: null }
    })

    if (teamsWithoutSchool.length > 0) {
      await prisma.team.updateMany({
        where: { schoolId: null },
        data: { schoolId: defaultSchool.id }
      })
    }

    // 3. 清理学生的无效 teamId（已废弃：学生现在使用多对多关系）
    // const invalidStudentTeams = await prisma.student.findMany({
    //   where: {
    //     teamId: { not: null }
    //   },
    //   include: { team: true }
    // })
    //
    // for (const student of invalidStudentTeams) {
    //   if (!student.team) {
    //     await prisma.student.update({
    //       where: { id: student.id },
    //       data: { teamId: null }
    //     })
    //   }
    // }

    res.json({
      success: true,
      message: `初始化完成，创建学校: ${defaultSchool.name}，修复团队: ${teamsWithoutSchool.length} 个`
    })
  } catch (error) {
    console.error('Init data error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 设置学校负责人 - 仅超管可操作
schoolRouter.put('/:id/principal', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
      select: { userId: true }
    })

    // 获取旧负责人的 userId（如果存在）
    let oldPrincipalUserId: string | null = null
    if (oldPrincipalId) {
      const oldPrincipalTeacher = await prisma.teacher.findUnique({
        where: { id: oldPrincipalId },
        select: { userId: true }
      })
      oldPrincipalUserId = oldPrincipalTeacher?.userId || null
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
        where: { id: newPrincipalTeacher!.userId },
        data: { role: 'school_principal' }
      }),
      // 记录日志
      prisma.principalTransferLog.create({
        data: {
          schoolId: id,
          oldPrincipalTeacherId: oldPrincipalId,
          newPrincipalTeacherId: teacherId,
          operatorUserId: req.user!.userId,
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
          user: {
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
  } catch (error) {
    console.error('Set principal error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建学校负责人 - 仅超管可操作
schoolRouter.post('/:id/principal', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
          phone: phone || null
        }
      })

      // 2. 创建教师并关联学校
      const teacher = await tx.teacher.create({
        data: {
          userId: user.id,
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
  } catch (error) {
    console.error('Create principal error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学校负责人变更日志
schoolRouter.get('/:id/principal-logs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    // 资源级权限检查：只有本校用户和超管可查看
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的日志' })
    }

    const logs = await prisma.principalTransferLog.findMany({
      where: { schoolId: id },
      orderBy: { createdAt: 'desc' }
    })

    res.json({ success: true, data: logs })
  } catch (error) {
    console.error('Get principal logs error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 学校负责人获取本校教师列表
schoolRouter.get('/current/teachers', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 检查是否为学校负责人
    if (req.user?.role !== 'school_principal') {
      return res.status(403).json({ success: false, message: '只有学校负责人可以查看本校教师' })
    }

    // 获取当前用户的教师信息
    const teacher = await prisma.teacher.findFirst({
      where: { userId: req.user!.userId }
    })

    if (!teacher || !teacher.schoolId) {
      return res.status(403).json({ success: false, message: '您还没有负责的学校' })
    }

    // 获取本校所有教师
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: teacher.schoolId },
      include: { user: { select: { username: true, email: true, phone: true, avatar: true } } },
      orderBy: { createdAt: 'desc' }
    })

    res.json({ success: true, data: teachers })
  } catch (error) {
    console.error('Get school teachers error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 学校负责人创建本校教师
schoolRouter.post('/current/teachers', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
      where: { userId: req.user!.userId }
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
        email,
        phone,
        avatar: null,
        bio
      }
    })

    // 创建教师
    const newTeacher = await prisma.teacher.create({
      data: {
        userId: user.id,
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
  } catch (error) {
    console.error('Create school teacher error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 学校负责人编辑本校教师
schoolRouter.put('/current/teachers/:teacherId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 检查是否为学校负责人
    if (req.user?.role !== 'school_principal') {
      return res.status(403).json({ success: false, message: '只有学校负责人可以编辑本校教师' })
    }

    const { teacherId } = req.params
    const { name, email, phone, bio, title, status } = req.body

    // 获取当前用户的教师信息
    const currentTeacher = await prisma.teacher.findFirst({
      where: { userId: req.user!.userId }
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
      where: { id: targetTeacher.userId }
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
  } catch (error) {
    console.error('Edit school teacher error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 学校负责人转移负责人
schoolRouter.post('/current/principal-transfer', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
      where: { userId: req.user!.userId }
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
    const oldPrincipalUserId = currentPrincipal.userId
    const newPrincipalTeacher = await prisma.teacher.findUnique({
      where: { id: newTeacherId },
      select: { userId: true }
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
        where: { id: newPrincipalTeacher.userId },
        data: { role: 'school_principal' }
      }),
      // 记录日志
      prisma.principalTransferLog.create({
        data: {
          schoolId: currentPrincipal.schoolId,
          oldPrincipalTeacherId: currentPrincipal.id,
          newPrincipalTeacherId: newTeacherId,
          operatorUserId: req.user!.userId,
          result: 'success',
          message: '学校负责人转移'
        }
      })
    ])

    res.json({ success: true, message: '负责人转移成功' })
  } catch (error) {
    console.error('Principal transfer error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新学校状态（启用/停用）
schoolRouter.put('/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // 检查是否为 SUPER_ADMIN
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有超级管理员可以修改学校状态' })
    }

    const { id } = req.params
    const { status } = req.body

    if (!status || !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, message: '状态值无效' })
    }

    const school = await prisma.school.findUnique({ where: { id } })
    if (!school) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    const updated = await prisma.school.update({
      where: { id },
      data: { status }
    })

    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update school status error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学校统计数据
schoolRouter.get('/:id/stats', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  try {
    // 资源级权限检查：只有本校用户可以查看
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的统计数据' })
    }

    // 获取学校信息（包含学制和学校类型）
    const school = await prisma.school.findUnique({
      where: { id },
      select: { educationSystem: true, schoolType: true }
    })

    if (!school) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    // 获取学生平均 Rating 和入学信息
    const students = await prisma.student.findMany({
      where: { schoolId: id },
      select: {
        rating: true,
        enrollmentYear: true
      }
    })

    const avgRating = students.length > 0
      ? Math.round(students.reduce((sum, s) => sum + s.rating, 0) / students.length)
      : 0

    // 使用共享的 calculateGrade 函数计算年级分布
    // 入学阶段由学校类型决定
    const gradeDistribution: Record<string, number> = {}

    students.forEach(student => {
      const grade = calculateGrade({
        enrollmentYear: student.enrollmentYear,
        educationSystem: school.educationSystem,
        schoolType: school.schoolType
      })

      // 将"已毕业 x 年"、"未设置"、"未入学"统一归类为"其他"用于分布显示
      const displayGrade = (grade.startsWith('已毕业') || grade === '未设置' || grade === '未入学') ? '其他' : grade
      gradeDistribution[displayGrade] = (gradeDistribution[displayGrade] || 0) + 1
    })

    res.json({
      success: true,
      data: {
        avgRating,
        gradeDistribution,
        schoolType: school.schoolType,
        educationSystem: school.educationSystem
      }
    })
  } catch (error) {
    console.error('Get school stats error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新学校公告 - 仅学校负责人可编辑
schoolRouter.put('/:id/announcement', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { announcement } = req.body

    // 获取当前用户信息
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { teacher: true }
    })

    // 检查权限：必须是学校负责人
    if (user?.role !== 'school_principal') {
      return res.status(403).json({ success: false, message: '只有学校负责人可以编辑公告' })
    }

    // 检查学校是否存在
    const school = await prisma.school.findUnique({ where: { id } })
    if (!school) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    // 检查是否是该学校的负责人
    if (school.currentPrincipalTeacherId !== user.teacher?.id) {
      return res.status(403).json({ success: false, message: '只有本校负责人可以编辑公告' })
    }

    // 更新公告
    const updated = await prisma.school.update({
      where: { id },
      data: { announcement: announcement || null }
    })

    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update school announcement error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

