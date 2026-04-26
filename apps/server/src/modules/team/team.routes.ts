/**
 * Team Module - Routes Layer
 * 团队模块路由层
 * 只负责：路由定义、请求解析、响应格式化
 */

import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate } from '../../middleware/auth'
import { canAccessSchool, canViewStudent } from '../../middleware/permissions'
import { teamService } from './team.service'
import { teamRepository } from './team.repository'
import { getUserName, getMemberDetails, getMemberDetailsBatch, getUserNames, transformTeamForFrontend } from './team.utils'
import logger from '../../lib/logger'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { prisma } from '../../prisma'
import type { MemberType } from './team.types'
import { fileService } from '../../lib/storage'
import { STORAGE_ROOT } from '../../config/storage'

export const teamRouter = Router()

// ==================== Multer 配置 ====================

// 临时上传目录
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
      'REQUEST_NOT_FOUND': { status: 404, message: '申请不存在' },
      'NO_PERMISSION': { status: 403, message: '无权操作' },
      'ALREADY_PROCESSED': { status: 400, message: '该申请已处理' },
      'ALREADY_MEMBER': { status: 400, message: '已是团队成员' },
      'HAS_PENDING_REQUEST': { status: 400, message: '已有待处理的请求' },
      'HAS_OTHER_MEMBERS': { status: 400, message: '团队中还有其他成员，无法操作' },
      'MEMBER_NOT_FOUND': { status: 404, message: '成员不存在或无权移除' },
      'USER_NOT_FOUND': { status: 401, message: '用户不存在' },
      'NOT_TEACHER_OR_STUDENT': { status: 403, message: '只有教师或学生可以创建团队' },
      'NO_SCHOOL': { status: 400, message: '您尚未归属任何学校' },
      'IDENTITY_NOT_FOUND': { status: 400, message: '无法识别用户身份' },
      'PRIVATE_TEAM': { status: 400, message: '私有团队无法申请加入' }
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

