/**
 * School Stats Routes
 * 学校统计路由
 */

import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../../middleware/auth.js'
import { prisma } from '../../prisma.js'
import { canAccessSchool } from '../../middleware/permissions.js'
import { asyncHandler } from '../../lib/asyncHandler'
import { calculateGrade } from '@oi-manager/shared/utils/grade'

export const schoolStatsRouter = Router()

// ==================== 获取学校统计数据 ====================
schoolStatsRouter.get('/:id/stats', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

    // 资源级权限检查：只有本校用户可以查看
    if (!await canAccessSchool(req, id)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的统计数据' })
    }

    // 获取学校信息（包含学制和学校类型）
    const school = await prisma.school.findUnique({
      where: { id },
      select: { educationSystem: true, educationSystemDetail: true, schoolType: true }
    })

    if (!school) {
      return res.status(404).json({ success: false, message: '学校不存在' })
    }

    const [students, teacherCount, teamCount, ongoingContestCount] = await Promise.all([
      prisma.student.findMany({
      where: { schoolId: id },
      select: {
        rating: true,
        enrollmentYear: true
      }
      }),
      prisma.teacher.count({ where: { schoolId: id, status: 'active' } }),
      prisma.team.count({ where: { schoolId: id } }),
      prisma.training.count({ where: { schoolId: id, type: 'contest', startTime: { lte: new Date() }, endTime: { gte: new Date() } } })
    ])

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
        educationSystemDetail: school.educationSystemDetail as { primaryYears?: number; middleYears?: number; highYears?: number } | null,
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
        teacherCount,
        teamCount,
        ongoingContestCount,
        gradeDistribution,
        schoolType: school.schoolType,
        educationSystem: school.educationSystem
      }
    })
}))
