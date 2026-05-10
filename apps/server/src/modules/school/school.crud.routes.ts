/**
 * School CRUD Routes
 * 学校 CRUD 路由：列表、详情、创建、更新、删除、状态
 */

import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate, AuthRequest } from '../../middleware/auth.js'
import { prisma } from '../../prisma.js'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../../utils/validation.js'
import { asyncHandler } from '../../lib/asyncHandler'

export const schoolCrudRouter = Router()

// ==================== 获取学校列表 ====================
// 性能优化：批量加载负责人信息，避免 N+1 查询
schoolCrudRouter.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 获取当前用户信息
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { Teacher: true }
    })

    let schoolFilter = {}
    // 非超管只能看到自己的学校
    if (user?.role !== 'super_admin' && user?.Teacher?.schoolId) {
      schoolFilter = { id: user.Teacher.schoolId }
    }

    const schools = await prisma.school.findMany({
      where: Object.keys(schoolFilter).length > 0 ? schoolFilter : undefined,
      include: {
        _count: {
          select: {
            Team: true,
            Teacher_Teacher_schoolIdToSchool: true,
            Student: true
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
        User: { select: { username: true } }
      }
    })

    // 创建 ID -> principal 的映射
    const principalMap = new Map(principals.map(p => [p.id, p]))

    // 组装结果，转换字段名以符合前端契约
    const schoolsWithPrincipal = schools.map(school => {
      const { _count, ...rest } = school
      return {
        ...rest,
        principal: school.currentPrincipalTeacherId
          ? principalMap.get(school.currentPrincipalTeacherId) || null
          : null,
        _count: {
          teams: _count.Team,
          teachers: _count.Teacher_Teacher_schoolIdToSchool,
          students: _count.Student
        }
      }
    })

    res.json({
      success: true,
      data: {
        data: schoolsWithPrincipal,
        total: schoolsWithPrincipal.length
      }
    })
}))

// ==================== 获取学校详情 ====================
schoolCrudRouter.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params

    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        Teacher_Teacher_schoolIdToSchool: {
          select: {
            id: true,
            name: true,
            title: true,
            email: true
          }
        },
        _count: {
          select: {
            Team: true,
            Teacher_Teacher_schoolIdToSchool: true,
            Student: true
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
      const userSchoolId = await (await import('../../middleware/permissions.js')).getUserSchoolId(req.user!.userId)
      if (userSchoolId !== id) {
        // 非本校用户只能看到基本信息，不返回教师列表
        const { _count } = school
        return res.json({
          success: true,
          data: {
            id: school.id,
            name: school.name,
            region: school.region,
            schoolType: school.schoolType,
            educationSystem: school.educationSystem,
            _count: {
              teams: _count.Team,
              teachers: _count.Teacher_Teacher_schoolIdToSchool,
              students: _count.Student
            }
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
          User: { select: { username: true } }
        }
      })
    }

        // 转换字段名以符合前端契约
    const { _count, Teacher_Teacher_schoolIdToSchool, ...schoolRest } = school
    res.json({
      success: true,
      data: {
        ...schoolRest,
        _count: {
          teams: _count.Team,
          teachers: _count.Teacher_Teacher_schoolIdToSchool,
          students: _count.Student
        },
        principal: principal ? {
          id: principal.id,
          name: principal.name,
          title: principal.title,
          email: principal.email,
          phone: principal.phone,
          user: principal.User ? { username: principal.User.username } : null
        } : null
      }
    })
}))

// ==================== 创建学校 ====================
// 仅超管可创建
schoolCrudRouter.post('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
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
    // 注意：循环 FK 依赖 - User.schoolId → School.id, School.currentPrincipalTeacherId → Teacher.id (= User.id)
    // 解决方案：使用 $executeRaw 暂时禁用 FK 约束检查
    const hashedPassword = await bcrypt.hash(password || username, 10)

    const result = await prisma.$transaction(async (tx) => {
      // 暂时禁用 FK 约束检查
      await tx.$executeRaw`SET session_replication_role = replica`

      // 1. 创建学校（使用临时占位 ID）
      const schoolId = crypto.randomUUID()
      const school = await tx.school.create({
        data: {
          id: schoolId,
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

      // 2. 创建用户（必须绑定学校）
      const userId = crypto.randomUUID()
      const user = await tx.user.create({
        data: {
          id: userId,
          username,
          passwordHash: hashedPassword,
          role: 'school_principal',
          schoolId: school.id, // 所有用户必须绑定学校
          email: contactEmail || null,
          phone: contactPhone || null
        }
      })

      // 3. 创建教师并关联学校（Teacher.id = User.id）
      const teacher = await tx.teacher.create({
        data: {
          id: user.id,
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

      // 重新启用 FK 约束检查
      await tx.$executeRaw`SET session_replication_role = origin`

      return { school, teacher, user }
    })

    res.json({
      success: true,
      data: result.school
    })
}))

// ==================== 更新学校 ====================
schoolCrudRouter.put('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
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
        const nameExists = await prisma.school.findFirst({ where: { name } })
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
      const teacher = await prisma.teacher.findUnique({ where: { id: userId } })
      if (!teacher) {
        return res.status(400).json({ success: false, message: '教师不存在' })
      }

      if (existing.currentPrincipalTeacherId !== teacher.id) {
        return res.status(403).json({ success: false, message: '只有本校负责人可以编辑学校信息' })
      }

      // 如果更新名称，检查是否重复
      if (name && name !== existing.name) {
        const nameExists = await prisma.school.findFirst({ where: { name } })
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
}))

// ==================== 删除学校 ====================
// 仅超管可删除
schoolCrudRouter.delete('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 检查是否为 SUPER_ADMIN
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有超级管理员可以删除学校' })
    }

    const { id } = req.params

    const existing = await prisma.school.findUnique({
      where: { id },
      include: {
        _count: { select: { Team: true, Teacher_Teacher_schoolIdToSchool: true, Student: true } }
      }
    })

    if (!existing) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    // 检查是否有关联数据
    if (existing._count.Team > 0 || existing._count.Teacher_Teacher_schoolIdToSchool > 0 || existing._count.Student > 0) {
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
}))

// ==================== 更新学校状态 ====================
// 仅超管可操作
schoolCrudRouter.put('/:id/status', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
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
}))