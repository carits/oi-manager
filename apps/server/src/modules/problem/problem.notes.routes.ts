/**
 * Problem Notes Routes
 * 题目思路记录路由
 */

import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { getOwnerInfo } from './problem.helpers'

export const problemNotesRouter = Router()

// ==================== 获取思路记录 ====================
problemNotesRouter.get('/:id/note', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const userId = (req as any).user.userId
    const role = (req as any).user.role

    const ownerInfo = await getOwnerInfo(userId, role)
    if (!ownerInfo) {
      return res.status(403).json({ success: false, message: '用户信息不存在' })
    }

    const userType = role === 'student' ? 'student' : 'teacher'

    let note = await prisma.problemNote.findUnique({
      where: {
        problemId_userId_userType: {
          problemId: id,
          userId: ownerInfo.ownerId,
          userType
        }
      }
    })

    if (!note) {
      note = {
        id: '',
        problemId: id,
        userId: ownerInfo.ownerId,
        userType,
        content: '',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }

    res.json({ success: true, data: note })
}))

// ==================== 保存思路记录 ====================
problemNotesRouter.put('/:id/note', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const userId = (req as any).user.userId
    const role = (req as any).user.role
    const { content } = req.body

    const ownerInfo = await getOwnerInfo(userId, role)
    if (!ownerInfo) {
      return res.status(403).json({ success: false, message: '用户信息不存在' })
    }

    const userType = role === 'student' ? 'student' : 'teacher'

    const note = await prisma.problemNote.upsert({
      where: {
        problemId_userId_userType: {
          problemId: id,
          userId: ownerInfo.ownerId,
          userType
        }
      },
      update: { content: content || '' },
      create: {
        id: uuidv4(),
        problemId: id,
        userId: ownerInfo.ownerId,
        userType,
        content: content || ''
      }
    })

    res.json({ success: true, data: note })
}))