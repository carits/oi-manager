import { Router, Response } from 'express'
import { authenticate, AuthRequest, isAdmin } from '../middleware/auth.js'
import { prisma } from '../prisma.js'

export const statsRouter = Router()

// 获取全局统计数据（super_admin, platform_admin）
statsRouter.get('/global', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [
      totalSchools,
      totalTeachers,
      totalStudents,
      totalContests,
      totalPublicContests,
      activeUsers,
      disabledUsers,
      recentRegistrations
    ] = await Promise.all([
      prisma.school.count(),
      prisma.teacher.count(),
      prisma.student.count(),
      prisma.contest.count(),
      prisma.contest.count({ where: { scope: 'public' } }),
      prisma.user.count({ where: { status: 'active' } }),
      prisma.user.count({ where: { status: 'disabled' } }),
      prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } })
    ])

    res.json({
      success: true,
      data: {
        totalSchools,
        totalTeachers,
        totalStudents,
        totalContests,
        totalPublicContests,
        activeUsers,
        disabledUsers,
        recentRegistrations
      }
    })
  } catch (error) {
    console.error('Get global stats error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学校统计数据（super_admin, platform_admin）
statsRouter.get('/schools', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    const schools = await prisma.school.findMany({
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

    const schoolStats = schools.map(school => ({
      id: school.id,
      name: school.name,
      region: school.region,
      schoolType: school.schoolType,
      status: school.status,
      teamCount: school._count.teams,
      teacherCount: school._count.teachers,
      studentCount: school._count.students,
      createdAt: school.createdAt.toISOString()
    }))

    res.json({
      success: true,
      data: schoolStats
    })
  } catch (error) {
    console.error('Get school stats error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取比赛统计数据（super_admin, platform_admin）
statsRouter.get('/contests', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    // 按类型统计
    const [trainingCount, mockCount, officialCount] = await Promise.all([
      prisma.contest.count({ where: { type: 'training' } }),
      prisma.contest.count({ where: { type: 'mock' } }),
      prisma.contest.count({ where: { type: 'official' } })
    ])

    // 按状态统计
    const [upcomingCount, ongoingCount, finishedCount] = await Promise.all([
      prisma.contest.count({ where: { status: 'upcoming' } }),
      prisma.contest.count({ where: { status: 'ongoing' } }),
      prisma.contest.count({ where: { status: 'finished' } })
    ])

    // 按范围统计
    const [publicCount, teamCount] = await Promise.all([
      prisma.contest.count({ where: { scope: 'public' } }),
      prisma.contest.count({ where: { scope: 'team' } })
    ])

    // 最近30天创建的比赛
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentContests = await prisma.contest.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    })

    res.json({
      success: true,
      data: {
        byType: {
          training: trainingCount,
          mock: mockCount,
          official: officialCount
        },
        byStatus: {
          upcoming: upcomingCount,
          ongoing: ongoingCount,
          finished: finishedCount
        },
        byScope: {
          public: publicCount,
          team: teamCount
        },
        recentContests
      }
    })
  } catch (error) {
    console.error('Get contest stats error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
