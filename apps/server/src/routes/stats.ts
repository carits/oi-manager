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
      prisma.organization.count({ where: { type: 'school', status: 'active' } }),
      prisma.organizationMembership.count({ where: { status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } }),
      prisma.organizationMembership.count({ where: { status: 'active', memberRole: 'student' } }),
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

    const organizations = await prisma.organization.findMany({
      where: { type: 'school' },
      include: {
        School: { select: { region: true, schoolType: true, status: true } },
        _count: {
          select: {
            Team: true,
            Membership: { where: { status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    const studentCounts = await prisma.organizationMembership.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: organizations.map(org => org.id) }, status: 'active', memberRole: 'student' },
      _count: { _all: true },
    })
    const studentsByOrganization = new Map(studentCounts.map(row => [row.organizationId, row._count._all]))
    res.json({
      success: true,
      data: organizations.map(org => ({
        id: org.id,
        name: org.name,
        region: org.School?.region ?? null,
        schoolType: org.School?.schoolType ?? null,
        status: org.School?.status ?? org.status,
        teamCount: org._count.Team,
        teacherCount: org._count.Membership,
        studentCount: studentsByOrganization.get(org.id) ?? 0,
        createdAt: org.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Get organization stats error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
