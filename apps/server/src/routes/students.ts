import crypto from 'crypto'
import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../prisma'
import { authenticate, authorize } from '../middleware/auth'
import { canViewStudent, canManageStudent, getUserSchoolId } from '../middleware/permissions'
import { generateTempPassword, hashPassword } from '../utils/password'
import logger from '../lib/logger'
import { asyncHandler } from '../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../lib/pagination'
import { getComputedTrainingStatus, sortTrainingListForDisplay } from '../modules/training/training.helpers'
import { calculateGrade, getAllGrades } from '@oi-manager/shared/utils/grade'

export const studentRouter = Router()

function normalizeEducationSystemDetail(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const detail = value as Record<string, unknown>
  return {
    primaryYears: typeof detail.primaryYears === 'number' ? detail.primaryYears : undefined,
    middleYears: typeof detail.middleYears === 'number' ? detail.middleYears : undefined,
    highYears: typeof detail.highYears === 'number' ? detail.highYears : undefined,
  }
}

// 获取学生列表 (老师、学校负责人和管理员)
// 性能优化：使用数据库级分页和排序，避免全量查询后在内存中处理
studentRouter.get('/', authenticate, asyncHandler(async (req, res) => {
    const { headTeacherId, teamId, schoolId, username, q, grade, status } = req.query
    const { page, pageSize } = parsePagination(req.query)

    // 获取当前登录教师信息
    const userId = req.user!.userId
    const currentUser = await prisma.user.findUnique({ where: { id: userId } })
    const currentTeacher = await prisma.teacher.findUnique({ where: { id: userId } })
    const currentTeacherId = currentTeacher?.id

    // 权限检查：普通教师只能查看自己的学生
    const isPrincipal = currentUser?.role === 'school_principal'
    const isSuperAdmin = currentUser?.role === 'super_admin'
    const isPlatformAdmin = currentUser?.role === 'platform_admin'

    // 如果不是学校负责人/超管/平台管理员，强制只能查看自己的学生
    const finalHeadTeacherId = (isPrincipal || isSuperAdmin || isPlatformAdmin)
      ? (headTeacherId as string | undefined)
      : currentTeacherId

    const where: Record<string, unknown> = {}
    if (finalHeadTeacherId) where.headTeacherId = finalHeadTeacherId
    if (teamId) {
      where.teams = {
        some: {
          teamId: teamId as string
        }
      }
    }
    if (schoolId) where.schoolId = schoolId as string

    // 如果有用户名查询，模糊匹配用户名
    const search = typeof q === 'string' ? q.trim() : typeof username === 'string' ? username.trim() : ''
    if (search) {
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { User: { username: { contains: search, mode: 'insensitive' } } }]
    }
    if (status === 'active' || status === 'disabled') {
      where.User = { ...(where.User as object || {}), status }
    }

    // 年级由学校学制计算，筛选后再分页，保持和校园排行榜一致。
    const students = await prisma.student.findMany({
      where,
      orderBy: [
        { enrollmentYear: 'desc' }
      ],
      include: {
        School: {
          select: {
            id: true,
            name: true,
            educationSystem: true,
            educationSystemDetail: true,
            schoolType: true
          }
        },
        Teacher: { select: { id: true, name: true } },
        User: { select: { username: true, phone: true, email: true, avatar: true, status: true } }
      }
    })

    // 转换字段名为前端期望的格式
    const formattedStudents = students.map(student => {
      const { User, Teacher, School, ...rest } = student
      return {
        ...rest,
        user: User ? {
          username: User.username,
          phone: User.phone,
          email: User.email,
          avatar: User.avatar,
          status: User.status
        } : null,
        school: School ? {
          id: School.id,
          name: School.name,
          educationSystem: School.educationSystem,
          educationSystemDetail: School.educationSystemDetail,
          schoolType: School.schoolType
        } : null,
        headTeacher: Teacher ? {
          id: Teacher.id,
          name: Teacher.name
        } : null
      }
    })

    const filteredStudents = typeof grade === 'string' && grade
      ? formattedStudents.filter(student => calculateGrade({
          enrollmentYear: student.enrollmentYear,
          educationSystem: student.school?.educationSystem,
          educationSystemDetail: normalizeEducationSystemDetail(student.school?.educationSystemDetail),
          schoolType: student.school?.schoolType
        }) === grade)
      : formattedStudents
    const total = filteredStudents.length
    const start = (page - 1) * pageSize
    const school = formattedStudents[0]?.school
    const gradeOptions = school
      ? getAllGrades(school.schoolType, school.educationSystem, normalizeEducationSystemDetail(school.educationSystemDetail)).filter(Boolean)
      : []
    res.json({
      success: true,
      data: { ...paginatedResponse(filteredStudents.slice(start, start + pageSize), total, page, pageSize), filters: { grades: gradeOptions } }
    })
}, '服务器错误'))

