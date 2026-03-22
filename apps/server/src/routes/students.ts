import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, authorize } from '../middleware/auth'

export const studentRouter = Router()

// 获取学生列表 (老师、学校负责人和管理员)
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
      where.user = {
        username: { contains: username as string }
      }
    }

    // 获取总数
    const total = await prisma.student.count({ where })

    // 获取所有符合条件的学生，然后在内存中排序
    // 排序规则：1. 主教练优先显示自己的学生 2. 按入学年份降序（年级低的在前）
    const allStudents = await prisma.student.findMany({
      where,
      include: {
        school: {
          select: {
            id: true,
            name: true,
            educationSystem: true,
            schoolType: true
          }
        },
        headTeacher: { select: { id: true, name: true } },
        user: { select: { username: true, phone: true, email: true, avatar: true } }
      }
    })

    // 在内存中排序
    const sortedStudents = allStudents.sort((a, b) => {
      // 1. 主教练优先显示自己的学生
      const aIsMyStudent = a.headTeacherId === currentTeacherId
      const bIsMyStudent = b.headTeacherId === currentTeacherId

      if (aIsMyStudent && !bIsMyStudent) return -1
      if (!aIsMyStudent && bIsMyStudent) return 1

      // 2. 按入学年份降序（入学年份大的在前，即年级低的在前）
      const aYear = a.enrollmentYear || 0
      const bYear = b.enrollmentYear || 0
      return bYear - aYear
    })

    // 手动分页
    const pageNum = Number(page)
    const pageSizeNum = Number(pageSize)
    const startIndex = (pageNum - 1) * pageSizeNum
    const students = sortedStudents.slice(startIndex, startIndex + pageSizeNum)

    res.json({
      success: true,
      data: {
        list: students,
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
studentRouter.get('/rankings', authenticate, authorize('teacher', 'school_principal'), async (req, res) => {
  try {
    // 获取所有学生的最新 rating 和用户信息
    const students = await prisma.student.findMany({
      include: {
        user: { select: { username: true, avatar: true } },
        contestResults: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    // 按 rating 排序
    const rankings = students
      .map(s => ({
        id: s.id,
        name: s.name,
        rating: s.rating || 1200,
        avatar: s.user?.avatar,
        username: s.user?.username,
        lastRatingChange: s.contestResults[0]?.ratingChange || 0
      }))
      .sort((a, b) => b.rating - a.rating)
      .map((s, i) => ({ ...s, rank: i + 1 }))

    // 计算涨分榜和掉分榜
    const gainers = [...rankings].filter(s => s.lastRatingChange > 0).sort((a, b) => b.lastRatingChange - a.lastRatingChange).slice(0, 5)
    const losers = [...rankings].filter(s => s.lastRatingChange < 0).sort((a, b) => a.lastRatingChange - b.lastRatingChange).slice(0, 5)

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

    // 判断是通过 userId 查询还是通过 student id 查询
    const student = await prisma.student.findFirst({
      where: {
        OR: [
          { id },
          { userId: id }
        ]
      },
      include: {
        school: { select: { id: true, name: true } },
        headTeacher: { select: { id: true, name: true, title: true } },
        team: { select: { id: true, name: true, leader: { select: { name: true } } } },
        user: { select: { username: true, phone: true, email: true, avatar: true, bio: true } },
        milestones: { orderBy: { milestoneDate: 'desc' } },
        contestResults: { include: { contest: true }, orderBy: { contest: { contestDate: 'desc' } } }
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

    // 获取当前登录老师的信息
    const userId = req.user!.userId
    const teacher = await prisma.teacher.findUnique({ where: { userId } })

    // 确定 schoolId：优先使用传入的，否则使用当前教师的学校
    const finalSchoolId = schoolId || teacher?.schoolId
    if (!finalSchoolId) {
      return res.status(400).json({ success: false, message: '学生必须关联学校，请确保您已归属学校' })
    }

    // 如果提供了用户名，创建关联的User
    let userIdLink = null
    if (username) {
      // 检查用户名是否已存在
      const existingUser = await prisma.user.findUnique({ where: { username } })
      if (existingUser) {
        return res.status(400).json({ success: false, message: '用户名已存在' })
      }

      const newUser = await prisma.user.create({
        data: {
          username,
          passwordHash: 'default', // 临时密码
          role: 'student',
          phone,
          email,
          avatar
        }
      })
      userIdLink = newUser.id
    }

    // 如果没有指定主教练，使用当前登录的老师
    const finalHeadTeacherId = headTeacherId || teacher?.id

    const student = await prisma.student.create({
      data: {
        name,
        gender,
        schoolId: finalSchoolId,
        enrollmentYear: enrollmentYear ? Number(enrollmentYear) : null,
        targetContest,
        headTeacherId: finalHeadTeacherId,
        tags: tags ? JSON.stringify(tags) : null,
        notes,
        userId: userIdLink
      }
    })

    res.json({ success: true, data: student })
  } catch (error) {
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
      include: { user: true }
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

    // 更新学生的User关联信息（如果存在）
    if (existingStudent.userId) {
      await prisma.user.update({
        where: { id: existingStudent.userId },
        data: {
          avatar,
          phone: req.body.phone,
          email: req.body.email
        }
      })
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

    const student = await prisma.student.update({
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
    include: { team: true }
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
      console.log(`团队 ${ownerMember.team.name} 所有权已从学生转移到 ${newOwner.userType === 'teacher' ? '教师' : '学生'}`)
    } else {
      // 团队无其他成员，解散团队
      await prisma.team.delete({ where: { id: teamId } })
      console.log(`团队 ${ownerMember.team.name} 已解散（无其他成员）`)
    }
  }
}
