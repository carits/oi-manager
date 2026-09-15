/**
 * Team CRUD Routes
 * 团队 CRUD 路由（列表、详情、创建、更新、删除）
 */

import { Router, Request, Response } from 'express'
import { authenticate, isPersonalContextForTeams } from '../../middleware/auth'
import { teamService } from './team.service'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination } from '../../lib/pagination'
import { validateBody } from '../../lib/zodValidate'
import {
  createTeamSchema,
  updateTeamSchema,
  transferTeamSchema,
  teamIdSchema,
  teamListQuerySchema
} from './schemas/team.schemas'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import logger from '../../lib/logger'
import { isTeamIdAvailable, uploadTeamAvatar } from './application/team-route-operations.service'
import { cleanupTeamAvatarTemporaryFile, teamAvatarUpload } from './infrastructure/team-avatar-upload'
import { requestHasOrganizationCapability } from '../authorization/capabilities'
import { TeamContracts } from '@oi-manager/contracts'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'

export const teamCrudRouter = Router()

// ==================== 错误处理工具 ====================

function handleError(res: Response, error: unknown, defaultMessage: string = '服务器错误') {
  if (sendContractError(error, res)) return
  if (error instanceof Error) {
    const errorMessages: Record<string, { status: number; message: string }> = {
      'TEAM_NOT_FOUND': { status: 404, message: '团队不存在' },
      'OWNER_NOT_FOUND': { status: 400, message: '团队所有者不存在' },
      'NOT_OWNER': { status: 403, message: '只有团队所有者可以执行此操作' },
      'NOT_ADMIN': { status: 403, message: '只有团队所有者或管理员可以执行此操作' },
      'NOT_MEMBER': { status: 403, message: '您没有权限查看该团队' },
      'TEAM_SCOPE_MISMATCH': { status: 403, message: '该团队不属于当前使用模式' },
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

teamCrudRouter.get('/organization/:organizationId', authenticate, asyncHandler(async (req, res) => {
  const { organizationId } = req.params
  const user = (req as any).user!

  if (isPersonalContextForTeams(user)) {
    return res.status(403).json({ success: false, message: '个人模式不能访问校园团队' })
  }

  if (user.organizationId !== organizationId) {
    return res.status(403).json({ success: false, message: '您没有权限查看该校园的团队列表' })
  }

  const teams = await teamService.getOrganizationTeams(organizationId, user)
  res.json({ success: true, data: teams })
}))

// 当前身份的团队与待处理邀请。用户 ID 只从会话读取。
teamCrudRouter.get('/mine', authenticate, asyncHandler(async (req, res) => {
  const user = (req as any).user!
  const result = await teamService.getStudentTeams(user.userId, user)
  sendContractData(res, TeamContracts.mine, result)
}))

// ==================== 团队列表 ====================

teamCrudRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')

  const query = parseContractQuery(TeamContracts.list, req.query)
  const { organizationId, view, keyword } = query
  const { page, pageSize, skip } = parsePagination(query, { defaultPageSize: 12 })
  const user = (req as any).user!

  const result = await teamService.getTeamList({
    organizationId: organizationId as string,
    page,
    pageSize,
    skip,
    view: view as string,
    keyword: typeof keyword === 'string' ? keyword : undefined,
    user
  })

  sendContractData(res, TeamContracts.list, result)
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
  if (!await isTeamIdAvailable(id as string)) {
    return res.json({ valid: false, message: '该团队ID已被使用' })
  }
  res.json({ valid: true })
}))

// ==================== 团队详情 ====================

teamCrudRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const user = (req as any).user!

  const result = await teamService.getTeamDetail(id, user)
  sendContractData(res, TeamContracts.detail, result)
}, '团队不存在'))

// ==================== 创建团队 ====================

teamCrudRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const validated = parseContractBody(TeamContracts.create, req.body)
  const { name, description, isPublic, id } = validated
  const user = (req as any).user!

  // 校园模式：学生不能创建团队；个人模式可以
  if (!isPersonalContextForTeams(user) && !requestHasOrganizationCapability(user, 'team.create')) {
    return res.status(403).json({ success: false, message: '校园模式下学生不能创建团队' })
  }

  try {
    const team = await teamService.createTeam({ name, description, isPublic, id }, user)
    sendContractData(res, TeamContracts.create, team)
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_LIMIT_EXCEEDED') {
      const user = (req as any).user!
      const maxTeams = !isPersonalContextForTeams(user) && requestHasOrganizationCapability(user, 'team.create') ? 50 : 5
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

teamCrudRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const validated = parseContractBody(TeamContracts.update, req.body)
  const { name, description, isPublic } = validated
  const user = (req as any).user!

  const result = await teamService.updateTeam(id, { name, description, isPublic }, user)
  sendContractData(res, TeamContracts.update, result)
}))

// ==================== 更新公告 ====================

teamCrudRouter.put('/:id/announcement', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const { announcement } = parseContractBody(TeamContracts.announcement, req.body)
  const user = (req as any).user!

  const result = await teamService.updateAnnouncement(id, announcement ?? '', user)
  sendContractData(res, TeamContracts.announcement, result)
}))

// ==================== 上传头像 ====================

teamCrudRouter.post('/:id/avatar', authenticate, teamAvatarUpload.single('avatar'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = (req as any).user!

  if (!req.file) {
    return res.status(400).json({ success: false, message: '请上传图片文件' })
  }

  try {
    const result = await uploadTeamAvatar(id, user, req.file)

    logger.audit('team_avatar_uploaded', {
      userId: user.userId,
      action: 'upload_team_avatar',
      target: id,
      metadata: { fileId: result.fileId, originalName: result.originalName }
    })

    res.json({ success: true, data: { avatar: result.avatar, fileId: result.fileId } })
  } catch (error) {
    cleanupTeamAvatarTemporaryFile(req.file)
    handleError(res, error)
  }
}))

// ==================== 转移团队 ====================

teamCrudRouter.post('/:id/transfer', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const validated = parseContractBody(TeamContracts.transfer, req.body)
  const { newOwnerId, newOwnerType } = validated
  const user = (req as any).user!

  try {
    await teamService.transferTeam(id, { newOwnerId, newOwnerType }, user)
    sendContractData(res, TeamContracts.transfer, { message: '所有权转移成功' })
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
      if (error.message === 'NEW_OWNER_SCOPE_MISMATCH') {
        return res.status(400).json({ success: false, message: '新所有者身份与团队作用域不匹配' })
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
    sendContractData(res, TeamContracts.delete, { message: '团队删除成功' })
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
    parseContractBody(TeamContracts.leave, req.body || {})
    sendContractData(res, TeamContracts.leave, { message: result.message })
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
