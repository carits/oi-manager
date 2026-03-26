import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../prisma'
import { authenticate, authorize } from '../middleware/auth'
import { canViewStudent, canManageStudent, getUserSchoolId } from '../middleware/permissions'
import { generateTempPassword, hashPassword } from '../utils/password'

export const studentRouter = Router()

// 获取学生列表 (老师、学校负责人和管理员)
// 性能优化：使用数据库级分页和排序，避免全量查询后在内存中处理
studentRouter.get('/', authenticate, async (req, res) => {
  try {
    const { headTeacherId, teamId, schoolId, username, page = '1', pageSize = '20' } = req.query

    // 获取当前登录教师信息
    const userId = req.user!.userId
    const currentUser = await prisma.user.findUnique({ where: { id: userId } })
    const currentTeacher = await prisma.teacher.findUnique({ where: { userId } })
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
    if (username) {
      where.User = {
        username: { contains: username as string }
      }
    }

    const pageNum = Number(page)
    const pageSizeNum = Number(pageSize)

    // 获取总数
    const total = await prisma.student.count({ where })

    // 性能优化：使用数据库级分页和排序
    // 排序规则：按入学年份降序（年级低的在前）
    // 注意："主教练优先"的特殊排序已移除，改为统一的数据库级排序
    // 如果需要保持"主教练优先"语义，可考虑在前端处理或使用更复杂的查询
    const students = await prisma.student.findMany({
      where,
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
      orderBy: [
        { enrollmentYear: 'desc' }
      ],
      include: {
        School: {
          select: {
            id: true,
            name: true,
            educationSystem: true,
            schoolType: true
          }
        },
        Teacher: { select: { id: true, name: true } },
        User: { select: { username: true, phone: true, email: true, avatar: true } }
      }
    })

    // 转换字段名为前端期望的格式，移除 Prisma 大写关联字段
    const formattedStudents = students.map(student => {
      const { User, Teacher, School, ...rest } = student
      return {
        ...rest,
        user: User ? {
          username: User.username,
          phone: User.phone,
          email: User.email,
          avatar: User.avatar
        } : null,
        school: School ? {
          id: School.id,
          name: School.name,
          educationSystem: School.educationSystem,
          schoolType: School.schoolType
        } : null,
        headTeacher: Teacher ? {
          id: Teacher.id,
          name: Teacher.name
        } : null
      }
    })

    res.json({
      success: true,
      data: {
        list: formattedStudents,
        total,
        page: pageNum,
        pageSize: pageSizeNum
      }
    })
  } catch (error) {
    console.error('Get students error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学生 rating 排名 (老师)
// 性能优化：使用数据库级排序，优化最近成绩变化的获取方式
studentRouter.get('/rankings', authenticate, authorize('teacher', 'school_principal'), async (req, res) => {
  try {
    // 获取当前用户的学校 ID，限制只返回本校学生
    const schoolId = await getUserSchoolId(req.user!.userId)

    // 构建查询条件：超管和平台管理员可看所有，其他角色限本校
    const role = req.user!.role
    const whereClause = (role === 'super_admin' || role === 'platform_admin')
      ? {}
      : { schoolId }

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
        OR: latestResults.map(r => ({
          studentId: r.studentId,
          createdAt: r._max.createdAt
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
  } catch (error) {
    console.error('Get rankings error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学生详情 - 支持通过 id 或 userId 查询
studentRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params

    // 先查询学生基本信息（用于权限检查）
    const studentBasic = await prisma.student.findFirst({
      where: {
        OR: [
          { id },
          { userId: id }
        ]
      },
      select: { id: true, userId: true }
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
        Team: { select: { id: true, name: true } },
        User: { select: { username: true, phone: true, email: true, avatar: true, bio: true } },
        Milestone: { orderBy: { milestoneDate: 'desc' } },
        ContestResult: { include: { Contest: true }, orderBy: { Contest: { contestDate: 'desc' } } }
      }
    })

    if (!student) {
      return res.status(404).json({ success: false, message: '学生不存在' })
    }

    res.json({ success: true, data: student })
  } catch (error) {
    console.error('Get student error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建学生 (老师)
studentRouter.post('/', authenticate, authorize('teacher', 'school_principal'), async (req, res) => {
  try {
    const { name, gender, schoolId, enrollmentYear, targetContest, headTeacherId, tags, notes, username, phone, email, avatar } = req.body

    // 验证必填字段：用户名
    if (!username) {
      return res.status(400).json({ success: false, message: '用户名为必填项' })
    }

    // 获取当前登录老师的信息
    const userId = req.user!.userId
    const teacher = await prisma.teacher.findUnique({ where: { userId } })

    // 确定 schoolId：优先使用传入的，否则使用当前教师的学校
    const finalSchoolId = schoolId || teacher?.schoolId
    if (!finalSchoolId) {
      return res.status(400).json({ success: false, message: '学生必须关联学校，请确保您已归属学校' })
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

      const newUser = await tx.user.create({
        data: {
          username,
          passwordHash: hashedPassword,
          role: 'student',
          phone,
          email,
          avatar
        }
      })

      // 创建学生
      return await tx.student.create({
        data: {
          name,
          gender,
          schoolId: finalSchoolId,
          enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null,
          targetContest,
          headTeacherId: finalHeadTeacherId,
          tags: tags ? JSON.stringify(tags) : null,
          notes,
          userId: newUser.id
        }
      })
    })

    res.json({ success: true, data: student })
  } catch (error) {
    if (error instanceof Error && error.message === 'USERNAME_EXISTS') {
      return res.status(400).json({ success: false, message: '用户名已存在' })
    }
    console.error('Create student error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新学生 (老师)
studentRouter.put('/:id', authenticate, authorize('teacher', 'school_principal'), async (req, res) => {
  try {
    const { id } = req.params
    const { name, gender, schoolId, enrollmentYear, targetContest, headTeacherId, tags, notes, avatar, rating } = req.body

    // 获取当前登录老师的信息
    const userId = req.user!.userId
    const teacher = await prisma.teacher.findUnique({ where: { userId } })

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

    // 使用事务更新学生及相关数据，确保原子性
    const student = await prisma.$transaction(async (tx) => {
      // 更新学生的 User 关联信息（如果存在）
      if (existingStudent.userId) {
        await tx.user.update({
          where: { id: existingStudent.userId },
          data: {
            avatar,
            phone: req.body.phone,
            email: req.body.email
          }
        })
      }

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
  } catch (error) {
    console.error('Update student error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除学生 (老师)
studentRouter.delete('/:id', authenticate, authorize('teacher', 'school_principal'), async (req, res) => {
  try {
    const { id } = req.params

    // 资源级权限检查
    if (!await canManageStudent(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限删除该学生' })
    }

    // 在删除学生前，处理其作为团队所有者的情况
    await handleStudentOwnerDeletion(id)

    await prisma.student.delete({ where: { id } })
    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete student error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

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
      console.log(`团队 ${ownerMember.Team.name} 所有权已从学生转移到 ${newOwner.userType === 'teacher' ? '教师' : '学生'}`)
    } else {
      // 团队无其他成员，解散团队
      await prisma.team.delete({ where: { id: teamId } })
      console.log(`团队 ${ownerMember.Team.name} 已解散（无其他成员）`)
    }
  }
}
