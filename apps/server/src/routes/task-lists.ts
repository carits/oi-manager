import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, authorize } from '../middleware/auth'

export const taskListRouter = Router()

// 获取题单列表
taskListRouter.get('/', authenticate, async (req, res) => {
  try {
    const { page = '1', pageSize = '20' } = req.query

    const where: Record<string, unknown> = {}

    const [taskLists, total] = await Promise.all([
      prisma.taskList.findMany({
        where,
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        include: {
          _count: { select: { tasks: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.taskList.count({ where })
    ])

    res.json({
      success: true,
      data: { list: taskLists, total, page: Number(page), pageSize: Number(pageSize) }
    })
  } catch (error) {
    console.error('Get task lists error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取题单详情
taskListRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const taskList = await prisma.taskList.findUnique({
      where: { id },
      include: {
        tasks: { orderBy: { createdAt: 'asc' } }
      }
    })

    if (!taskList) {
      return res.status(404).json({ success: false, message: '题单不存在' })
    }

    res.json({ success: true, data: taskList })
  } catch (error) {
    console.error('Get task list error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建题单 (老师)
taskListRouter.post('/', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { title, description, publishAt, deadline, tasks } = req.body
    const teacherId = req.user!.userId

    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherId } })

    if (!teacher) {
      return res.status(400).json({ success: false, message: '请先完善老师信息' })
    }

    const taskList = await prisma.taskList.create({
      data: {
        title,
        description,
        publishAt: publishAt ? new Date(publishAt) : null,
        deadline: deadline ? new Date(deadline) : null,
        createdBy: teacher.id,
        tasks: tasks ? {
          create: tasks.map((t: { title: string; ojName?: string; problemId?: string; difficulty?: string; points?: number }) => ({
            title: t.title,
            ojName: t.ojName,
            problemId: t.problemId,
            difficulty: t.difficulty,
            points: t.points
          }))
        } : undefined
      },
      include: { tasks: true }
    })

    res.json({ success: true, data: taskList })
  } catch (error) {
    console.error('Create task list error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新题单
taskListRouter.put('/:id', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, publishAt, deadline } = req.body

    const taskList = await prisma.taskList.update({
      where: { id },
      data: {
        title,
        description,
        publishAt: publishAt ? new Date(publishAt) : null,
        deadline: deadline ? new Date(deadline) : null
      }
    })

    res.json({ success: true, data: taskList })
  } catch (error) {
    console.error('Update task list error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除题单
taskListRouter.delete('/:id', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    await prisma.taskList.delete({ where: { id } })
    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete task list error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
