import crypto from 'crypto'
import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, authorize } from '../middleware/auth'
import { parsePagination, paginatedResponse } from '../lib/pagination'

export const milestoneRouter = Router()

// 获取里程碑列表
milestoneRouter.get('/', authenticate, async (req, res) => {
  try {
    const { studentId } = req.query
    const { page, pageSize, skip } = parsePagination(req.query)

    const where: Record<string, unknown> = {}
    if (studentId) where.studentId = studentId as string

    const [milestones, total] = await Promise.all([
      prisma.milestone.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          Student: true,
          Teacher: { include: { User: true } }
        },
        orderBy: { milestoneDate: 'desc' }
      }),
      prisma.milestone.count({ where })
    ])

    res.json({
      success: true,
      data: paginatedResponse(milestones, total, page, pageSize)
    })
  } catch (error) {
    console.error('Get milestones error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取里程碑详情
milestoneRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const milestone = await prisma.milestone.findUnique({
      where: { id },
      include: {
        Student: true,
        Teacher: { include: { User: true } }
      }
    })

    if (!milestone) {
      return res.status(404).json({ success: false, message: '里程碑不存在' })
    }

    res.json({ success: true, data: milestone })
  } catch (error) {
    console.error('Get milestone error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建里程碑 (老师)
milestoneRouter.post('/', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { studentId, title, description, milestoneDate, type } = req.body
    const teacherId = req.user!.userId

    const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } })

    if (!teacher) {
      return res.status(400).json({ success: false, message: '请先完善老师信息' })
    }

    const milestone = await prisma.milestone.create({
      data: {
        id: crypto.randomUUID(),
        studentId,
        teacherId: teacher.id,
        title,
        description,
        milestoneDate: new Date(milestoneDate),
        type
      }
    })

    res.json({ success: true, data: milestone })
  } catch (error) {
    console.error('Create milestone error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新里程碑
milestoneRouter.put('/:id', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, milestoneDate, type } = req.body

    const milestone = await prisma.milestone.update({
      where: { id },
      data: {
        title,
        description,
        milestoneDate: new Date(milestoneDate),
        type
      }
    })

    res.json({ success: true, data: milestone })
  } catch (error) {
    console.error('Update milestone error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除里程碑
milestoneRouter.delete('/:id', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    await prisma.milestone.delete({ where: { id } })
    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete milestone error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
