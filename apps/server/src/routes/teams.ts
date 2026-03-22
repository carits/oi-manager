import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { prisma } from '../prisma'
import { authenticate } from '../middleware/auth'
import { JwtPayload } from '../../../../packages/shared/src'

export const teamRouter = Router()

// 配置头像上传
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/teams')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
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

// 辅助函数：根据 userId 和 userType 获取用户名称
async function getUserName(userId: string, userType: string): Promise<string> {
  if (userType === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: userId },
      select: { name: true }
    })
    return teacher?.name || '未知'
  } else {
    const student = await prisma.student.findUnique({
      where: { id: userId },
      select: { name: true }
    })
    return student?.name || '未知'
  }
}

// 辅助函数：获取成员详细信息
async function getMemberDetails(userId: string, userType: string) {
  if (userType === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, userId: true }
    })
    if (!teacher) return null
    const user = await prisma.user.findUnique({
      where: { id: teacher.userId },
      select: { username: true, avatar: true }
    })
    // 优先使用 User 表的头像（用户上传头像时更新的是 User 表）
    return {
      ...teacher,
      avatar: user?.avatar || teacher.avatar,
      username: user?.username || '',
      type: 'teacher'
    }
  } else {
    const student = await prisma.student.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, userId: true }
    })
    if (!student) return null
    const user = await prisma.user.findUnique({
      where: { id: student.userId! },
      select: { username: true, avatar: true }
    })
    // 优先使用 User 表的头像（用户上传头像时更新的是 User 表）
    return {
      ...student,
      avatar: user?.avatar || student.avatar,
      username: user?.username || '',
      type: 'student'
    }
  }
}

// 辅助函数：检查用户是否是团队成员并返回角色
async function getMemberRole(teamId: string, user: JwtPayload): Promise<{ role: 'owner' | 'admin' | 'member' | null; memberId: string | null }> {
  const userId = user.teacherId || user.studentId
  const userType = user.teacherId ? 'teacher' : 'student'

  if (!userId) {
    return { role: null, memberId: null }
  }

  const member = await prisma.teamMember.findUnique({
    where: {
      teamId_userId_userType: {
        teamId,
        userId,
        userType
      }
    },
    select: { id: true, role: true }
  })

  if (!member) {
    return { role: null, memberId: null }
  }

  return { role: member.role as 'owner' | 'admin' | 'member', memberId: member.id }
}

// 辅助函数：检查用户是否是团队管理员（所有者或管理员）
async function isTeamAdmin(teamId: string, user: JwtPayload): Promise<{ isOwner: boolean; isAdmin: boolean }> {
  const { role } = await getMemberRole(teamId, user)
  return {
    isOwner: role === 'owner',
    isAdmin: role === 'owner' || role === 'admin'
  }
}

