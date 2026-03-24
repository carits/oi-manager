import { Router } from 'express'
import { prisma } from '../prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

export const contestNotesRouter = Router()

// 获取学生对某道题的思路记录
contestNotesRouter.get('/:contestId/problems/:problemId/note', authenticate, async (req, res) => {
  try {
    const { contestId, problemId } = req.params
    const user = (req as AuthRequest).user

    // 只有学生可以获取思路记录
    if (user.role !== 'student') {
      return res.status(403).json({ success: false, message: '只有学生可以获取思路记录' })
    }

    // 获取学生信息
    const student = await prisma.student.findUnique({
      where: { userId: user.userId }
    })

    if (!student) {
      return res.status(404).json({ success: false, message: '学生信息不存在' })
    }

    // 查找思路记录
    const note = await prisma.contestProblemNote.findUnique({
      where: {
        contestId_problemId_studentId: {
          contestId,
          problemId,
          studentId: student.id
        }
      }
    })

    res.json({
      success: true,
      data: note || { content: '' }
    })
  } catch (error) {
    console.error('Get contest note error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 保存学生对某道题的思路记录
contestNotesRouter.put('/:contestId/problems/:problemId/note', authenticate, async (req, res) => {
  try {
    const { contestId, problemId } = req.params
    const { content } = req.body
    const user = (req as AuthRequest).user

    // 只有学生可以保存思路记录
    if (user.role !== 'student') {
      return res.status(403).json({ success: false, message: '只有学生可以保存思路记录' })
    }

    // 获取学生信息
    const student = await prisma.student.findUnique({
      where: { userId: user.userId }
    })

    if (!student) {
      return res.status(404).json({ success: false, message: '学生信息不存在' })
    }

    // 验证题目是否存在
    const problem = await prisma.contestProblem.findFirst({
      where: {
        id: problemId,
        contestId
      }
    })

    if (!problem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 使用 upsert 创建或更新
    const note = await prisma.contestProblemNote.upsert({
      where: {
        contestId_problemId_studentId: {
          contestId,
          problemId,
          studentId: student.id
        }
      },
      update: {
        content: content || ''
      },
      create: {
        contestId,
        problemId,
        studentId: student.id,
        content: content || ''
      }
    })

    res.json({
      success: true,
      data: note,
      message: '保存成功'
    })
  } catch (error) {
    console.error('Save contest note error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