// 获取学生 rating 排名 (老师)
// 性能优化：使用数据库级排序，优化最近成绩变化的获取方式
studentRouter.get('/rankings', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
    // 获取当前用户的学校 ID，限制只返回本校学生
    const schoolId = await getUserSchoolId(req.user!.userId)

    // 构建查询条件：超管和平台管理员可看所有，其他角色限本校
    const role = req.user!.role
    const whereClause = (role === 'super_admin' || role === 'platform_admin')
      ? {}
      : { schoolId: schoolId! }

    // 性能优化：使用数据库级排序按 rating 降序
    const students = await prisma.student.findMany({
      where: whereClause,
      orderBy: { rating: 'desc' },
      select: {
        id: true,
        name: true,
        rating: true,
        User: { select: { username: true, avatar: true } }
      }
    })

    // 批量获取所有学生的最近成绩变化（一次查询代替 N 次查询）
    const studentIds = students.map(s => s.id)
    const latestResults = await prisma.contestResult.groupBy({
      by: ['studentId'],
      where: { studentId: { in: studentIds } },
      _max: { createdAt: true }
    })

    // 获取最近成绩的 ratingChange
    const latestResultWithChange = await prisma.contestResult.findMany({
      where: {
        OR: latestResults.filter(r => r._max.createdAt).map(r => ({
          studentId: r.studentId as string,
          createdAt: r._max.createdAt as Date
        }))
      },
      select: {
        studentId: true,
        ratingChange: true
      }
    })

    // 创建学生 ID 到最近成绩变化的映射
    const ratingChangeMap = new Map(
      latestResultWithChange.map(r => [r.studentId, r.ratingChange || 0])
    )

    // 组装排名结果（已在数据库排序，无需内存排序）
    const rankings = students.map((s, i) => ({
      id: s.id,
      name: s.name,
      rating: s.rating || 1200,
      avatar: s.User?.avatar,
      username: s.User?.username,
      lastRatingChange: ratingChangeMap.get(s.id) || 0,
      rank: i + 1
    }))

    // 计算涨分榜和掉分榜
    const gainers = rankings
      .filter(s => s.lastRatingChange > 0)
      .sort((a, b) => b.lastRatingChange - a.lastRatingChange)
      .slice(0, 5)
    const losers = rankings
      .filter(s => s.lastRatingChange < 0)
      .sort((a, b) => a.lastRatingChange - b.lastRatingChange)
      .slice(0, 5)

    res.json({
      success: true,
      data: {
        rankings,
        gainers,
        losers,
        total: rankings.length
      }
    })
}, '服务器错误'))

/**
 * GET /api/students/my-homeworks
 * 学生查看自己所在团队的作业列表
 */
