/**
 * Team CRUD Routes
 * 团队 CRUD 路由（列表、详情、创建、更新、删除）
 */

import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate } from '../../middleware/auth'
import { canAccessSchool, canViewStudent } from '../../middleware/permissions'
import { teamService } from './team.service'
import { teamRepository } from './team.repository'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination } from '../../lib/pagination'
import { validate, validateParams, validateBody } from '../../lib/zodValidate'
import {
  createTeamSchema,
  updateTeamSchema,
  transferTeamSchema,
  teamIdSchema,
  teamListQuerySchema
} from './schemas/team.schemas'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { prisma } from '../../prisma'
import { fileService } from '../../lib/storage'
import { STORAGE_ROOT } from '../../config/storage'
import logger from '../../lib/logger'
import { z } from 'zod'

export const teamCrudRouter = Router()

// ==================== Multer 配置 ====================

const tempAvatarDir = path.join(STORAGE_ROOT, 'temp/uploads')
if (!fs.existsSync(tempAvatarDir)) {
  fs.mkdirSync(tempAvatarDir, { recursive: true })
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempAvatarDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
    const mimetype = allowedTypes.test(file.mimetype)
    if (extname && mimetype) {
      cb(null, true)
    } else {
      cb(new Error('只支持图片文件'))
    }
  }
})

// ==================== 错误处理工具 ====================

function handleError(res: Response, error: unknown, defaultMessage: string = '服务器错误') {
  if (error instanceof Error) {
    const errorMessages: Record<string, { status: number; message: string }> = {
      'TEAM_NOT_FOUND': { status: 404, message: '团队不存在' },
      'OWNER_NOT_FOUND': { status: 400, message: '团队所有者不存在' },
      'NOT_OWNER': { status: 403, message: '只有团队所有者可以执行此操作' },
      'NOT_ADMIN': { status: 403, message: '只有团队所有者或管理员可以执行此操作' },
      'NOT_MEMBER': { status: 403, message: '您没有权限查看该团队' },
      'NEW_OWNER_NOT_FOUND': { status: 404, message: '新所有者不存在' },
      'NEW_OWNER_NOT_SAME_SCHOOL': { status: 400, message: '新所有者必须是本校成员' },
      'NEW_OWNER_LIMIT_EXCEEDED': { status: 400, message: '新所有者创建的团队数量已达上限' },
      'NEW_OWNER_NOT_MEMBER': { status: 400, message: '新所有者必须是团队成员' },
      'TEAM_LIMIT_EXCEEDED': { status: 400, message: '您创建的团队数量已达上限' },
      'HAS_OTHER_MEMBERS': { status: 400, message: '团队中还有其他成员，无法操作' },
      'USER_NOT_FOUND': { status: 401, message: '用户不存在' },
      'NOT_TEACHER_OR_STUDENT': { status: 403, message: '只有教师或学生可以创建团队' },
      'NO_SCHOOL': { status: 400, message: '您尚未归属任何学校' },
      'IDENTITY_NOT_FOUND': { status: 400, message: '无法识别用户身份' },
    }
    const errorInfo = errorMessages[error.message]
    if (errorInfo) {
      return res.status(errorInfo.status).json({ success: false, message: errorInfo.message })
    }
  }
  logger.error('team_route_error', error)
  res.status(500).json({ success: false, message: defaultMessage })
}

// ==================== 学校团队列表 ====================

teamCrudRouter.get('/school/:schoolId', authenticate, asyncHandler(async (req, res) => {
  const { schoolId } = req.params
  const user = (req as any).user!

  if (!await canAccessSchool(req as any, schoolId)) {
    return res.status(403).json({ success: false, message: '您没有权限查看该学校的团队列表' })
  }

  const teams = await teamService.getSchoolTeams(schoolId, user)
  res.json({ success: true, data: teams })
}))

// ==================== 学生团队列表 ====================

teamCrudRouter.get('/student/:studentId', authenticate, asyncHandler(async (req, res) => {
  const { studentId } = req.params

  if (!await canViewStudent(req as any, studentId)) {
    return res.status(403).json({ success: false, message: '您没有权限查看该学生的团队信息' })
  }

  const result = await teamService.getStudentTeams(studentId)
  res.json({ success: true, data: result })
}))

// ==================== 团队列表 ====================

teamCrudRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')

  const { schoolId, view } = req.query
  const { page, pageSize, skip } = parsePagination(req.query, { defaultPageSize: 12 })
  const user = (req as any).user!

  const result = await teamService.getTeamList({
    schoolId: schoolId as string,
    page,
    pageSize,
    skip,
    view: view as string,
    user
  })

  res.json({ success: true, data: result })
}))

// ==================== 校验团队ID唯一性 ====================

teamCrudRouter.get('/check-team-id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.json({ valid: false, message: '请输入团队ID' })
  }
  if (!/^[a-zA-Z0-9_]+$/.test(id as string)) {
    return res.json({ valid: false, message: '团队ID只能包含英文字母、数字和下划线' })
  }
  if ((id as string).length < 2) {
    return res.json({ valid: false, message: '团队ID至少2个字符' })
  }
  if ((id as string).length > 50) {
    return res.json({ valid: false, message: '团队ID不能超过50个字符' })
  }
  const existing = await prisma.team.findUnique({ where: { id: id as string } })
  if (existing) {
    return res.json({ valid: false, message: '该团队ID已被使用' })
  }
  res.json({ valid: true })
}))

// ==================== 团队详情 ====================

teamCrudRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const user = (req as any).user!

  const result = await teamService.getTeamDetail(id, user)
  res.json({ success: true, data: result })
}, '团队不存在'))