teamRouter.get('/school/:schoolId', authenticate, async (req, res) => {
  try {
    const { schoolId } = req.params
    const user = (req as any).user!

    if (!await canAccessSchool(req as any, schoolId)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学校的团队列表' })
    }

    const teams = await teamService.getSchoolTeams(schoolId, user)
    res.json({ success: true, data: teams })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 学生团队列表 ====================

teamRouter.get('/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params

    if (!await canViewStudent(req as any, studentId)) {
      return res.status(403).json({ success: false, message: '您没有权限查看该学生的团队信息' })
    }

    const result = await teamService.getStudentTeams(studentId)
    res.json({ success: true, data: result })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 邀请列表 ====================

teamRouter.get('/invitations', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!
    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(400).json({ success: false, message: '无法获取邀请列表' })
    }

    const invitations = await teamRepository.findUserPendingInvites(userId, userType as MemberType)

    const formattedInvitations = await Promise.all(
      invitations.map(async (invite) => {
        const ownerMember = await teamRepository.findOwner(invite.teamId)
        const ownerName = ownerMember ? await getUserName(ownerMember.userId, ownerMember.userType as MemberType) : '未知'

        let invitedByName = '未知'
        if (invite.invitedBy) {
          invitedByName = await getUserName(invite.invitedBy, 'teacher')
        }

        const team = await teamRepository.findById(invite.teamId)

        return {
          id: invite.id,
          teamId: invite.teamId,
          teamName: team?.name || '',
          teamAvatar: team?.avatar,
          schoolName: team?.School?.name || '',
          memberCount: team?.TeamMember?.length || 0,
          ownerName,
          invitedBy: invitedByName,
          invitedAt: invite.joinedAt,
          role: invite.role,
          isPublic: team?.isPublic
        }
      })
    )

    res.json({ success: true, data: formattedInvitations })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 管理员团队列表 ====================

teamRouter.get('/my-admin-teams', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId && !user.studentId) {
      return res.json({ success: true, data: [] })
    }

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    const memberRecords = await teamRepository.findUserAdminTeams(userId!, userType as MemberType)

    const teams = await Promise.all(
      memberRecords.map(async (record) => {
        const team = await teamRepository.findById(record.teamId)
        return team ? {
          id: team.id,
          name: team.name,
          avatar: team.avatar,
          description: team.description,
          isPublic: team.isPublic,
          school: team.School
        } : null
      })
    )

    res.json({ success: true, data: teams.filter(Boolean) })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 成员团队列表 ====================

teamRouter.get('/my-member-teams', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.json({ success: true, data: [] })
    }

    const memberRecords = await teamRepository.findUserMemberTeams(user.teacherId, 'teacher')

    const teams = await Promise.all(
      memberRecords.map(async (record) => {
        const team = await teamRepository.findById(record.teamId)
        return team ? {
          id: team.id,
          name: team.name,
          avatar: team.avatar,
          description: team.description,
          isPublic: team.isPublic,
          school: team.School
        } : null
      })
    )

    res.json({ success: true, data: teams.filter(Boolean) })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 管理员邀请处理 ====================

teamRouter.get('/admin-invitations', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId && !user.studentId) {
      return res.status(400).json({ success: false, message: '无法获取邀请列表' })
    }

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    const invitations = await teamRepository.findUserAdminInvites(userId!, userType as MemberType)

    const invitationsWithOwner = await Promise.all(
      invitations.map(async (invite) => {
        const ownerMember = await teamRepository.findOwner(invite.teamId)
        const ownerName = ownerMember ? await getUserName(ownerMember.userId, ownerMember.userType as MemberType) : '未知'
        const team = await teamRepository.findById(invite.teamId)

        return {
          id: invite.id,
          teamId: invite.teamId,
          teamName: team?.name || '',
          schoolName: team?.School?.name || '',
          memberCount: team?.TeamMember?.length || 0,
          ownerName,
          invitedAt: invite.joinedAt
        }
      })
    )

    res.json({ success: true, data: invitationsWithOwner })
  } catch (error) {
    handleError(res, error)
  }
})

teamRouter.post('/admin-invitations/:invitationId/accept', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const invitation = await teamRepository.findMemberById(invitationId)

    if (!invitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    const isMyInvitation = (invitation.userType === 'teacher' && user.teacherId === invitation.userId) ||
                           (invitation.userType === 'student' && user.studentId === invitation.userId)
    if (!isMyInvitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await teamRepository.updateMemberStatus(invitationId, 'active')
    res.json({ success: true, message: '已加入团队' })
  } catch (error) {
    handleError(res, error)
  }
})

teamRouter.post('/admin-invitations/:invitationId/reject', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const invitation = await teamRepository.findMemberById(invitationId)

    if (!invitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    const isMyInvitation = (invitation.userType === 'teacher' && user.teacherId === invitation.userId) ||
                           (invitation.userType === 'student' && user.studentId === invitation.userId)
    if (!isMyInvitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await teamRepository.deleteMember(invitationId)
    res.json({ success: true, message: '已拒绝邀请' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 成员邀请处理 ====================

teamRouter.get('/member-invitations', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.json({ success: true, data: [] })
    }

    const invitations = await teamRepository.findUserMemberInvites(user.teacherId, 'teacher')

    const invitationsWithOwner = await Promise.all(
      invitations.map(async (invite) => {
        const ownerMember = await teamRepository.findOwner(invite.teamId)
        const ownerName = ownerMember ? await getUserName(ownerMember.userId, ownerMember.userType as MemberType) : '未知'
        const team = await teamRepository.findById(invite.teamId)

        return {
          id: invite.id,
          teamId: invite.teamId,
          teamName: team?.name || '',
          schoolName: team?.School?.name || '',
          memberCount: team?.TeamMember?.length || 0,
          ownerName,
          invitedAt: invite.joinedAt,
          type: 'member'
        }
      })
    )

    res.json({ success: true, data: invitationsWithOwner })
  } catch (error) {
    handleError(res, error)
  }
})

teamRouter.post('/member-invitations/:invitationId/accept', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.status(400).json({ success: false, message: '只有教师可以处理成员邀请' })
    }

    const invitation = await teamRepository.findMemberById(invitationId)

    if (!invitation || invitation.userId !== user.teacherId || invitation.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await teamRepository.updateMemberStatus(invitationId, 'active')
    res.json({ success: true, message: '已加入团队' })
  } catch (error) {
    handleError(res, error)
  }
})

teamRouter.post('/member-invitations/:invitationId/reject', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.status(400).json({ success: false, message: '只有教师可以处理成员邀请' })
    }

    const invitation = await teamRepository.findMemberById(invitationId)

    if (!invitation || invitation.userId !== user.teacherId || invitation.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await teamRepository.deleteMember(invitationId)
    res.json({ success: true, message: '已拒绝邀请' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 统一邀请处理 ====================

teamRouter.post('/invitations/:invitationId/accept', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(400).json({ success: false, message: '无法识别用户身份' })
    }

    const invitation = await teamRepository.findMemberById(invitationId)

    if (!invitation || invitation.userId !== userId || invitation.userType !== userType) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    // 验证是被邀请而非主动申请
    // 参考: TEAM_STATE_MACHINE.md - INVITED vs REQUESTED 区分
    // invitedBy != null 表示是被邀请，invitedBy == null 表示是主动申请
    if (invitation.invitedBy === null) {
      return res.status(400).json({ success: false, message: '这是申请记录，应使用申请审批接口' })
    }

    // 使用条件更新，确保并发安全
    // 参考: TEAM_CONFLICT_RULES.md 场景 #3.1
    const count = await teamRepository.updateMemberStatusIfPending(invitationId, 'active')
    if (count === 0) {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    // 记录审计日志
    const callerType = user.teacherId ? 'teacher' : 'student'
    await teamRepository.logOperation({
      teamId: invitation.teamId,
      operatorId: userId,
      operatorType: callerType as MemberType,
      action: 'invite_accept',
      targetId: invitation.userId,
      targetType: invitation.userType as MemberType
    })

    res.json({ success: true, message: '已加入团队' })
  } catch (error) {
    handleError(res, error)
  }
})

teamRouter.post('/invitations/:invitationId/reject', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(400).json({ success: false, message: '无法识别用户身份' })
    }

    const invitation = await teamRepository.findMemberById(invitationId)

    if (!invitation || invitation.userId !== userId || invitation.userType !== userType) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    // 验证是被邀请而非主动申请
    // 参考: TEAM_STATE_MACHINE.md - INVITED vs REQUESTED 区分
    if (invitation.invitedBy === null) {
      return res.status(400).json({ success: false, message: '这是申请记录，应使用申请审批接口' })
    }

    // 使用条件删除，确保并发安全
    // 参考: TEAM_CONFLICT_RULES.md 场景 #3.1
    const count = await teamRepository.deleteMemberIfPending(invitationId)
    if (count === 0) {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    // 记录审计日志
    const callerType = user.teacherId ? 'teacher' : 'student'
    await teamRepository.logOperation({
      teamId: invitation.teamId,
      operatorId: userId,
      operatorType: callerType as MemberType,
      action: 'invite_reject',
      targetId: invitation.userId,
      targetType: invitation.userType as MemberType
    })

    res.json({ success: true, message: '已拒绝邀请' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 团队列表 ====================

teamRouter.get('/', authenticate, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')

  try {
    const { schoolId, page = 1, pageSize = 12, view } = req.query
    const user = (req as any).user!

    logger.info('get_teams_query', { schoolId, view } as any)
    logger.info('get_teams_user', { userId: user.userId, teacherId: user.teacherId, studentId: user.studentId } as any)

    const result = await teamService.getTeamList({
      schoolId: schoolId as string,
      page: Number(page),
      pageSize: Number(pageSize),
      view: view as string,
      user
    })

    res.json({ success: true, data: result })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 校验团队ID唯一性（必须在 /:id 之前注册）====================

teamRouter.get('/check-team-id', authenticate, async (req, res) => {
  try {
    const { id } = req.query
    if (!id || typeof id !== 'string') {
      return res.json({ valid: false, message: '请输入团队ID' })
    }
    // 格式校验：只允许数字、英文字母、下划线
    if (!/^[a-zA-Z0-9_]+$/.test(id as string)) {
      return res.json({ valid: false, message: '团队ID只能包含英文字母、数字和下划线' })
    }
    if ((id as string).length < 2) {
      return res.json({ valid: false, message: '团队ID至少2个字符' })
    }
    if ((id as string).length > 50) {
      return res.json({ valid: false, message: '团队ID不能超过50个字符' })
    }
    // 唯一性校验
    const existing = await prisma.team.findUnique({ where: { id: id as string } })
    if (existing) {
      return res.json({ valid: false, message: '该团队ID已被使用' })
    }
    res.json({ valid: true })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 团队详情 ====================

teamRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    const result = await teamService.getTeamDetail(id, user)
    res.json({ success: true, data: result })
  } catch (error) {
    handleError(res, error, '团队不存在')
  }
})

// ==================== 创建团队 ====================

teamRouter.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, isPublic, id } = req.body
    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ success: false, message: '请输入团队ID' })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(id)) {
      return res.status(400).json({ success: false, message: '团队ID只能包含英文字母、数字和下划线' })
    }
    if (id.length < 2) {
      return res.status(400).json({ success: false, message: '团队ID至少2个字符' })
    }
    const user = (req as any).user!

    const team = await teamService.createTeam({ name, description, isPublic, id }, user)
    res.json({ success: true, data: team })
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_LIMIT_EXCEEDED') {
      const user = (req as any).user!
      const maxTeams = user.teacherId ? 50 : 5
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
})

// ==================== 更新团队 ====================

teamRouter.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, isPublic } = req.body
    const user = (req as any).user!

    const result = await teamService.updateTeam(id, { name, description, isPublic }, user)
    res.json({ success: true, data: result })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 更新公告 ====================

