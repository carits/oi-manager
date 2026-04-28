/**
 * School Misc Routes
 * 学校杂项路由：初始化、公告
 */

import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../../middleware/auth.js'
import { prisma } from '../../prisma.js'
import { asyncHandler } from '../../lib/asyncHandler'

export const schoolMiscRouter = Router()

// ==================== 初始化数据（创建默认学校并修复数据） ====================
schoolMiscRouter.post('/init', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    // 1. 创建默认学校
    const defaultSchool = await prisma.school.upsert({
      where: { id: 'default-school' },
      update: {},
      create: {
        id: 'default-school',
        name: '第一中学',
        announcement: '默认学校',
        currentPrincipalTeacherId: 'placeholder'
      }
    })

    // 2. 清理没有 schoolId 的团队（设置为默认学校）
    const teamsWithoutSchool = await prisma.team.findMany({
      where: { schoolId: { equals: undefined } }
    })

    if (teamsWithoutSchool.length > 0) {
      await prisma.team.updateMany({
        where: { schoolId: { equals: undefined } },
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
}))

// ==================== 更新学校公告 ====================
// 仅学校负责人可编辑
schoolMiscRouter.put('/:id/announcement', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { announcement } = req.body

    // 获取当前用户信息
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { Teacher: true }
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
    if (school.currentPrincipalTeacherId !== user.Teacher?.id) {
      return res.status(403).json({ success: false, message: '只有本校负责人可以编辑公告' })
    }

    // 更新公告
    const updated = await prisma.school.update({
      where: { id },
      data: { announcement: announcement || null }
    })

    res.json({ success: true, data: updated })
}))