studentRouter.get('/my-homeworks', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const userId = req.user!.userId

    // 获取学生所在的所有团队
    const teamMembers = await prisma.teamMember.findMany({
      where: { userId, userType: 'student', status: 'active' },
      select: { teamId: true }
    })
    const teamIds = teamMembers.map(m => m.teamId)

    if (teamIds.length === 0) {
      return res.json({ success: true, data: [] })
    }

    // 查询这些团队的 homework 类型训练
    const trainings = await prisma.training.findMany({
      where: {
        teamId: { in: teamIds },
        type: 'homework',
      },
      orderBy: { startTime: 'desc' },
      include: {
        _count: { select: { TrainingProblem: true } },
      }
    })

    const data = trainings.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      startTime: t.startTime,
      endTime: t.endTime,
      status: getComputedTrainingStatus(t),
      format: t.format,
      teamId: t.teamId,
      problemCount: t._count.TrainingProblem,
      createdAt: t.createdAt,
    }))

    res.json({ success: true, data: sortTrainingListForDisplay(data) })
}, '获取作业列表失败'))

/**
 * GET /api/students/my-contests
 * 学生查看自己所在团队的比赛 + 学校级比赛
 */
studentRouter.get('/my-contests', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const userId = req.user!.userId

    // 获取学生所在的所有团队
    const teamMembers = await prisma.teamMember.findMany({
      where: { userId, userType: 'student', status: 'active' },
      select: { teamId: true }
    })
    const teamIds = teamMembers.map(m => m.teamId)

    // 获取学生学校
    const student = await prisma.student.findUnique({
      where: { id: userId },
      select: { schoolId: true }
    })

    // 查询团队比赛
    const teamTrainings = teamIds.length > 0 ? await prisma.training.findMany({
      where: {
        teamId: { in: teamIds },
        type: 'contest',
      },
      orderBy: { startTime: 'desc' },
      include: {
        _count: { select: { TrainingProblem: true } },
      }
    }) : []

    // 查询学校级比赛
    const schoolTrainings = student?.schoolId ? await prisma.training.findMany({
      where: {
        schoolId: student.schoolId,
        teamId: null,
        type: 'contest',
      },
      orderBy: { startTime: 'desc' },
      include: {
        _count: { select: { TrainingProblem: true } },
      }
    }) : []

    const formatTraining = (t: any, source: string) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      startTime: t.startTime,
      endTime: t.endTime,
      status: getComputedTrainingStatus(t),
      format: t.format,
      teamId: t.teamId,
      schoolId: t.schoolId,
      problemCount: t._count.TrainingProblem,
      source,
      createdAt: t.createdAt,
    })

    const data = [
      ...teamTrainings.map(t => formatTraining(t, 'team')),
      ...schoolTrainings.map(t => formatTraining(t, 'school')),
    ]

    res.json({ success: true, data: sortTrainingListForDisplay(data) })
}, '获取比赛列表失败'))

// 获取学生详情 - 支持通过 id 或 userId 查询
studentRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params

    // 先查询学生基本信息（用于权限检查）
    const studentBasic = await prisma.student.findFirst({
      where: {
        OR: [
          { id },
          { User: { username: id } }
        ]
      },
      select: { id: true }
    })

    if (!studentBasic) {
      return res.status(404).json({ success: false, message: '学生不存在' })
    }

    // 资源级权限检查
    if (!await canViewStudent(req, studentBasic.id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学生的信息' })
    }

    // 获取完整学生信息
    const student = await prisma.student.findUnique({
      where: { id: studentBasic.id },
      include: {
        School: { select: { id: true, name: true } },
        Teacher: { select: { id: true, name: true, title: true } },
        User: { select: { username: true, phone: true, email: true, avatar: true, bio: true } },
        Milestone: { orderBy: { milestoneDate: 'desc' } },
        ContestResult: { include: { Contest: true }, orderBy: { Contest: { contestDate: 'desc' } } }
      }
    })

    if (!student) {
      return res.status(404).json({ success: false, message: '学生不存在' })
    }

    res.json({ success: true, data: student })
}, '服务器错误'))

