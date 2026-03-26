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
      activeUsers,
      disabledUsers,
      recentRegistrations
    ] = await Promise.all([
      prisma.school.count(),
      prisma.teacher.count(),
      prisma.student.count(),
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
            Team: true,
            Teacher: true,
            Student: true
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
      teamCount: school._count.Team,
      teacherCount: school._count.Teacher,
      studentCount: school._count.Student,
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