teamRouter.put('/:id/announcement', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { announcement } = req.body
    const user = (req as any).user!

    const result = await teamService.updateAnnouncement(id, announcement, user)
    res.json({ success: true, data: result })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 上传头像 ====================

teamRouter.post('/:id/avatar', authenticate, avatarUpload.single('avatar'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传图片文件' })
    }

    const { isOwner } = await teamService.isTeamAdmin(id, user)
    if (!isOwner) {
      fs.unlinkSync(req.file.path)
      return res.status(403).json({ success: false, message: '只有团队所有者可以上传头像' })
    }

    // 使用 FileService 上传文件
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
})

// ==================== 可邀请成员 ====================

teamRouter.get('/:id/available-members', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { keyword, type } = req.query
    const user = (req as any).user!

    const { isAdmin } = await teamService.isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    const team = await teamRepository.findById(id)
    if (!team) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    const existingMembers = await teamRepository.findMembers(id)
    const existingTeacherIds = existingMembers.filter(m => m.userType === 'teacher').map(m => m.userId)
    const existingStudentIds = existingMembers.filter(m => m.userType === 'student').map(m => m.userId)

    const result = await teamRepository.findAvailableMembers({
      schoolId: team.schoolId,
      excludeTeacherIds: existingTeacherIds,
      excludeStudentIds: existingStudentIds,
      keyword: keyword as string,
      type: type as MemberType
    })

    res.json({ success: true, data: result })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 邀请成员 ====================

teamRouter.post('/:id/members', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { members, usernames, role = 'member' } = req.body
    const user = (req as any).user!

    const result = await teamService.inviteMembers(id, { members, usernames, role }, user)
    res.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ success: false, message: '该成员已被邀请，请勿重复操作' })
    }
    handleError(res, error)
  }
})