// 创建学生 (老师)
studentRouter.post('/', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
    const { name, gender, schoolId, enrollmentYear, targetContest, headTeacherId, tags, notes, username, phone, email, avatar } = req.body

    // 验证必填字段：用户名
    if (!username) {
      return res.status(400).json({ success: false, message: '用户名为必填项' })
    }

    // 获取当前登录老师的信息
    const userId = req.user!.userId
    const teacher = await prisma.teacher.findUnique({ where: { id: userId } })

    // 确定 schoolId：优先使用传入的，否则使用当前教师的学校
    const finalSchoolId = schoolId || teacher?.schoolId
    if (!finalSchoolId) {
      return res.status(400).json({ success: false, message: '学生必须关联学校，请确保您已归属学校' })
    }
    const school = await prisma.school.findUnique({ where: { id: finalSchoolId }, select: { organizationId: true } })
    const organizationId = school?.organizationId
    if (!organizationId) {
      return res.status(400).json({ success: false, message: '学校尚未完成身份空间初始化，暂时无法创建学生' })
    }

    // 权限检查：教师只能为本校创建学生（超管/平台管理员/学校负责人可以为任意学校创建）
    const currentUser = await prisma.user.findUnique({ where: { id: userId } })
    const isPrivileged = currentUser?.role === 'super_admin' || currentUser?.role === 'platform_admin' || currentUser?.role === 'school_principal'
    if (!isPrivileged && teacher?.schoolId && schoolId && schoolId !== teacher.schoolId) {
      return res.status(400).json({ success: false, message: '您只能为本校创建学生' })
    }

    // 确定主教练：优先使用传入的，否则使用当前登录的老师
    const finalHeadTeacherId = headTeacherId || teacher?.id
    if (!finalHeadTeacherId) {
      return res.status(400).json({ success: false, message: '主教练为必填项，请指定主教练' })
    }

    // 使用事务创建学生及相关数据，确保原子性
    const student = await prisma.$transaction(async (tx) => {
      // 检查用户名是否已存在
      const existingUser = await tx.user.findUnique({ where: { username } })
      if (existingUser) {
        throw new Error('USERNAME_EXISTS')
      }

      // 生成安全的临时密码
      const tempPassword = generateTempPassword()
      const hashedPassword = await hashPassword(tempPassword)

      const userId = crypto.randomUUID()
      const newUser = await tx.user.create({
        data: {
          id: userId,
          username,
          passwordHash: hashedPassword,
          role: 'student',
          schoolId: finalSchoolId, // 用户必须绑定学校
          phone,
          email,
          avatar
        }
      })

      // 学生档案与身份空间必须同时创建，否则会出现“已属于学校但无法切换到校园”的状态。
      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId, userId: newUser.id } },
        create: {
          id: crypto.randomUUID(),
          organizationId,
          userId: newUser.id,
          memberRole: 'student',
          relationType: 'enrolled',
          status: 'active',
          joinedAt: new Date()
        },
        update: {
          memberRole: 'student',
          relationType: 'enrolled',
          status: 'active',
          joinedAt: new Date()
        }
      })
      const membership = await tx.organizationMembership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: newUser.id } },
        select: { id: true }
      })
      await tx.organizationStudentProfile.upsert({
        where: { membershipId: membership.id },
        create: { id: crypto.randomUUID(), membershipId: membership.id, name: name || username, gender, enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null, targetContest, tags: tags ? JSON.stringify(tags) : null, notes, avatar, status: 'active' },
        update: { name: name || username, gender, enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null, targetContest, tags: tags ? JSON.stringify(tags) : null, notes, avatar, status: 'active' }
      })

      // 创建学生
      return await tx.student.create({
        data: {
          id: newUser.id,
          name,
          gender,
          schoolId: finalSchoolId,
          enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null,
          targetContest,
          headTeacherId: finalHeadTeacherId,
          tags: tags ? JSON.stringify(tags) : null,
          notes,
        }
      })
    })

    res.json({ success: true, data: student })
}, '服务器错误'))