// ==================== 创建团队 ====================

teamCrudRouter.post('/', authenticate, validateBody(createTeamSchema), asyncHandler(async (req, res) => {
  const validated = (req as any).validated?.body
  const { name, description, isPublic, id } = validated
  const user = (req as any).user!

  try {
    const team = await teamService.createTeam({ name, description, isPublic, id }, user)
    res.json({ success: true, data: team })
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_LIMIT_EXCEEDED') {
      const user = (req as any).user!
      const maxTeams = (user.role === 'teacher' || user.role === 'school_principal') ? 50 : 5
      return res.status(400).json({ success: false, message: `您创建的团队数量已达上限（${maxTeams}个）` })
    }
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta as any)?.target as string[] | undefined
      if (target?.includes('id')) {
        return res.status(400).json({ success: false, message: '该团队ID已被使用' })
      }
    }
    handleError(res, error)
  }
}))

// ==================== 更新团队 ====================

teamCrudRouter.put('/:id', authenticate, validateBody(updateTeamSchema), asyncHandler(async (req, res) => {
  const { id } = req.params
  const validated = (req as any).validated?.body
  const { name, description, isPublic } = validated
  const user = (req as any).user!

  const result = await teamService.updateTeam(id, { name, description, isPublic }, user)
  res.json({ success: true, data: result })
}))

// ==================== 更新公告 ====================

teamCrudRouter.put('/:id/announcement', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const { announcement } = req.body
  const user = (req as any).user!

  const result = await teamService.updateAnnouncement(id, announcement, user)
  res.json({ success: true, data: result })
}))

// ==================== 上传头像 ====================

teamCrudRouter.post('/:id/avatar', authenticate, avatarUpload.single('avatar'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = (req as any).user!

  if (!req.file) {
    return res.status(400).json({ success: false, message: '请上传图片文件' })
  }

  try {
    const { isOwner } = await teamService.isTeamAdmin(id, user)
    if (!isOwner) {
      fs.unlinkSync(req.file.path)
      return res.status(403).json({ success: false, message: '只有团队所有者可以上传头像' })
    }

    const result = await fileService.uploadFromMulter(req.file, {
      category: 'avatar',
      ownerType: 'team',
      ownerId: id,
      isPublic: true
    })

    const avatarUrl = `/api/files/${result.id}/public`
    await teamRepository.update(id, { avatar: avatarUrl })

    logger.audit('team_avatar_uploaded', {
      userId: user.userId,
      action: 'upload_team_avatar',
      target: id,
      metadata: { fileId: result.id, originalName: result.originalName }
    })

    res.json({ success: true, data: { avatar: avatarUrl, fileId: result.id } })
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    handleError(res, error)
  }
}))

// ==================== 转移团队 ====================

teamCrudRouter.post('/:id/transfer', authenticate, validateBody(transferTeamSchema), asyncHandler(async (req, res) => {
  const { id } = req.params
  const validated = (req as any).validated?.body
  const { newOwnerId, newOwnerType } = validated
  const user = (req as any).user!

  try {
    await teamService.transferTeam(id, { newOwnerId, newOwnerType }, user)
    res.json({ success: true, message: '所有权转移成功' })
  } catch (error) {
    if (error instanceof Error) {
      const errorMessages: Record<string, { status: number; message: string }> = {
        'TEAM_NOT_FOUND': { status: 404, message: '团队不存在' },
        'OWNER_NOT_FOUND': { status: 400, message: '团队所有者不存在' },
        'NOT_OWNER': { status: 403, message: '只有团队所有者可以转移所有权' },
        'NEW_OWNER_NOT_FOUND': { status: 404, message: `${req.body.newOwnerType === 'teacher' ? '教师' : '学生'}不存在` },
        'NEW_OWNER_NOT_SAME_SCHOOL': { status: 400, message: `新所有者必须是本校${req.body.newOwnerType === 'teacher' ? '教师' : '学生'}` },
        'NEW_OWNER_LIMIT_EXCEEDED': { status: 400, message: `该${req.body.newOwnerType === 'teacher' ? '教师' : '学生'}创建的团队数量已达上限（${req.body.newOwnerType === 'teacher' ? 50 : 5}个），无法转移` },
        'NEW_OWNER_NOT_MEMBER': { status: 400, message: '新所有者必须是团队成员' }
      }
      const errorInfo = errorMessages[error.message]
      if (errorInfo) {
        return res.status(errorInfo.status).json({ success: false, message: errorInfo.message })
      }
    }
    handleError(res, error, '服务器错误: ' + (error instanceof Error ? error.message : String(error)))
  }
}))

// ==================== 删除团队 ====================

teamCrudRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const user = (req as any).user!

  try {
    await teamService.deleteTeam(id, user)
    res.json({ success: true, message: '团队删除成功' })
  } catch (error) {
    if (error instanceof Error && error.message === 'HAS_OTHER_MEMBERS') {
      return res.status(400).json({
        success: false,
        message: '团队中还有其他成员，无法删除。请先移除所有成员或将团队转让给他人。'
      })
    }
    handleError(res, error)
  }
}))

// ==================== 退出团队 ====================

teamCrudRouter.post('/:id/leave', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const user = (req as any).user!

  try {
    const result = await teamService.leaveTeam(id, user)
    res.json({ success: true, message: result.message })
  } catch (error) {
    if (error instanceof Error && error.message === 'HAS_OTHER_MEMBERS') {
      return res.status(400).json({
        success: false,
        message: '团队中还有其他成员，无法退出。请先移除所有成员或将团队转让给他人。'
      })
    }
    handleError(res, error)
  }
}))