// ==================== 移除成员 ====================
// memberId 是用户 ID（Teacher/Student ID），通过 memberType 查询参数区分类型
// 参考: TEAM_API_CONTRACT.md 3.2 节
teamRouter.delete('/:id/members/:memberId', authenticate, async (req, res) => {
  try {
    const { id, memberId } = req.params
    const memberType = req.query.memberType as string | undefined
    const user = (req as any).user!

    // 权限检查
    const { isAdmin } = await teamService.isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    // 通过 teamId + userId + userType 查找成员
    // 前端传的 memberId 是 Teacher/Student ID，不是 TeamMember 记录 ID
    let member
    if (memberType && (memberType === 'teacher' || memberType === 'student')) {
      member = await teamRepository.findMember({
        teamId: id,
        userId: memberId,
        userType: memberType
      })
    } else {
      // 兼容：如果没有 memberType，回退到 TeamMember 记录 ID 查找
      member = await teamRepository.findMemberById(memberId)
    }

    if (!member) {
      return res.status(404).json({ success: false, message: '成员不存在' })
    }

    // 验证成员属于当前团队（防止跨团队操作）
    // 参考: TEAM_CONFLICT_RULES.md 场景 #3
    if (member.teamId !== id) {
      return res.status(400).json({ success: false, message: '该成员不属于当前团队' })
    }

    // 不能移除 owner
    if (member.role === 'owner') {
      return res.status(403).json({ success: false, message: '不能移除团队所有者' })
    }

    // admin 只能移除 member，owner 可以移除 admin
    // 参考: TEAM_PERMISSION_RULES.md 3.2 节
    const { isOwner } = await teamService.isTeamAdmin(id, user)
    if (!isOwner && member.role === 'admin') {
      return res.status(403).json({ success: false, message: '只有所有者可以移除管理员' })
    }

    // 不能移除自己（应使用退出功能）
    // 参考: TEAM_CONFLICT_RULES.md 场景 #5.9
    const callerId = user.teacherId || user.studentId
    if (member.userId === callerId) {
      return res.status(400).json({ success: false, message: '如需退出团队，请使用退出功能' })
    }

    // 删除成员（使用 TeamMember 记录 ID）
    await teamRepository.deleteMember(member.id)

    // 记录审计日志
    const callerType = user.teacherId ? 'teacher' : 'student'
    await teamRepository.logOperation({
      teamId: id,
      operatorId: callerId || '',
      operatorType: callerType as MemberType,
      action: 'member_remove',
      targetId: member.userId,
      targetType: member.userType as MemberType,
      oldValue: member.role,
      newValue: 'removed'
    })

    res.json({ success: true, message: '移除成功' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 待处理邀请 ====================

teamRouter.get('/:id/pending-invites', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    const { isAdmin } = await teamService.isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    const pendingMembers = await teamRepository.findMembers(id, { status: 'pending' })

    // 批量查询成员详情 + 邀请人名称
    const [detailsMap, inviterNames] = await Promise.all([
      getMemberDetailsBatch(pendingMembers.map(m => ({ userId: m.userId, userType: m.userType as MemberType }))),
      getUserNames(pendingMembers.filter(m => m.invitedBy).map(m => m.invitedBy!), 'teacher'),
    ])

    const invites = pendingMembers.map(member => {
      const userDetails = detailsMap.get(`${member.userType}:${member.userId}`)
      if (!userDetails) return null
      return {
        id: member.id,
        type: member.userType,
        role: member.role,
        invitedAt: member.joinedAt,
        invitedByName: member.invitedBy ? (inviterNames.get(member.invitedBy) || '未知') : '未知',
        user: userDetails
      }
    })

    res.json({ success: true, data: invites.filter(Boolean) })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 管理员管理 ====================

teamRouter.get('/:id/admins', authenticate, async (req, res) => {
  try {
    const { id } = req.params

    const adminMembers = await teamRepository.findAdmins(id)

    const detailsMap = await getMemberDetailsBatch(adminMembers.map(m => ({ userId: m.userId, userType: m.userType as MemberType })))

    const admins = adminMembers.map(m => {
      const details = detailsMap.get(`${m.userType}:${m.userId}`)
      return details ? { ...details, adminType: m.userType } : null
    })

    res.json({ success: true, data: admins.filter(Boolean) })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 设置管理员 ====================
// 请求体 memberId 是用户 ID（Teacher/Student ID），memberType 区分类型
// 通过 teamId + userId + userType 复合唯一键查找 TeamMember 记录
teamRouter.post('/:id/admins', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { memberId, memberType } = req.body
    const user = (req as any).user!

    const { isOwner } = await teamService.isTeamAdmin(id, user)
    if (!isOwner) {
      return res.status(403).json({ success: false, message: '只有团队所有者可以添加管理员' })
    }

    if (!memberId) {
      return res.status(400).json({ success: false, message: '请指定成员ID' })
    }

    // 前端传的 memberId 是 Teacher/Student ID，不是 TeamMember 记录 ID
    // 通过 teamId + userId + userType 复合唯一键查找
    let existingMember
    if (memberType && (memberType === 'teacher' || memberType === 'student')) {
      existingMember = await teamRepository.findMember({
        teamId: id,
        userId: memberId,
        userType: memberType
      })
    } else {
      // 兼容：如果没有 memberType，回退到 TeamMember 记录 ID 查找
      existingMember = await teamRepository.findMemberById(memberId)
    }

    if (!existingMember) {
      return res.status(404).json({ success: false, message: '该成员不存在' })
    }

    // 验证成员属于当前团队（防止跨团队操作）
    if (existingMember.teamId !== id) {
      return res.status(400).json({ success: false, message: '该成员不属于当前团队' })
    }

    if (existingMember.role === 'admin') {
      return res.status(400).json({ success: false, message: '该成员已是管理员' })
    }

    if (existingMember.role === 'owner') {
      return res.status(400).json({ success: false, message: '所有者无需设为管理员' })
    }

    const oldRole = existingMember.role

    const admin = await teamRepository.updateMemberRole(existingMember.id, 'admin')
    const memberName = await getUserName(existingMember.userId, existingMember.userType as MemberType)

    const callerId = user.teacherId || user.studentId
    const callerType = user.teacherId ? 'teacher' : 'student'
    await teamRepository.logOperation({
      teamId: id,
      operatorId: callerId || '',
      operatorType: callerType as MemberType,
      action: 'role_change',
      targetId: existingMember.userId,
      targetType: existingMember.userType as MemberType,
      oldValue: oldRole,
      newValue: 'admin'
    })

    res.json({ success: true, data: { ...admin, memberName }, message: '已设置为管理员' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 取消管理员 ====================
// URL 参数 adminId 是用户 ID（Teacher/Student ID），?adminType 区分类型
// 通过 teamId + userId + userType 复合唯一键查找 TeamMember 记录
teamRouter.delete('/:id/admins/:adminId', authenticate, async (req, res) => {
  try {
    const { id, adminId } = req.params
    const adminType = req.query.adminType as string | undefined
    const user = (req as any).user!

    const { isOwner } = await teamService.isTeamAdmin(id, user)
    if (!isOwner) {
      return res.status(403).json({ success: false, message: '只有团队所有者可以移除管理员' })
    }

    // 前端传的 adminId 是 Teacher/Student ID，不是 TeamMember 记录 ID
    // 通过 teamId + userId + userType 复合唯一键查找
    let adminMember
    if (adminType && (adminType === 'teacher' || adminType === 'student')) {
      adminMember = await teamRepository.findMember({
        teamId: id,
        userId: adminId,
        userType: adminType
      })
    } else {
      // 兼容：如果没有 adminType，回退到 TeamMember 记录 ID 查找
      adminMember = await teamRepository.findMemberById(adminId)
    }

    // 验证管理员存在且角色正确
    if (!adminMember || adminMember.role !== 'admin') {
      return res.status(404).json({ success: false, message: '管理员不存在' })
    }

    // 验证管理员属于当前团队（防止跨团队操作）
    if (adminMember.teamId !== id) {
      return res.status(400).json({ success: false, message: '该管理员不属于当前团队' })
    }

    const oldRole = adminMember.role

    await teamRepository.updateMemberRole(adminMember.id, 'member')

    const callerId = user.teacherId || user.studentId
    const callerType = user.teacherId ? 'teacher' : 'student'
    await teamRepository.logOperation({
      teamId: id,
      operatorId: callerId || '',
      operatorType: callerType as MemberType,
      action: 'role_change',
      targetId: adminMember.userId,
      targetType: adminMember.userType as MemberType,
      oldValue: oldRole,
      newValue: 'member'
    })

    res.json({ success: true, message: '移除成功' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 加入申请 ====================

teamRouter.post('/:id/join-request', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { message } = req.body
    const user = (req as any).user!

    const result = await teamService.joinRequest(id, { message }, user)

    if (user.studentId) {
      res.json({ success: true, data: result, message: '申请已提交' })
    } else {
      res.json({ success: true, data: result, message: '申请已提交，等待审批' })
    }
  } catch (error) {
    handleError(res, error)
  }
})

teamRouter.post('/:id/teacher-join-request', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { message } = req.body
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.status(403).json({ success: false, message: '只有教师可以申请加入' })
    }

    const result = await teamService.joinRequest(id, { message }, user)
    res.json({ success: true, data: result, message: '申请已提交，等待审批' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 教师申请审批 ====================

teamRouter.post('/teacher-join-requests/:memberId/approve', authenticate, async (req, res) => {
  try {
    const { memberId } = req.params
    const user = (req as any).user!

    const member = await teamRepository.findMemberById(memberId)

    if (!member || member.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '请求不存在' })
    }

    // 验证是主动申请而非被邀请
    // 参考: TEAM_STATE_MACHINE.md - INVITED vs REQUESTED 区分
    // invitedBy != null 表示是被邀请，invitedBy == null 表示是主动申请
    if (member.invitedBy !== null) {
      return res.status(400).json({ success: false, message: '这是邀请记录，应使用邀请接受/拒绝接口' })
    }

    // 验证状态是 pending
    if (member.status !== 'pending') {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }

    const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    // 使用条件更新，确保并发安全
    // 参考: TEAM_CONFLICT_RULES.md 场景 #2.1
    const count = await teamRepository.updateMemberStatusIfPending(memberId, 'active')
    if (count === 0) {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }

    // 记录审计日志
    const callerId = user.teacherId || user.studentId || ''
    const callerType = user.teacherId ? 'teacher' : 'student'
    await teamRepository.logOperation({
      teamId: member.teamId,
      operatorId: callerId,
      operatorType: callerType as MemberType,
      action: 'join_approve',
      targetId: member.userId,
      targetType: 'teacher'
    })

    res.json({ success: true, message: '已同意加入请求' })
  } catch (error) {
    handleError(res, error)
  }
})

teamRouter.post('/teacher-join-requests/:memberId/reject', authenticate, async (req, res) => {
  try {
    const { memberId } = req.params
    const user = (req as any).user!

    const member = await teamRepository.findMemberById(memberId)

    if (!member || member.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '请求不存在' })
    }

    // 验证是主动申请而非被邀请
    // 参考: TEAM_STATE_MACHINE.md - INVITED vs REQUESTED 区分
    if (member.invitedBy !== null) {
      return res.status(400).json({ success: false, message: '这是邀请记录，应使用邀请接受/拒绝接口' })
    }

    // 验证状态是 pending
    if (member.status !== 'pending') {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }

    const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    // 使用条件删除，确保并发安全
    // 参考: TEAM_CONFLICT_RULES.md 场景 #2.1
    const count = await teamRepository.deleteMemberIfPending(memberId)
    if (count === 0) {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }

    // 记录审计日志
    const callerId = user.teacherId || user.studentId || ''
    const callerType = user.teacherId ? 'teacher' : 'student'
    await teamRepository.logOperation({
      teamId: member.teamId,
      operatorId: callerId,
      operatorType: callerType as MemberType,
      action: 'join_reject',
      targetId: member.userId,
      targetType: 'teacher'
    })

    res.json({ success: true, message: '已拒绝加入请求' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 加入申请列表 ====================

teamRouter.get('/:id/join-requests', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    const { isAdmin } = await teamService.isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    // 学生申请
    const studentRequests = await teamRepository.findJoinRequests(id)

    const studentUserAvatars = await Promise.all(
      studentRequests.map(r =>
        r.Student?.userId
          ? teamRepository.findUserAvatar(r.Student.userId)
          : Promise.resolve(null)
      )
    )

    // 教师申请
    const teacherRequests = await teamRepository.findMembers(id, { status: 'pending', userType: 'teacher' })
      .then(members => members.filter(m => !m.invitedBy))

    const teacherRequestsWithDetails = await Promise.all(
      teacherRequests.map(async (member) => {
        const teacher = await teamRepository.findTeacher(member.userId)
        const user = teacher ? await teamRepository.findUserAvatar(teacher.userId) : null
        return {
          id: member.id,
          type: 'teacher',
          message: null,
          createdAt: member.joinedAt,
          user: teacher ? { ...teacher, avatar: user?.avatar || teacher.avatar, userType: 'teacher' } : null
        }
      })
    )

    const formattedStudentRequests = studentRequests.map((r, i) => ({
      id: r.id,
      type: 'student',
      source: 'join-request',
      message: r.message,
      createdAt: r.createdAt,
      user: {
        ...r.Student,
        avatar: studentUserAvatars[i]?.avatar || r.Student?.avatar,
        userType: 'student'
      }
    }))

    const formattedTeacherRequests = teacherRequestsWithDetails.map(r => ({
      id: r.id,
      type: 'teacher',
      source: 'join-request',
      message: r.message,
      createdAt: r.createdAt,
      user: r.user
    }))

    res.json({
      success: true,
      data: [...formattedStudentRequests, ...formattedTeacherRequests].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 统一审批 ====================

teamRouter.post('/requests/:requestId/approve', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const { type } = req.query
    const user = (req as any).user!
    const callerId = user.teacherId || user.studentId || ''

    if (type === 'teacher') {
      await teamRepository.transaction(async (tx) => {
        const member = await tx.teamMember.findUnique({ where: { id: requestId } })
        if (!member || member.userType !== 'teacher') {
          throw new Error('REQUEST_NOT_FOUND')
        }

        const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
        if (!isAdmin) {
          throw new Error('NO_PERMISSION')
        }

        const result = await tx.teamMember.updateMany({
          where: { id: requestId, status: 'pending' },
          data: { status: 'active', joinedAt: new Date() }
        })
        if (result.count === 0) {
          throw new Error('ALREADY_PROCESSED')
        }

        const callerType = user.teacherId ? 'teacher' : 'student'
        await tx.teamOperationLog.create({
          data: {
            teamId: member.teamId,
            operatorId: callerId,
            operatorType: callerType,
            action: 'join_approve',
            targetId: member.userId,
            targetType: 'teacher'
          }
        })

        logger.audit('join_request_approve', {
          userId: user.userId,
          action: 'join_approve',
          target: requestId,
          metadata: { teamId: member.teamId, type: 'teacher', targetUserId: member.userId }
        })
      })

      res.json({ success: true, message: '已同意加入请求' })
    } else {
      await teamRepository.transaction(async (tx) => {
        const request = await tx.teamJoinRequest.findUnique({ where: { id: requestId } })
        if (!request) {
          throw new Error('REQUEST_NOT_FOUND')
        }

        const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
        if (!isAdmin) {
          throw new Error('NO_PERMISSION')
        }

        const result = await tx.teamJoinRequest.updateMany({
          where: { id: requestId, status: 'pending' },
          data: { status: 'approved', processedAt: new Date(), processedBy: callerId }
        })
        if (result.count === 0) {
          throw new Error('ALREADY_PROCESSED')
        }

        await tx.teamMember.upsert({
          where: {
            teamId_userId_userType: {
              teamId: request.teamId,
              userId: request.studentId,
              userType: 'student'
            }
          },
          update: { status: 'active', invitedBy: callerId },
          create: {
            teamId: request.teamId,
            userId: request.studentId,
            userType: 'student',
            role: 'member',
            status: 'active',
            invitedBy: callerId,
            joinedAt: new Date()
          }
        })

        const callerType = user.teacherId ? 'teacher' : 'student'
        await tx.teamOperationLog.create({
          data: {
            teamId: request.teamId,
            operatorId: callerId,
            operatorType: callerType,
            action: 'join_approve',
            targetId: request.studentId,
            targetType: 'student'
          }
        })

        logger.audit('join_request_approve', {
          userId: user.userId,
          action: 'join_approve',
          target: requestId,
          metadata: { teamId: request.teamId, type: 'student', targetUserId: request.studentId }
        })
      })

      res.json({ success: true, message: '已同意申请' })
    }
  } catch (error) {
    if (error instanceof Error) {
      const errorMessages: Record<string, { status: number; message: string }> = {
        'REQUEST_NOT_FOUND': { status: 404, message: '申请不存在' },
        'NO_PERMISSION': { status: 403, message: '无权操作' },
        'ALREADY_PROCESSED': { status: 400, message: '该申请已处理' }
      }
      const errorInfo = errorMessages[error.message]
      if (errorInfo) {
        return res.status(errorInfo.status).json({ success: false, message: errorInfo.message })
      }
    }
    handleError(res, error)
  }
})

teamRouter.post('/requests/:requestId/reject', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const { type } = req.query
    const user = (req as any).user!

    if (type === 'teacher') {
      const member = await teamRepository.findMemberById(requestId)

      if (!member || member.userType !== 'teacher') {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }

      const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: '无权操作' })
      }

      // 使用条件删除，确保并发安全
      const count = await teamRepository.deleteMemberIfPending(requestId)
      if (count === 0) {
        return res.status(400).json({ success: false, message: '该申请已被处理' })
      }

      const callerId = user.teacherId || user.studentId || ''
      const callerType = user.teacherId ? 'teacher' : 'student'
      await teamRepository.logOperation({
        teamId: member.teamId,
        operatorId: callerId,
        operatorType: callerType as MemberType,
        action: 'join_reject',
        targetId: member.userId,
        targetType: 'teacher'
      })

      logger.audit('join_request_reject', {
        userId: user.userId,
        action: 'join_reject',
        target: requestId,
        metadata: { teamId: member.teamId, type: 'teacher' }
      })

      res.json({ success: true, message: '已拒绝加入请求' })
    } else {
      const request = await teamRepository.findJoinRequestById(requestId)

      if (!request) {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }

      const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: '无权操作' })
      }

      const processedBy = user.teacherId || user.studentId || ''

      // 使用条件更新，确保并发安全
      const count = await teamRepository.updateJoinRequestIfPending(requestId, {
        status: 'rejected',
        processedAt: new Date(),
        processedBy
      })
      if (count === 0) {
        return res.status(400).json({ success: false, message: '该申请已被处理' })
      }

      const callerType = user.teacherId ? 'teacher' : 'student'
      await teamRepository.logOperation({
        teamId: request.teamId,
        operatorId: processedBy,
        operatorType: callerType as MemberType,
        action: 'join_reject',
        targetId: request.studentId,
        targetType: 'student'
      })

      logger.audit('join_request_reject', {
        userId: user.userId,
        action: 'join_reject',
        target: requestId,
        metadata: { teamId: request.teamId, type: 'student' }
      })

      res.json({ success: true, message: '已拒绝申请' })
    }
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 兼容旧 API ====================

teamRouter.post('/join-requests/:requestId/approve', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const user = (req as any).user!

    const request = await teamRepository.findJoinRequestById(requestId)

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在' })
    }

    const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    const processedBy = user.teacherId || user.studentId || ''

    await teamRepository.transaction(async (tx) => {
      // 使用条件更新，确保并发安全
      const result = await tx.teamJoinRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'approved', processedAt: new Date(), processedBy }
      })
      if (result.count === 0) {
        throw new Error('ALREADY_PROCESSED')
      }

      await tx.teamMember.create({
        data: {
          teamId: request.teamId,
          userId: request.studentId,
          userType: 'student',
          role: 'member',
          status: 'active',
          invitedBy: processedBy,
          joinedAt: new Date()
        }
      })
    })

    res.json({ success: true, message: '已同意申请' })
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }
    handleError(res, error)
  }
})

teamRouter.post('/join-requests/:requestId/reject', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const user = (req as any).user!

    const request = await teamRepository.findJoinRequestById(requestId)

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在' })
    }

    const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    const processedBy = user.teacherId || user.studentId || ''

    // 使用条件更新，确保并发安全
    const count = await teamRepository.updateJoinRequestIfPending(requestId, {
      status: 'rejected',
      processedAt: new Date(),
      processedBy
    })
    if (count === 0) {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }

    res.json({ success: true, message: '已拒绝申请' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 取消邀请 ====================

teamRouter.delete('/:id/invites/:inviteId', authenticate, async (req, res) => {
  try {
    const { id, inviteId } = req.params
    const user = (req as any).user!

    const { isAdmin } = await teamService.isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    // 获取邀请记录
    const invite = await teamRepository.findMemberById(inviteId)

    if (!invite) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    // 验证邀请属于当前团队（防止跨团队操作）
    // 参考: TEAM_CONFLICT_RULES.md 场景 #5.6
    if (invite.teamId !== id) {
      return res.status(400).json({ success: false, message: '该邀请不属于当前团队' })
    }

    // 验证邀请状态必须是 pending
    if (invite.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已被处理' })
    }

    // 使用条件删除确保并发安全
    // 参考: TEAM_CONFLICT_RULES.md 场景 #5.6
    const count = await teamRepository.deleteMemberIfPending(inviteId)
    if (count === 0) {
      return res.status(400).json({ success: false, message: '邀请已被处理' })
    }

    res.json({ success: true, message: '已取消邀请' })
  } catch (error) {
    handleError(res, error)
  }
})

// ==================== 转移团队 ====================

teamRouter.post('/:id/transfer', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { newOwnerId, newOwnerType } = req.body
    const user = (req as any).user!

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
})

// ==================== 删除团队 ====================

teamRouter.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

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
})

// ==================== 退出团队 ====================

teamRouter.post('/:id/leave', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

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
})