// 更新学生 (老师)
studentRouter.put('/:id', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
    const { id } = req.params
    const { name, gender, schoolId, enrollmentYear, targetContest, headTeacherId, tags, notes, avatar, rating, password } = req.body

    // 获取当前登录老师的信息
    const userId = req.user!.userId
    const teacher = await prisma.teacher.findUnique({ where: { id: userId } })

    // 先获取学生信息
    const existingStudent = await prisma.student.findUnique({
      where: { id },
      include: { User: true }
    })

    if (!existingStudent) {
      return res.status(404).json({ success: false, message: '学生不存在' })
    }

    // 权限检查：学校负责人可以修改所有学生，普通教师只能修改自己的学生
    const currentUser = await prisma.user.findUnique({ where: { id: userId } })
    const isPrincipal = currentUser?.role === 'school_principal'

    if (!isPrincipal && teacher && existingStudent.headTeacherId && existingStudent.headTeacherId !== teacher.id) {
      return res.status(403).json({ success: false, message: '只有主教练可以修改该学生的信息' })
    }

    // 确保 schoolId 不为空（学生必须关联学校）
    // 如果传了 schoolId，使用传入的；否则保留原值
    let finalSchoolId = existingStudent.schoolId
    if (schoolId !== undefined && schoolId !== null && schoolId !== '') {
      finalSchoolId = schoolId
    }
    // 验证最终的 schoolId 有效
    if (!finalSchoolId) {
      return res.status(400).json({ success: false, message: '学生必须关联学校' })
    }
    const school = await prisma.school.findUnique({ where: { id: finalSchoolId }, select: { organizationId: true } })
    const organizationId = school?.organizationId
    if (!organizationId) {
      return res.status(400).json({ success: false, message: '学校尚未完成身份空间初始化，暂时无法更新学生' })
    }

    // 使用事务更新学生及相关数据，确保原子性
    logger.info('student_update_password_field_received', { action: 'student_update', metadata: { passwordProvided: !!password, passwordLength: password?.length || 0 } })
    const student = await prisma.$transaction(async (tx) => {
      // 更新学生的 User 关联信息（Student.id = User.id，所以直接用 student.id）
      const userUpdateData: any = {
        avatar,
        phone: req.body.phone,
        email: req.body.email
      }

      // 如果提供了新密码，则更新密码
      if (password && password.length >= 6) {
        logger.info('student_update_hashing_password', { action: 'student_update', metadata: { userId: existingStudent.id } })
        userUpdateData.passwordHash = await bcrypt.hash(password, 10)
      }

      await tx.user.update({
        where: { id: existingStudent.id },
        data: { ...userUpdateData, schoolId: finalSchoolId }
      })

      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId, userId: existingStudent.id } },
        create: {
          id: crypto.randomUUID(),
          organizationId,
          userId: existingStudent.id,
          memberRole: 'student',
          relationType: 'enrolled',
          status: 'active',
          joinedAt: new Date()
        },
        update: {
          memberRole: 'student',
          relationType: 'enrolled',
          status: 'active',
          joinedAt: new Date()
        }
      })
      const membership = await tx.organizationMembership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: existingStudent.id } },
        select: { id: true }
      })
      await tx.organizationStudentProfile.upsert({
        where: { membershipId: membership.id },
        create: { id: crypto.randomUUID(), membershipId: membership.id, name: name || existingStudent.name, gender, enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null, targetContest, tags: tags ? JSON.stringify(tags) : null, notes, avatar, rating: rating ? Number(rating) : 1200, status: 'active' },
        update: { name: name || existingStudent.name, gender, enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null, targetContest, tags: tags ? JSON.stringify(tags) : null, notes, avatar, ...(rating ? { rating: Number(rating) } : {}) }
      })

      // 更新学生
      return await tx.student.update({
        where: { id },
        data: {
          name,
          gender,
          schoolId: finalSchoolId,
          enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null,
          targetContest,
          headTeacherId,
          tags: tags ? JSON.stringify(tags) : null,
          notes,
          avatar,
          rating: rating ? Number(rating) : undefined
        }
      })
    })

    res.json({ success: true, data: student })
}, '服务器错误'))