// 获取学校的团队列表（学生浏览用）
teamRouter.get('/school/:schoolId', authenticate, async (req, res) => {
  try {
    const { schoolId } = req.params
    const user = (req as any).user!

    // 获取学校的公有团队
    const teams = await prisma.team.findMany({
      where: {
        schoolId,
        isPublic: true
      },
      include: {
        school: { select: { id: true, name: true } },
        _count: { select: { members: { where: { status: 'active' } } } }
      },
      orderBy: { createdAt: 'desc' }
    })

    // 为每个团队获取所有者信息
    const teamsWithOwner = await Promise.all(
      teams.map(async (team) => {
        const ownerMember = await prisma.teamMember.findFirst({
          where: { teamId: team.id, role: 'owner' }
        })

        const ownerName = ownerMember
          ? await getUserName(ownerMember.userId, ownerMember.userType)
          : '未知'

        return {
          ...team,
          owner: { id: ownerMember?.userId || '', name: ownerName }
        }
      })
    )

    // 如果是学生，检查申请状态
    let teamsWithStatus = teamsWithOwner
    if (user.studentId) {
      const joinRequests = await prisma.teamJoinRequest.findMany({
        where: {
          studentId: user.studentId,
          teamId: { in: teams.map(t => t.id) }
        }
      })
      const requestMap = new Map(joinRequests.map(r => [r.teamId, r.status]))

      const memberRecords = await prisma.teamMember.findMany({
        where: {
          userId: user.studentId,
          userType: 'student',
          teamId: { in: teams.map(t => t.id) }
        }
      })
      const memberMap = new Map(memberRecords.map(m => [m.teamId, m.status]))

      teamsWithStatus = teamsWithOwner.map(team => ({
        ...team,
        memberStatus: memberMap.get(team.id) || null,
        requestStatus: requestMap.get(team.id) || null
      }))
    }

    res.json({ success: true, data: teamsWithStatus })
  } catch (error) {
    console.error('Get school teams error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取学生的团队列表（已加入 + 待处理邀请）
teamRouter.get('/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params
    const user = (req as any).user!

    // 只能查看自己的团队
    if (user.studentId !== studentId) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    // 获取学生作为成员的所有团队记录
    const memberRecords = await prisma.teamMember.findMany({
      where: {
        userId: studentId,
        userType: 'student'
      },
      include: {
        team: {
          include: {
            school: { select: { id: true, name: true } },
            _count: { select: { members: { where: { status: 'active' } } } }
          }
        }
      }
    })

    // 分类：已加入和待处理
    const joinedTeams: any[] = []
    const pendingTeams: any[] = []

    for (const record of memberRecords) {
      const ownerMember = await prisma.teamMember.findFirst({
        where: { teamId: record.teamId, role: 'owner' }
      })

      const ownerName = ownerMember
        ? await getUserName(ownerMember.userId, ownerMember.userType)
        : '未知'

      const teamWithInfo = {
        ...record.team,
        owner: { id: ownerMember?.userId || '', name: ownerName },
        memberRole: record.role,
        joinedAt: record.joinedAt
      }

      if (record.status === 'active') {
        joinedTeams.push(teamWithInfo)
      } else if (record.status === 'pending') {
        pendingTeams.push({
          ...teamWithInfo,
          invitationId: record.id,  // TeamMember 记录的 ID，用于接受/拒绝邀请
          invitationType: record.role === 'admin' ? 'admin' : 'member'
        })
      }
    }

    res.json({
      success: true,
      data: {
        joined: joinedTeams,
        pending: pendingTeams
      }
    })
  } catch (error) {
    console.error('Get student teams error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取我的待处理邀请列表（统一接口，支持教师和学生）
teamRouter.get('/invitations', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(400).json({ success: false, message: '无法获取邀请列表' })
    }

    // 获取所有待处理邀请（包括管理员和成员邀请）
    const invitations = await prisma.teamMember.findMany({
      where: {
        userId,
        userType,
        status: 'pending'
      },
      include: {
        team: {
          include: {
            school: { select: { id: true, name: true } },
            _count: { select: { members: { where: { status: 'active' } } } }
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    })

    // 获取每个团队的所有者信息并格式化
    const formattedInvitations = await Promise.all(
      invitations.map(async (invite) => {
        const ownerMember = await prisma.teamMember.findFirst({
          where: { teamId: invite.teamId, role: 'owner' }
        })

        const ownerName = ownerMember
          ? await getUserName(ownerMember.userId, ownerMember.userType)
          : '未知'

        // 获取邀请人信息
        let invitedByName = '未知'
        if (invite.invitedBy) {
          invitedByName = await getUserName(invite.invitedBy, 'teacher')
        }

        return {
          id: invite.id,
          teamId: invite.team.id,
          teamName: invite.team.name,
          teamAvatar: invite.team.avatar,
          schoolName: invite.team.school.name,
          memberCount: invite.team._count.members,
          ownerName,
          invitedBy: invitedByName,
          invitedAt: invite.joinedAt,
          role: invite.role,  // 'admin' | 'member'
          isPublic: invite.team.isPublic
        }
      })
    )

    res.json({ success: true, data: formattedInvitations })
  } catch (error) {
    console.error('Get invitations error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取我作为管理员的团队列表
teamRouter.get('/my-admin-teams', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId && !user.studentId) {
      return res.json({ success: true, data: [] })
    }

    const userId = user.teacherId || user.studentId!
    const userType = user.teacherId ? 'teacher' : 'student'

    const memberRecords = await prisma.teamMember.findMany({
      where: {
        userId,
        userType,
        role: 'admin',
        status: 'active'
      },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            avatar: true,
            description: true,
            isPublic: true,
            school: { select: { id: true, name: true } },
            _count: { select: { members: { where: { status: 'active' } } } }
          }
        }
      }
    })

    const teams = memberRecords.map(record => record.team)

    res.json({ success: true, data: teams })
  } catch (error) {
    console.error('Get my admin teams error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取我作为成员的团队列表（教师）
teamRouter.get('/my-member-teams', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.json({ success: true, data: [] })
    }

    const memberRecords = await prisma.teamMember.findMany({
      where: {
        userId: user.teacherId,
        userType: 'teacher',
        role: 'member',
        status: 'active'
      },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            avatar: true,
            description: true,
            isPublic: true,
            school: { select: { id: true, name: true } },
            _count: { select: { members: { where: { status: 'active' } } } }
          }
        }
      }
    })

    const teams = memberRecords.map(record => record.team)

    res.json({ success: true, data: teams })
  } catch (error) {
    console.error('Get my member teams error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取管理员邀请列表（教师和学生都可以查看）
teamRouter.get('/admin-invitations', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId && !user.studentId) {
      return res.status(400).json({ success: false, message: '无法获取邀请列表' })
    }

    const userId = user.teacherId || user.studentId!
    const userType = user.teacherId ? 'teacher' : 'student'

    const invitations = await prisma.teamMember.findMany({
      where: {
        userId,
        userType,
        role: 'admin',
        status: 'pending'
      },
      include: {
        team: {
          include: {
            school: { select: { id: true, name: true } },
            _count: { select: { members: { where: { status: 'active' } } } }
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    })

    // 获取每个团队的所有者信息
    const invitationsWithOwner = await Promise.all(
      invitations.map(async (invite) => {
        const ownerMember = await prisma.teamMember.findFirst({
          where: { teamId: invite.teamId, role: 'owner' }
        })

        const ownerName = ownerMember
          ? await getUserName(ownerMember.userId, ownerMember.userType)
          : '未知'

        return {
          id: invite.id,
          teamId: invite.team.id,
          teamName: invite.team.name,
          schoolName: invite.team.school.name,
          memberCount: invite.team._count.members,
          ownerName,
          invitedAt: invite.joinedAt
        }
      })
    )

    res.json({ success: true, data: invitationsWithOwner })
  } catch (error) {
    console.error('Get admin invitations error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 接受管理员邀请（教师和学生都可以处理）
teamRouter.post('/admin-invitations/:invitationId/accept', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const invitation = await prisma.teamMember.findUnique({
      where: { id: invitationId }
    })

    if (!invitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    // 验证是否是当前用户的邀请
    const isMyInvitation = (invitation.userType === 'teacher' && user.teacherId === invitation.userId) ||
                           (invitation.userType === 'student' && user.studentId === invitation.userId)
    if (!isMyInvitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await prisma.teamMember.update({
      where: { id: invitationId },
      data: { status: 'active', joinedAt: new Date() }
    })

    res.json({ success: true, message: '已加入团队' })
  } catch (error) {
    console.error('Accept admin invitation error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 拒绝管理员邀请（教师和学生都可以处理）
teamRouter.post('/admin-invitations/:invitationId/reject', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const invitation = await prisma.teamMember.findUnique({
      where: { id: invitationId }
    })

    if (!invitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    // 验证是否是当前用户的邀请
    const isMyInvitation = (invitation.userType === 'teacher' && user.teacherId === invitation.userId) ||
                           (invitation.userType === 'student' && user.studentId === invitation.userId)
    if (!isMyInvitation) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await prisma.teamMember.delete({
      where: { id: invitationId }
    })

    res.json({ success: true, message: '已拒绝邀请' })
  } catch (error) {
    console.error('Reject admin invitation error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取教师成员邀请列表
teamRouter.get('/member-invitations', authenticate, async (req, res) => {
  try {
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.json({ success: true, data: [] })
    }

    const invitations = await prisma.teamMember.findMany({
      where: {
        userId: user.teacherId,
        userType: 'teacher',
        role: 'member',
        status: 'pending'
      },
      include: {
        team: {
          include: {
            school: { select: { id: true, name: true } },
            _count: { select: { members: { where: { status: 'active' } } } }
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    })

    // 获取每个团队的邀请人信息
    const invitationsWithOwner = await Promise.all(
      invitations.map(async (invite) => {
        const ownerMember = await prisma.teamMember.findFirst({
          where: { teamId: invite.teamId, role: 'owner' }
        })

        const ownerName = ownerMember
          ? await getUserName(ownerMember.userId, ownerMember.userType)
          : '未知'

        return {
          id: invite.id,
          teamId: invite.team.id,
          teamName: invite.team.name,
          schoolName: invite.team.school.name,
          memberCount: invite.team._count.members,
          ownerName,
          invitedAt: invite.joinedAt,
          type: 'member'
        }
      })
    )

    res.json({ success: true, data: invitationsWithOwner })
  } catch (error) {
    console.error('Get member invitations error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 接受教师成员邀请
teamRouter.post('/member-invitations/:invitationId/accept', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.status(400).json({ success: false, message: '只有教师可以处理成员邀请' })
    }

    const invitation = await prisma.teamMember.findUnique({
      where: { id: invitationId }
    })

    if (!invitation || invitation.userId !== user.teacherId || invitation.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await prisma.teamMember.update({
      where: { id: invitationId },
      data: { status: 'active', joinedAt: new Date() }
    })

    res.json({ success: true, message: '已加入团队' })
  } catch (error) {
    console.error('Accept member invitation error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 拒绝教师成员邀请
teamRouter.post('/member-invitations/:invitationId/reject', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.status(400).json({ success: false, message: '只有教师可以处理成员邀请' })
    }

    const invitation = await prisma.teamMember.findUnique({
      where: { id: invitationId }
    })

    if (!invitation || invitation.userId !== user.teacherId || invitation.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await prisma.teamMember.delete({
      where: { id: invitationId }
    })

    res.json({ success: true, message: '已拒绝邀请' })
  } catch (error) {
    console.error('Reject member invitation error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 接受邀请（统一接口，支持教师和学生）
teamRouter.post('/invitations/:invitationId/accept', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(400).json({ success: false, message: '无法识别用户身份' })
    }

    const invitation = await prisma.teamMember.findUnique({
      where: { id: invitationId }
    })

    if (!invitation || invitation.userId !== userId || invitation.userType !== userType) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await prisma.teamMember.update({
      where: { id: invitationId },
      data: {
        status: 'active',
        joinedAt: new Date()
      }
    })

    res.json({ success: true, message: '已加入团队' })
  } catch (error) {
    console.error('Accept invitation error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 拒绝邀请（统一接口，支持教师和学生）
teamRouter.post('/invitations/:invitationId/reject', authenticate, async (req, res) => {
  try {
    const { invitationId } = req.params
    const user = (req as any).user!

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(400).json({ success: false, message: '无法识别用户身份' })
    }

    const invitation = await prisma.teamMember.findUnique({
      where: { id: invitationId }
    })

    if (!invitation || invitation.userId !== userId || invitation.userType !== userType) {
      return res.status(404).json({ success: false, message: '邀请不存在' })
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }

    await prisma.teamMember.delete({
      where: { id: invitationId }
    })

    res.json({ success: true, message: '已拒绝邀请' })
  } catch (error) {
    console.error('Reject invitation error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取团队列表（教师用）
teamRouter.get('/', authenticate, async (req, res) => {
  // 禁用缓存
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')

  try {
    const { teacherId, studentId, schoolId, page = 1, pageSize = 12, view } = req.query
    const user = (req as any).user!

    console.log('[GET /teams] Query:', { teacherId, studentId, schoolId, view })
    console.log('[GET /teams] User from token:', { userId: user.userId, teacherId: user.teacherId, studentId: user.studentId })

    // 确定 userId 和 userType - 优先使用 query 参数，其次使用 JWT token 中的值
    const effectiveStudentId = (studentId as string) || user.studentId
    const effectiveTeacherId = (teacherId as string) || user.teacherId
    const userId = effectiveStudentId || effectiveTeacherId
    const userType = effectiveStudentId ? 'student' : 'teacher'

    const where: Record<string, unknown> = {}
    if (schoolId) where.schoolId = schoolId as string

    // 构建过滤条件
    if (view === 'mine') {
      // 我的团队：必须有 userId
      if (!userId || userId === 'undefined' || userId === 'null') {
        return res.json({
          success: true,
          data: {
            list: [],
            total: 0,
            page: Number(page),
            pageSize: Number(pageSize),
            totalPages: 0
          }
        })
      }

      // 获取我是成员的所有团队ID
      const myMemberships = await prisma.teamMember.findMany({
        where: {
          userId: userId,
          userType: userType,
          status: 'active'
        },
        select: { teamId: true }
      })

      const myTeamIds = myMemberships.map(m => m.teamId)
      where.id = { in: myTeamIds }
    } else {
      // 全部团队：只显示公有，且排除自己已加入的
      where.isPublic = true

      // 获取我已经加入的团队ID，在全部团队中排除
      if (userId && userId !== 'undefined' && userId !== 'null') {
        const myMemberships = await prisma.teamMember.findMany({
          where: {
            userId: userId,
            userType: userType,
            status: 'active'
          },
          select: { teamId: true }
        })
        const myTeamIds = myMemberships.map(m => m.teamId)
        if (myTeamIds.length > 0) {
          where.id = { notIn: myTeamIds }
        }
      }
    }

    const skip = (Number(page) - 1) * Number(pageSize)
    const take = Number(pageSize)

    const [allTeams, total] = await Promise.all([
      prisma.team.findMany({
        where,
        include: {
          school: { select: { id: true, name: true } },
          _count: { select: { members: { where: { status: 'active' } } } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.team.count({ where })
    ])

    // 为每个团队获取所有者信息和成员数详情
    const teamsWithOwner = await Promise.all(
      allTeams.map(async (team) => {
        const [ownerMember, adminsCount, teacherMembersCount] = await Promise.all([
          prisma.teamMember.findFirst({
            where: { teamId: team.id, role: 'owner' }
          }),
          prisma.teamMember.count({
            where: { teamId: team.id, role: 'admin', status: 'active' }
          }),
          prisma.teamMember.count({
            where: { teamId: team.id, userType: 'teacher', role: 'member', status: 'active' }
          })
        ])

        const ownerName = ownerMember
          ? await getUserName(ownerMember.userId, ownerMember.userType)
          : '未知'

        return {
          ...team,
          owner: { id: ownerMember?.userId || '', name: ownerName },
          _count: {
            members: team._count.members,
            admins: adminsCount,
            teacherMembers: teacherMembersCount
          }
        }
      })
    )

    res.json({
      success: true,
      data: {
        list: teamsWithOwner,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize))
      }
    })
  } catch (error) {
    console.error('Get teams error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取单个团队详情
teamRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            educationSystem: true,
            schoolType: true
          }
        },
        members: {
          where: { status: 'active' }
        }
      }
    })

    if (!team) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    // 私有团队权限检查：只有成员可以查看
    if (!team.isPublic) {
      const { role } = await getMemberRole(id, user)
      if (!role) {
        return res.status(403).json({ success: false, message: '您没有权限查看该团队' })
      }
    }

    // 整理成员信息
    const owner = team.members.find(m => m.role === 'owner')
    const admins = team.members.filter(m => m.role === 'admin')
    const members = team.members.filter(m => m.role === 'member')

    const ownerInfo = owner ? await getMemberDetails(owner.userId, owner.userType) : null
    const adminsInfo = await Promise.all(admins.map(a => getMemberDetails(a.userId, a.userType)))

    const teachersInfo = await Promise.all(
      members
        .filter(m => m.userType === 'teacher')
        .map(async m => {
          const details = await getMemberDetails(m.userId, m.userType)
          return details ? { ...details, joinedAt: m.joinedAt } : null
        })
    )

    const studentsInfo = await Promise.all(
      members
        .filter(m => m.userType === 'student')
        .map(async m => {
          const details = await getMemberDetails(m.userId, m.userType)
          return details ? { ...details, joinedAt: m.joinedAt } : null
        })
    )

    // 查询 pending 状态的教师请求（只返回主动申请的，不返回被邀请的）
    const pendingTeachers = await prisma.teamMember.findMany({
      where: { teamId: id, userType: 'teacher', status: 'pending', invitedBy: null }
    })
    const pendingTeachersInfo = await Promise.all(
      pendingTeachers.map(async m => {
        const details = await getMemberDetails(m.userId, m.userType)
        return details ? { ...details, memberId: m.id, requestedAt: m.joinedAt } : null
      })
    )

    const result = {
      ...team,
      owner: ownerInfo,
      admins: adminsInfo.filter(Boolean),
      teachers: teachersInfo.filter(Boolean),
      students: studentsInfo.filter(Boolean),
      pendingTeachers: pendingTeachersInfo.filter(Boolean)
    }

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Get team error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建团队
teamRouter.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, isPublic } = req.body
    const userId = (req as any).user!.userId

    // 获取当前用户信息
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { teacher: true, student: true }
    })

    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }

    let ownerId: string
    let ownerType: string
    let schoolId: string | null = null
    const maxTeams = user.teacher ? 50 : 5

    // 检查用户类型并获取学校
    if (user.teacher) {
      ownerId = user.teacher.id
      ownerType = 'teacher'
      schoolId = user.teacher.schoolId
    } else if (user.student) {
      ownerId = user.student.id
      ownerType = 'student'
      schoolId = user.student.schoolId
    } else {
      return res.status(403).json({ success: false, message: '只有教师或学生可以创建团队' })
    }

    if (!schoolId) {
      return res.status(400).json({ success: false, message: '您尚未归属任何学校' })
    }

    // 检查团队数量限制
    const existingTeams = await prisma.teamMember.count({
      where: { userId: ownerId, userType: ownerType, role: 'owner' }
    })
    if (existingTeams >= maxTeams) {
      return res.status(400).json({ success: false, message: `您创建的团队数量已达上限（${maxTeams}个）` })
    }

    // 使用事务创建团队和所有者成员记录
    const team = await prisma.$transaction(async (tx) => {
      const newTeam = await tx.team.create({
        data: {
          name,
          description,
          schoolId,
          isPublic: isPublic !== undefined ? isPublic : true
        },
        include: {
          school: { select: { id: true, name: true } }
        }
      })

      // 创建所有者成员记录
      await tx.teamMember.create({
        data: {
          teamId: newTeam.id,
          userId: ownerId,
          userType: ownerType,
          role: 'owner',
          status: 'active',
          joinedAt: new Date()
        }
      })

      return newTeam
    })

    res.json({ success: true, data: team })
  } catch (error) {
    console.error('Create team error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新团队基本信息
teamRouter.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, isPublic } = req.body
    const user = (req as any).user!

    // 检查权限
    const { isOwner, isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '只有团队所有者或管理员可以修改' })
    }

    // 只有所有者可以修改 isPublic
    if (isPublic !== undefined && !isOwner) {
      return res.status(403).json({ success: false, message: '只有所有者可以修改团队可见性' })
    }

    const updatedTeam = await prisma.team.update({
      where: { id },
      data: {
        name,
        description,
        ...(isPublic !== undefined && { isPublic })
      },
      include: {
        school: { select: { id: true, name: true } }
      }
    })

    // 获取所有者信息
    const ownerMember = await prisma.teamMember.findFirst({
      where: { teamId: id, role: 'owner' }
    })

    const ownerName = ownerMember
      ? await getUserName(ownerMember.userId, ownerMember.userType)
      : '未知'

    res.json({ success: true, data: { ...updatedTeam, owner: { id: ownerMember?.userId || '', name: ownerName } } })
  } catch (error) {
    console.error('Update team error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新团队公告
teamRouter.put('/:id/announcement', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { announcement } = req.body
    const user = (req as any).user!

    // 检查权限
    const { isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '只有团队所有者或管理员可以编辑公告' })
    }

    const updatedTeam = await prisma.team.update({
      where: { id },
      data: { announcement }
    })

    res.json({ success: true, data: updatedTeam })
  } catch (error) {
    console.error('Update announcement error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 上传团队头像
teamRouter.post('/:id/avatar', authenticate, avatarUpload.single('avatar'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传图片文件' })
    }

    // 检查权限 - 只有所有者可以上传头像
    const { isOwner } = await isTeamAdmin(id, user)
    if (!isOwner) {
      return res.status(403).json({ success: false, message: '只有团队所有者可以上传头像' })
    }

    const avatarUrl = `/uploads/teams/${req.file.filename}`
    await prisma.team.update({
      where: { id },
      data: { avatar: avatarUrl }
    })

    res.json({ success: true, data: { avatar: avatarUrl } })
  } catch (error) {
    console.error('Upload avatar error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取可邀请的成员列表（本校学生和教师）
teamRouter.get('/:id/available-members', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { keyword, type } = req.query
    const user = (req as any).user!

    // 检查权限
    const { isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: { schoolId: true }
    })
    if (!team) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    // 获取已存在的成员ID
    const existingMembers = await prisma.teamMember.findMany({
      where: { teamId: id },
      select: { userId: true, userType: true }
    })

    const existingTeacherIds = existingMembers.filter(m => m.userType === 'teacher').map(m => m.userId)
    const existingStudentIds = existingMembers.filter(m => m.userType === 'student').map(m => m.userId)

    const result: { students: unknown[]; teachers: unknown[] } = {
      students: [],
      teachers: []
    }

    // 搜索学生
    if (!type || type === 'student') {
      const students = await prisma.student.findMany({
        where: {
          schoolId: team.schoolId,
          id: { notIn: existingStudentIds },
          ...(keyword && { name: { contains: keyword as string } })
        },
        select: { id: true, name: true, avatar: true, userId: true },
        take: 20
      })
      // 获取用户名和头像
      const studentUsers = await Promise.all(
        students.map(s => prisma.user.findUnique({ where: { id: s.userId! }, select: { username: true, avatar: true } }))
      )
      result.students = students.map((s, i) => ({
        id: s.id,
        name: s.name,
        avatar: studentUsers[i]?.avatar || s.avatar,
        username: studentUsers[i]?.username || ''
      }))
    }

    // 搜索教师
    if (!type || type === 'teacher') {
      const teachers = await prisma.teacher.findMany({
        where: {
          schoolId: team.schoolId,
          id: { notIn: existingTeacherIds },
          ...(keyword && { name: { contains: keyword as string } })
        },
        select: { id: true, name: true, avatar: true, userId: true },
        take: 20
      })
      // 获取用户名和头像
      const teacherUsers = await Promise.all(
        teachers.map(t => prisma.user.findUnique({ where: { id: t.userId }, select: { username: true, avatar: true } }))
      )
      result.teachers = teachers.map((t, i) => ({
        id: t.id,
        name: t.name,
        avatar: teacherUsers[i]?.avatar || t.avatar,
        username: teacherUsers[i]?.username || ''
      }))
    }

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Get available members error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 邀请成员（统一接口）
teamRouter.post('/:id/members', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { members, usernames, role = 'member' } = req.body
    const user = (req as any).user!

    // 检查权限
    const { isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以邀请成员' })
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: { schoolId: true }
    })
    if (!team) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    // 获取邀请人ID
    const invitedBy = user.teacherId || user.studentId || ''

    const result = {
      invited: [] as string[],
      notFound: [] as string[],
      notSameSchool: [] as string[],
      alreadyMember: [] as string[]
    }

    // 收集要邀请的成员列表
    const targetMembers: Array<{ id: string; type: 'student' | 'teacher' }> = []

    // 处理统一的 members 参数
    if (members && Array.isArray(members)) {
      for (const member of members) {
        if (typeof member === 'object' && member.id && member.type) {
          targetMembers.push({ id: member.id, type: member.type })
        }
      }
    }

    // 如果提供了用户名，查找对应的学生或教师
    if (usernames && Array.isArray(usernames) && usernames.length > 0) {
      for (const username of usernames as string[]) {
        const trimmedUsername = username.trim()
        if (!trimmedUsername) continue

        const foundUser = await prisma.user.findUnique({
          where: { username: trimmedUsername },
          include: { student: true, teacher: true }
        })

        if (!foundUser) {
          result.notFound.push(trimmedUsername)
          continue
        }

        if (foundUser.student) {
          if (foundUser.student.schoolId !== team.schoolId) {
            result.notSameSchool.push(trimmedUsername)
            continue
          }
          targetMembers.push({ id: foundUser.student.id, type: 'student' })
        } else if (foundUser.teacher) {
          if (foundUser.teacher.schoolId !== team.schoolId) {
            result.notSameSchool.push(trimmedUsername)
            continue
          }
          targetMembers.push({ id: foundUser.teacher.id, type: 'teacher' })
        } else {
          result.notFound.push(trimmedUsername)
        }
      }
    }

    // 统一处理成员邀请
    for (const member of targetMembers) {
      const { id: memberId, type: memberType } = member

      // 检查是否已是成员
      const existing = await prisma.teamMember.findUnique({
        where: {
          teamId_userId_userType: {
            teamId: id,
            userId: memberId,
            userType: memberType
          }
        }
      })

      if (existing) {
        result.alreadyMember.push(memberId)
        continue
      }

      // 检查成员是否属于本校
      const memberUser = memberType === 'teacher'
        ? await prisma.teacher.findUnique({ where: { id: memberId } })
        : await prisma.student.findUnique({ where: { id: memberId } })

      if (!memberUser || memberUser.schoolId !== team.schoolId) {
        result.notSameSchool.push(memberId)
        continue
      }

      // 创建邀请
      await prisma.teamMember.create({
        data: {
          teamId: id,
          userId: memberId,
          userType: memberType,
          role: role === 'admin' ? 'admin' : 'member',
          status: 'pending',
          invitedBy
        }
      })
      result.invited.push(memberId)
    }

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Invite members error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 移除成员
teamRouter.delete('/:id/members/:memberId', authenticate, async (req, res) => {
  try {
    const { id, memberId } = req.params
    const { memberType } = req.query
    const user = (req as any).user!

    // 检查权限
    const { isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以移除成员' })
    }

    let whereClause: any

    if (memberType && (memberType === 'student' || memberType === 'teacher')) {
      // 通过 userId + userType 删除
      whereClause = {
        teamId: id,
        userId: memberId,
        userType: memberType,
        role: 'member'  // 只能移除普通成员，不能移除管理员和所有者
      }
    } else {
      // 通过 TeamMember 记录ID 删除（兼容旧逻辑）
      whereClause = {
        teamId: id,
        id: memberId
      }
    }

    const result = await prisma.teamMember.deleteMany({
      where: whereClause
    })

    if (result.count === 0) {
      return res.status(404).json({ success: false, message: '成员不存在或无权移除' })
    }

    res.json({ success: true, message: '移除成功' })
  } catch (error) {
    console.error('Remove member error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取团队的待处理邀请列表（管理员用）
teamRouter.get('/:id/pending-invites', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    // 检查权限
    const { isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    // 获取所有待处理成员
    const pendingMembers = await prisma.teamMember.findMany({
      where: {
        teamId: id,
        status: 'pending'
      },
      orderBy: { joinedAt: 'desc' }
    })

    // 整理结果
    const invites = await Promise.all(
      pendingMembers.map(async (member) => {
        let invitedByName = '未知'
        if (member.invitedBy) {
          invitedByName = await getUserName(member.invitedBy, 'teacher')
        }

        const userDetails = await getMemberDetails(member.userId, member.userType)

        return {
          id: member.id,
          type: member.userType,
          role: member.role,
          invitedAt: member.joinedAt,
          invitedByName,
          user: userDetails
        }
      })
    )

    res.json({ success: true, data: invites })
  } catch (error) {
    console.error('Get pending invites error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取团队管理员列表
teamRouter.get('/:id/admins', authenticate, async (req, res) => {
  try {
    const { id } = req.params

    const adminMembers = await prisma.teamMember.findMany({
      where: { teamId: id, role: 'admin', status: 'active' }
    })

    const admins = await Promise.all(
      adminMembers.map(async m => {
        const details = await getMemberDetails(m.userId, m.userType)
        return details ? { ...details, adminType: m.userType } : null
      })
    )

    res.json({ success: true, data: admins.filter(Boolean) })
  } catch (error) {
    console.error('Get admins error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 添加管理员（仅所有者）
teamRouter.post('/:id/admins', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { memberId, memberType } = req.body
    const user = (req as any).user!

    // 检查权限
    const { isOwner } = await isTeamAdmin(id, user)
    if (!isOwner) {
      return res.status(403).json({ success: false, message: '只有团队所有者可以添加管理员' })
    }

    if (!memberId || !memberType) {
      return res.status(400).json({ success: false, message: '请指定成员ID和类型' })
    }

    // 检查成员是否存在
    const existingMember = await prisma.teamMember.findFirst({
      where: {
        teamId: id,
        userId: memberId,
        userType: memberType
      }
    })

    if (!existingMember) {
      return res.status(404).json({ success: false, message: '该成员不存在' })
    }

    if (existingMember.role === 'admin') {
      return res.status(400).json({ success: false, message: '该成员已是管理员' })
    }

    if (existingMember.role === 'owner') {
      return res.status(400).json({ success: false, message: '所有者无需设为管理员' })
    }

    // 更新角色为管理员
    const admin = await prisma.teamMember.update({
      where: { id: existingMember.id },
      data: { role: 'admin' }
    })

    // 获取成员名称
    const memberName = await getUserName(memberId, memberType)

    res.json({ success: true, data: { ...admin, memberName }, message: '已设置为管理员' })
  } catch (error) {
    console.error('Add admin error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 移除管理员（仅所有者）
teamRouter.delete('/:id/admins/:adminId', authenticate, async (req, res) => {
  try {
    const { id, adminId } = req.params
    const { adminType } = req.query
    const user = (req as any).user!

    // 检查权限
    const { isOwner } = await isTeamAdmin(id, user)
    if (!isOwner) {
      return res.status(403).json({ success: false, message: '只有团队所有者可以移除管理员' })
    }

    // 根据 adminId 是用户ID还是记录ID 来处理
    // 如果提供了 adminType，说明 adminId 是用户ID
    let whereClause: any
    if (adminType) {
      whereClause = {
        teamId: id,
        userId: adminId,
        userType: adminType as string,
        role: 'admin'
      }
    } else {
      // 兼容旧逻辑：adminId 是 TeamMember 记录 ID
      whereClause = { id: adminId, role: 'admin' }
    }

    const adminMember = await prisma.teamMember.findFirst({
      where: whereClause
    })

    if (!adminMember) {
      return res.status(404).json({ success: false, message: '管理员不存在' })
    }

    // 更新角色为普通成员
    await prisma.teamMember.update({
      where: { id: adminMember.id },
      data: { role: 'member' }
    })

    res.json({ success: true, message: '移除成功' })
  } catch (error) {
    console.error('Remove admin error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 申请加入团队（统一接口，支持教师和学生）
teamRouter.post('/:id/join-request', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { message } = req.body
    const user = (req as any).user!

    // 获取用户ID和类型
    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(403).json({ success: false, message: '无法识别用户身份' })
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: { isPublic: true, schoolId: true }
    })

    if (!team) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    if (!team.isPublic) {
      return res.status(400).json({ success: false, message: '私有团队无法申请加入' })
    }

    // 检查是否已是成员或已有待处理请求
    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId_userType: {
          teamId: id,
          userId,
          userType
        }
      }
    })

    if (existingMember) {
      if (existingMember.status === 'active') {
        return res.status(400).json({ success: false, message: '您已是团队成员' })
      } else {
        return res.status(400).json({ success: false, message: '您已有待处理的请求' })
      }
    }

    // 对于学生，检查 TeamJoinRequest 表（保持兼容）
    if (userType === 'student') {
      const existingRequest = await prisma.teamJoinRequest.findUnique({
        where: {
          teamId_studentId: {
            teamId: id,
            studentId: userId
          }
        }
      })

      if (existingRequest) {
        return res.status(400).json({ success: false, message: '您已提交过申请' })
      }

      // 创建申请记录（学生使用 TeamJoinRequest 表保持兼容）
      const request = await prisma.teamJoinRequest.create({
        data: {
          teamId: id,
          studentId: userId,
          message
        }
      })

      res.json({ success: true, data: request, message: '申请已提交' })
    } else {
      // 教师创建 pending 状态的 TeamMember 记录
      const member = await prisma.teamMember.create({
        data: {
          teamId: id,
          userId,
          userType: 'teacher',
          role: 'member',
          status: 'pending'
        }
      })

      res.json({ success: true, data: member, message: '申请已提交，等待审批' })
    }
  } catch (error) {
    console.error('Join request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 教师申请加入团队（创建 pending 状态的 TeamMember）
teamRouter.post('/:id/teacher-join-request', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { message } = req.body
    const user = (req as any).user!

    if (!user.teacherId) {
      return res.status(403).json({ success: false, message: '只有教师可以申请加入' })
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: { isPublic: true, schoolId: true }
    })

    if (!team) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    if (!team.isPublic) {
      return res.status(400).json({ success: false, message: '私有团队无法申请加入' })
    }

    // 检查是否已是成员或已有待处理请求
    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId_userType: {
          teamId: id,
          userId: user.teacherId,
          userType: 'teacher'
        }
      }
    })

    if (existingMember) {
      if (existingMember.status === 'active') {
        return res.status(400).json({ success: false, message: '您已是团队成员' })
      } else {
        return res.status(400).json({ success: false, message: '您已有待处理的请求' })
      }
    }

    // 创建 pending 状态的 TeamMember 记录
    const member = await prisma.teamMember.create({
      data: {
        teamId: id,
        userId: user.teacherId,
        userType: 'teacher',
        role: 'member',
        status: 'pending'
      }
    })

    res.json({ success: true, data: member, message: '申请已提交，等待审批' })
  } catch (error) {
    console.error('Teacher join request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 批准教师加入请求
teamRouter.post('/teacher-join-requests/:memberId/approve', authenticate, async (req, res) => {
  try {
    const { memberId } = req.params
    const user = (req as any).user!

    const member = await prisma.teamMember.findUnique({
      where: { id: memberId }
    })

    if (!member || member.status !== 'pending' || member.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '请求不存在' })
    }

    // 检查权限
    const { isAdmin } = await isTeamAdmin(member.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    // 更新状态为 active
    await prisma.teamMember.update({
      where: { id: memberId },
      data: { status: 'active', joinedAt: new Date() }
    })

    res.json({ success: true, message: '已同意加入请求' })
  } catch (error) {
    console.error('Approve teacher request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 拒绝教师加入请求
teamRouter.post('/teacher-join-requests/:memberId/reject', authenticate, async (req, res) => {
  try {
    const { memberId } = req.params
    const user = (req as any).user!

    const member = await prisma.teamMember.findUnique({
      where: { id: memberId }
    })

    if (!member || member.status !== 'pending' || member.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '请求不存在' })
    }

    // 检查权限
    const { isAdmin } = await isTeamAdmin(member.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    // 删除请求
    await prisma.teamMember.delete({
      where: { id: memberId }
    })

    res.json({ success: true, message: '已拒绝加入请求' })
  } catch (error) {
    console.error('Reject teacher request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取团队的加入申请列表（管理员用，统一返回学生申请和教师申请）
teamRouter.get('/:id/join-requests', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    // 检查权限
    const { isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    // 获取学生申请（来自 TeamJoinRequest 表）
    const studentRequests = await prisma.teamJoinRequest.findMany({
      where: {
        teamId: id,
        status: 'pending'
      },
      include: {
        student: {
          select: { id: true, name: true, avatar: true, rating: true, enrollmentYear: true, userId: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // 获取学生的 User 表头像
    const studentUserAvatars = await Promise.all(
      studentRequests.map(r =>
        r.student.userId
          ? prisma.user.findUnique({ where: { id: r.student.userId }, select: { avatar: true } })
          : Promise.resolve(null)
      )
    )

    // 获取教师申请（来自 TeamMember 表，status='pending'，invitedBy 为空表示主动申请）
    const teacherRequests = await prisma.teamMember.findMany({
      where: {
        teamId: id,
        status: 'pending',
        userType: 'teacher',
        invitedBy: null  // 主动申请，不是被邀请
      },
      orderBy: { joinedAt: 'desc' }
    })

    // 获取教师详情
    const teacherRequestsWithDetails = await Promise.all(
      teacherRequests.map(async (member) => {
        const teacher = await prisma.teacher.findUnique({
          where: { id: member.userId },
          select: { id: true, name: true, avatar: true, title: true, userId: true }
        })
        const user = teacher ? await prisma.user.findUnique({
          where: { id: teacher.userId },
          select: { avatar: true }
        }) : null
        return {
          id: member.id,
          type: 'teacher',
          message: null,
          createdAt: member.joinedAt,
          user: teacher ? { ...teacher, avatar: user?.avatar || teacher.avatar, userType: 'teacher' } : null
        }
      })
    )

    // 统一格式化返回
    const formattedStudentRequests = studentRequests.map((r, i) => ({
      id: r.id,
      type: 'student',
      source: 'join-request',  // 来源：学生申请
      message: r.message,
      createdAt: r.createdAt,
      user: {
        ...r.student,
        avatar: studentUserAvatars[i]?.avatar || r.student.avatar,
        userType: 'student'
      }
    }))

    const formattedTeacherRequests = teacherRequestsWithDetails.map(r => ({
      id: r.id,
      type: 'teacher',
      source: 'join-request',  // 来源：教师申请
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
    console.error('Get join requests error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 统一审批 API - 同意申请
teamRouter.post('/requests/:requestId/approve', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const { type } = req.query  // 'student' | 'teacher'
    const user = (req as any).user!

    const processedBy = user.teacherId || user.studentId || ''

    if (type === 'teacher') {
      // 处理教师申请（TeamMember 表）
      const member = await prisma.teamMember.findUnique({
        where: { id: requestId }
      })

      if (!member || member.status !== 'pending' || member.userType !== 'teacher') {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }

      // 检查权限
      const { isAdmin } = await isTeamAdmin(member.teamId, user)
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: '无权操作' })
      }

      // 更新状态为 active
      await prisma.teamMember.update({
        where: { id: requestId },
        data: { status: 'active', joinedAt: new Date() }
      })

      res.json({ success: true, message: '已同意加入请求' })
    } else {
      // 处理学生申请（TeamJoinRequest 表）
      const request = await prisma.teamJoinRequest.findUnique({
        where: { id: requestId }
      })

      if (!request) {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }

      // 检查权限
      const { isAdmin } = await isTeamAdmin(request.teamId, user)
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: '无权操作' })
      }

      // 使用事务处理
      await prisma.$transaction(async (tx) => {
        // 更新申请状态
        await tx.teamJoinRequest.update({
          where: { id: requestId },
          data: {
            status: 'approved',
            processedAt: new Date(),
            processedBy
          }
        })

        // 添加到团队
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
    }
  } catch (error) {
    console.error('Approve request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 统一审批 API - 拒绝申请
teamRouter.post('/requests/:requestId/reject', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const { type } = req.query  // 'student' | 'teacher'
    const user = (req as any).user!

    if (type === 'teacher') {
      // 处理教师申请（TeamMember 表）
      const member = await prisma.teamMember.findUnique({
        where: { id: requestId }
      })

      if (!member || member.status !== 'pending' || member.userType !== 'teacher') {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }

      // 检查权限
      const { isAdmin } = await isTeamAdmin(member.teamId, user)
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: '无权操作' })
      }

      // 删除请求
      await prisma.teamMember.delete({
        where: { id: requestId }
      })

      res.json({ success: true, message: '已拒绝加入请求' })
    } else {
      // 处理学生申请（TeamJoinRequest 表）
      const request = await prisma.teamJoinRequest.findUnique({
        where: { id: requestId }
      })

      if (!request) {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }

      // 检查权限
      const { isAdmin } = await isTeamAdmin(request.teamId, user)
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: '无权操作' })
      }

      const processedBy = user.teacherId || user.studentId || ''

      await prisma.teamJoinRequest.update({
        where: { id: requestId },
        data: {
          status: 'rejected',
          processedAt: new Date(),
          processedBy
        }
      })

      res.json({ success: true, message: '已拒绝申请' })
    }
  } catch (error) {
    console.error('Reject request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 兼容旧 API 路由 - 同意加入申请
teamRouter.post('/join-requests/:requestId/approve', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const user = (req as any).user!

    const request = await prisma.teamJoinRequest.findUnique({
      where: { id: requestId }
    })

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在' })
    }

    const { isAdmin } = await isTeamAdmin(request.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    const processedBy = user.teacherId || user.studentId || ''

    await prisma.$transaction(async (tx) => {
      await tx.teamJoinRequest.update({
        where: { id: requestId },
        data: { status: 'approved', processedAt: new Date(), processedBy }
      })

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
    console.error('Approve request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 兼容旧 API 路由 - 拒绝加入申请
teamRouter.post('/join-requests/:requestId/reject', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params
    const user = (req as any).user!

    const request = await prisma.teamJoinRequest.findUnique({
      where: { id: requestId }
    })

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在' })
    }

    const { isAdmin } = await isTeamAdmin(request.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    const processedBy = user.teacherId || user.studentId || ''

    await prisma.teamJoinRequest.update({
      where: { id: requestId },
      data: { status: 'rejected', processedAt: new Date(), processedBy }
    })

    res.json({ success: true, message: '已拒绝申请' })
  } catch (error) {
    console.error('Reject request error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 取消邀请
teamRouter.delete('/:id/invites/:inviteId', authenticate, async (req, res) => {
  try {
    const { id, inviteId } = req.params
    const user = (req as any).user!

    // 检查权限
    const { isAdmin } = await isTeamAdmin(id, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    await prisma.teamMember.delete({
      where: { id: inviteId }
    })

    res.json({ success: true, message: '已取消邀请' })
  } catch (error) {
    console.error('Cancel invite error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 转移团队所有者（仅当前所有者）
teamRouter.post('/:id/transfer', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { newOwnerId, newOwnerType } = req.body
    const user = (req as any).user!

    // 检查权限
    const { isOwner } = await isTeamAdmin(id, user)
    if (!isOwner) {
      return res.status(403).json({ success: false, message: '只有团队所有者可以转移所有权' })
    }

    // 获取当前团队信息
    const currentTeam = await prisma.team.findUnique({
      where: { id },
      select: { schoolId: true }
    })
    if (!currentTeam) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    // 获取当前所有者信息
    const currentOwner = await prisma.teamMember.findFirst({
      where: { teamId: id, role: 'owner' }
    })
    if (!currentOwner) {
      return res.status(400).json({ success: false, message: '团队所有者不存在' })
    }

    // 验证新所有者
    const newOwnerUser = newOwnerType === 'teacher'
      ? await prisma.teacher.findUnique({ where: { id: newOwnerId }, select: { id: true, name: true, schoolId: true } })
      : await prisma.student.findUnique({ where: { id: newOwnerId }, select: { id: true, name: true, schoolId: true } })

    if (!newOwnerUser) {
      return res.status(404).json({ success: false, message: `${newOwnerType === 'teacher' ? '教师' : '学生'}不存在` })
    }

    if (newOwnerUser.schoolId !== currentTeam.schoolId) {
      return res.status(400).json({ success: false, message: `新所有者必须是本校${newOwnerType === 'teacher' ? '教师' : '学生'}` })
    }

    // 检查团队数量限制
    const existingTeams = await prisma.teamMember.count({
      where: { userId: newOwnerId, userType: newOwnerType, role: 'owner' }
    })
    const maxTeams = newOwnerType === 'teacher' ? 50 : 5

    if (existingTeams >= maxTeams) {
      return res.status(400).json({ success: false, message: `该${newOwnerType === 'teacher' ? '教师' : '学生'}创建的团队数量已达上限（${maxTeams}个），无法转移` })
    }

    // 检查新所有者是否是团队成员
    const newOwnerMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId_userType: {
          teamId: id,
          userId: newOwnerId,
          userType: newOwnerType
        }
      }
    })

    if (!newOwnerMember || newOwnerMember.status !== 'active') {
      return res.status(400).json({ success: false, message: '新所有者必须是团队成员' })
    }

    // 使用事务更新
    await prisma.$transaction(async (tx) => {
      // 将原所有者改为管理员
      await tx.teamMember.update({
        where: { id: currentOwner.id },
        data: { role: 'admin' }
      })

      // 将新所有者设为 owner
      await tx.teamMember.update({
        where: { id: newOwnerMember.id },
        data: { role: 'owner' }
      })
    })

    res.json({ success: true, message: '所有权转移成功' })
  } catch (error) {
    console.error('Transfer team error:', error)
    res.status(500).json({ success: false, message: '服务器错误: ' + (error instanceof Error ? error.message : String(error)) })
  }
})

// 删除团队（只有所有者可操作，且团队必须无其他成员）
teamRouter.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    // 检查是否是所有者
    const { isOwner } = await isTeamAdmin(id, user)
    if (!isOwner) {
      return res.status(403).json({ success: false, message: '只有团队所有者可以删除团队' })
    }

    // 获取团队信息，检查是否有其他成员
    const memberCount = await prisma.teamMember.count({
      where: {
        teamId: id,
        status: 'active',
        role: { not: 'owner' }
      }
    })

    if (memberCount > 0) {
      return res.status(400).json({
        success: false,
        message: '团队中还有其他成员，无法删除。请先移除所有成员或将团队转让给他人。'
      })
    }

    // 删除团队（级联删除会自动处理关联数据）
    await prisma.team.delete({
      where: { id }
    })

    res.json({ success: true, message: '团队删除成功' })
  } catch (error) {
    console.error('Delete team error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 退出团队（所有成员可用，所有者只能在团队无人时退出即解散）
teamRouter.post('/:id/leave', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user!

    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return res.status(400).json({ success: false, message: '无法识别用户身份' })
    }

    // 获取用户的成员记录
    const member = await prisma.teamMember.findUnique({
      where: {
        teamId_userId_userType: {
          teamId: id,
          userId,
          userType
        }
      }
    })

    if (!member) {
      return res.status(400).json({ success: false, message: '您不是该团队成员' })
    }

    if (member.role === 'owner') {
      // 所有者：检查团队是否有其他成员
      const otherMemberCount = await prisma.teamMember.count({
        where: {
          teamId: id,
          status: 'active',
          id: { not: member.id }
        }
      })

      if (otherMemberCount > 0) {
        return res.status(400).json({
          success: false,
          message: '团队中还有其他成员，无法退出。请先移除所有成员或将团队转让给他人。'
        })
      }

      // 没有其他成员，删除团队（解散）
      await prisma.team.delete({
        where: { id }
      })
      res.json({ success: true, message: '团队已解散' })
    } else {
      // 非所有者：删除成员记录
      await prisma.teamMember.delete({
        where: { id: member.id }
      })
      res.json({ success: true, message: '已退出团队' })
    }
  } catch (error) {
    console.error('Leave team error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})