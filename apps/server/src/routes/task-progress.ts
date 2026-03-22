import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, authorize } from '../middleware/auth'

export const taskProgressRouter = Router()

// 获取学生在某个题单的进度
taskProgressRouter.get('/', authenticate, async (req, res) => {
  try {
    const { taskListId, studentId } = req.query

    if (!studentId) {
      return res.status(400).json({ success: false, message: '缺少学生ID' })
    }

    // 获取题单下的所有题目
    const taskList = await prisma.taskList.findUnique({
      where: { id: taskListId as string },
      include: {
        tasks: {
          include: {
            progresses: {
              where: { studentId: studentId as string }
            }
          }
        }
      }
    })

    if (!taskList) {
      return res.status(404).json({ success: false, message: '题单不存在' })
    }

    // 计算完成情况
    const totalTasks = taskList.tasks.length
    const completedTasks = taskList.tasks.filter(t =>
      t.progresses.some(p => p.status === 'done')
    ).length
    const reviewingTasks = taskList.tasks.filter(t =>
      t.progresses.some(p => p.status === 'review')
    ).length

    res.json({
      success: true,
      data: {
        taskListId,
        totalTasks,
        completedTasks,
        reviewingTasks,
        tasks: taskList.tasks.map(t => ({
          id: t.id,
          title: t.title,
          ojName: t.ojName,
          problemId: t.problemId,
          difficulty: t.difficulty,
          points: t.points,
          progress: t.progresses[0] || null
        }))
      }
    })
  } catch (error) {
    console.error('Get task progress error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新题目进度
taskProgressRouter.put('/', authenticate, async (req, res) => {
  try {
    const { taskId, studentId, status, seenEditorial, needHelp, notes } = req.body

    if (!taskId || !studentId) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    const progress = await prisma.taskProgress.upsert({
      where: {
        taskId_studentId: {
          taskId,
          studentId
        }
      },
      create: {
        taskId,
        studentId,
        status: status || 'pending',
        seenEditorial: seenEditorial || false,
        needHelp: needHelp || false,
        notes,
        completedAt: status === 'done' ? new Date() : null
      },
      update: {
        status,
        seenEditorial,
        needHelp,
        notes,
        completedAt: status === 'done' ? new Date() : null
      }
    })

    res.json({ success: true, data: progress })
  } catch (error) {
    console.error('Update task progress error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 老师查看学生题单完成情况
taskProgressRouter.get('/class/:taskListId', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { taskListId } = req.params

    // 获取题单
    const taskList = await prisma.taskList.findUnique({
      where: { id: taskListId },
      include: {
        tasks: true
      }
    })

    if (!taskList) {
      return res.status(404).json({ success: false, message: '题单不存在' })
    }

    // 获取所有学生
    const students = await prisma.student.findMany({
      include: {
        taskProgresses: {
          where: {
            taskId: { in: taskList.tasks.map(t => t.id) }
          }
        }
      }
    })

    // 计算每个学生的进度
    const result = students.map(student => {
      const totalTasks = taskList.tasks.length
      const completedTasks = student.taskProgresses.filter(p => p.status === 'done').length
      const reviewingTasks = student.taskProgresses.filter(p => p.status === 'review').length
      const needHelpCount = student.taskProgresses.filter(p => p.needHelp).length

      return {
        studentId: student.id,
        studentName: student.name,
        totalTasks,
        completedTasks,
        reviewingTasks,
        needHelpCount,
        progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
      }
    })

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Get class progress error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