// 删除学生 (老师) - 同时删除关联的 User 记录
studentRouter.delete('/:id', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
    const { id } = req.params

    // 资源级权限检查
    if (!await canManageStudent(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限删除该学生' })
    }

    // 获取学生信息，找到关联的 userId
    const student = await prisma.student.findUnique({ where: { id }, select: { id: true } })
    if (!student) {
      return res.status(404).json({ success: false, message: '学生不存在' })
    }

    // 在删除学生前，处理其作为团队所有者的情况
    await handleStudentOwnerDeletion(id)

    // 使用事务：先删 Student，再删关联的 User（Student.id = User.id）
    await prisma.$transaction(async (tx) => {
      await tx.student.delete({ where: { id } })
      await tx.user.delete({ where: { id: student.id } })
    })
    res.json({ success: true, message: '删除成功' })
}, '服务器错误'))

// 禁用/启用学生账号 (老师)
studentRouter.put('/:id/account-status', authenticate, authorize('teacher', 'school_principal'), asyncHandler(async (req, res) => {
    const { id } = req.params
    const { status } = req.body // 'disabled' | 'active'

    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' })
    }

    // 资源级权限检查
    if (!await canManageStudent(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限操作该学生' })
    }

    const student = await prisma.student.findUnique({
      where: { id },
      select: { id: true }
    })
    if (!student) {
      return res.status(404).json({ success: false, message: '学生不存在' })
    }

    await prisma.user.update({
      where: { id: student.id },
      data: { status }
    })

    res.json({ success: true, message: status === 'disabled' ? '账号已禁用' : '账号已启用' })
}, '服务器错误'))

// 处理学生作为所有者被删除时的团队所有权转移
async function handleStudentOwnerDeletion(studentId: string) {
  // 查找该学生作为所有者的所有团队
  const ownedTeams = await prisma.teamMember.findMany({
    where: { userId: studentId, userType: 'student', role: 'owner' },
    include: { Team: true }
  })

  for (const ownerMember of ownedTeams) {
    const teamId = ownerMember.teamId

    // 获取团队其他成员（按优先级排序）
    const members = await prisma.teamMember.findMany({
      where: {
        teamId,
        status: 'active',
        id: { not: ownerMember.id }
      },
      orderBy: [
        { role: 'asc' },      // admin < member
        { userType: 'asc' }   // teacher < student
      ]
    })

    // 优先级：教师管理员 > 学生管理员 > 教师成员 > 学生成员
    const teacherAdmin = members.find(m => m.userType === 'teacher' && m.role === 'admin')
    const studentAdmin = members.find(m => m.userType === 'student' && m.role === 'admin')
    const teacherMember = members.find(m => m.userType === 'teacher' && m.role === 'member')
    const studentMember = members.find(m => m.userType === 'student' && m.role === 'member')

    const newOwner = teacherAdmin || studentAdmin || teacherMember || studentMember

    if (newOwner) {
      // 转移所有权
      await prisma.$transaction([
        // 将原所有者改为普通成员（或删除）
        prisma.teamMember.update({
          where: { id: ownerMember.id },
          data: { role: 'member' }
        }),
        // 将新所有者设为 owner
        prisma.teamMember.update({
          where: { id: newOwner.id },
          data: { role: 'owner' }
        })
      ])
      logger.info('team_ownership_transferred_to_teacher', { action: 'team_transfer', metadata: { teamName: ownerMember.Team.name, newOwnerType: newOwner.userType } })
    } else {
      // 团队无其他成员，解散团队
      await prisma.team.delete({ where: { id: teamId } })
      logger.info('team_dissolved', { action: 'team_transfer', metadata: { teamName: ownerMember.Team.name, reason: 'no_other_members' } })
    }
  }
}
