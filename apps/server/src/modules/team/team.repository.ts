/**
 * Team Module - Repository Layer
 * 团队模块数据访问层
 */

import { prisma } from '../../prisma'
import logger from '../../lib/logger'
import type {
  MemberType,
  MemberRole,
  MemberStatus,
  TeamMemberBase,
  TeamBase,
  TeamOperationLogParams
} from './team.types'

/**
 * 团队数据访问层
 * 封装所有数据库操作，不包含业务逻辑
 */
export class TeamRepository {
  // ==================== 团队查询 ====================

  /**
   * 根据 ID 查找团队
   */
  async findById(id: string) {
    return prisma.team.findUnique({
      where: { id },
      include: {
        School: {
          select: {
            id: true,
            name: true,
            educationSystem: true,
            schoolType: true
          }
        },
        TeamMember: {
          where: { status: 'active' }
        }
      }
    })
  }

  /**
   * 查找团队列表
   */
  async findMany(params: {
    where: Record<string, unknown>
    skip: number
    take: number
  }) {
    return prisma.team.findMany({
      where: params.where,
      include: {
        School: { select: { id: true, name: true } },
        TeamMember: {
          where: { status: 'active' },
          select: {
            id: true,
            userId: true,
            userType: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: params.skip,
      take: params.take
    })
  }

  /**
   * 统计团队数量
   */
  async count(where: Record<string, unknown>): Promise<number> {
    return prisma.team.count({ where })
  }

  /**
   * 查找学校的公开团队
   */
  async findBySchool(schoolId: string) {
    return prisma.team.findMany({
      where: {
        schoolId,
        isPublic: true
      },
      include: {
        School: { select: { id: true, name: true } },
        TeamMember: {
          where: { status: 'active', role: 'owner' },
          select: { id: true, userId: true, userType: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  // ==================== 团队创建/更新/删除 ====================

  /**
   * 创建团队
   */
  async create(data: {
    name: string
    description?: string
    schoolId: string
    isPublic: boolean
  }) {
    return prisma.team.create({
      data: {
        id: crypto.randomUUID(),
        name: data.name,
        description: data.description,
        schoolId: data.schoolId,
        isPublic: data.isPublic
      },
      include: {
        School: { select: { id: true, name: true } }
      }
    })
  }

  /**
   * 更新团队
   */
  async update(id: string, data: {
    name?: string
    description?: string
    isPublic?: boolean
    announcement?: string
    avatar?: string
  }) {
    return prisma.team.update({
      where: { id },
      data,
      include: {
        School: { select: { id: true, name: true } }
      }
    })
  }

  /**
   * 删除团队
   */
  async delete(id: string) {
    return prisma.team.delete({
      where: { id }
    })
  }

  // ==================== 成员查询 ====================

  /**
   * 查找团队成员
   */
  async findMember(params: {
    teamId: string
    userId: string
    userType: MemberType
  }) {
    return prisma.teamMember.findUnique({
      where: {
        teamId_userId_userType: {
          teamId: params.teamId,
          userId: params.userId,
          userType: params.userType
        }
      }
    })
  }

  /**
   * 根据团队和用户查找成员记录（不需要 userType）
   */
  async findMemberByUserAndTeam(teamId: string, userId: string) {
    return prisma.teamMember.findFirst({
      where: { teamId, userId, status: 'active' }
    })
  }

  /**
   * 根据ID查找成员记录
   */
  async findMemberById(id: string) {
    return prisma.teamMember.findUnique({
      where: { id }
    })
  }

  /**
   * 查找团队成员列表
   */
  async findMembers(teamId: string, filters?: {
    status?: MemberStatus
    role?: MemberRole
    userType?: MemberType
  }) {
    return prisma.teamMember.findMany({
      where: {
        teamId,
        ...filters
      },
      orderBy: { joinedAt: 'desc' }
    })
  }

  /**
   * 查找团队成员列表（别名，用于批量操作）
   */
  async findMembersByTeam(teamId: string) {
    return prisma.teamMember.findMany({
      where: { teamId }
    })
  }

  /**
   * 批量查询学生
   */
  async findStudentsByIds(ids: string[]) {
    return prisma.student.findMany({
      where: { id: { in: ids } }
    })
  }

  /**
   * 批量查询教师
   */
  async findTeachersByIds(ids: string[]) {
    return prisma.teacher.findMany({
      where: { id: { in: ids } }
    })
  }

  /**
   * 根据用户ID查找成员关系
   * 注意：userId 是 teacher.id 或 student.id，不是 user.userId
   */
  async findMembersByUser(userId: string, userType?: MemberType, status?: MemberStatus) {
    return prisma.teamMember.findMany({
      where: {
        userId,
        ...(userType && { userType }),
        ...(status && { status })
      },
      orderBy: { joinedAt: 'desc' }
    })
  }

  /**
   * 查找团队所有者
   */
  async findOwner(teamId: string) {
    return prisma.teamMember.findFirst({
      where: { teamId, role: 'owner' }
    })
  }

  /**
   * 查找团队管理员列表
   */
  async findAdmins(teamId: string) {
    return prisma.teamMember.findMany({
      where: { teamId, role: 'admin', status: 'active' }
    })
  }

  /**
   * 统计成员数量
   */
  async countMembers(teamId: string, excludeUserId?: string): Promise<number> {
    return prisma.teamMember.count({
      where: {
        teamId,
        status: 'active',
        ...(excludeUserId && { userId: { not: excludeUserId } })
      }
    })
  }

  /**
   * 统计用户的团队数量（作为所有者）
   */
  async countUserOwnedTeams(userId: string, userType: MemberType): Promise<number> {
    return prisma.teamMember.count({
      where: { userId, userType, role: 'owner' }
    })
  }

  /**
   * 查找用户所属的团队ID列表
   */
  async findUserTeamIds(userId: string, userType: MemberType, status: MemberStatus = 'active') {
    const memberships = await prisma.teamMember.findMany({
      where: { userId, userType, status },
      select: { teamId: true }
    })
    return memberships.map(m => m.teamId)
  }

  /**
   * 查找用户收到的待处理邀请
   * 注意：invitedBy为空的是用户主动申请加入的记录，不应显示为邀请
   */
  async findUserPendingInvites(userId: string, userType: MemberType) {
    return prisma.teamMember.findMany({
      where: {
        userId,
        userType,
        status: 'pending',
        invitedBy: { not: null }  // 只返回真正的邀请，排除申请记录
      },
      orderBy: { joinedAt: 'desc' }
    })
  }

  /**
   * 查找用户作为管理员的团队
   */
  async findUserAdminTeams(userId: string, userType: MemberType) {
    return prisma.teamMember.findMany({
      where: { userId, userType, role: 'admin', status: 'active' },
      orderBy: { joinedAt: 'desc' }
    })
  }

  /**
   * 查找用户作为普通成员的团队
   */
  async findUserMemberTeams(userId: string, userType: MemberType) {
    return prisma.teamMember.findMany({
      where: { userId, userType, role: 'member', status: 'active' },
      orderBy: { joinedAt: 'desc' }
    })
  }

  /**
   * 查找用户收到的管理员邀请（role=admin, status=pending, invitedBy不为空）
   * 注意：invitedBy为空的是用户主动申请加入的记录，不应显示为邀请
   */
  async findUserAdminInvites(userId: string, userType: MemberType) {
    return prisma.teamMember.findMany({
      where: {
        userId,
        userType,
        role: 'admin',
        status: 'pending',
        invitedBy: { not: null }  // 只返回真正的邀请，排除申请记录
      },
      orderBy: { joinedAt: 'desc' }
    })
  }

  /**
   * 查找用户收到的普通成员邀请（role=member, status=pending, invitedBy不为空）
   * 注意：invitedBy为空的是用户主动申请加入的记录，不应显示为邀请
   */
  async findUserMemberInvites(userId: string, userType: MemberType) {
    return prisma.teamMember.findMany({
      where: {
        userId,
        userType,
        role: 'member',
        status: 'pending',
        invitedBy: { not: null }  // 只返回真正的邀请，排除申请记录
      },
      orderBy: { joinedAt: 'desc' }
    })
  }

  // ==================== 成员创建/更新/删除 ====================

  /**
   * 创建成员记录
   */
  async createMember(data: {
    teamId: string
    userId: string
    userType: MemberType
    role: MemberRole
    status: MemberStatus
    invitedBy?: string
  }) {
    return prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: data.teamId,
        userId: data.userId,
        userType: data.userType,
        role: data.role,
        status: data.status,
        invitedBy: data.invitedBy || null,
        joinedAt: new Date()
      }
    })
  }

  /**
   * 批量创建成员
   */
  async createMembers(members: Array<{
    teamId: string
    userId: string
    userType: MemberType
    role: MemberRole
    status: MemberStatus
    invitedBy?: string
  }>) {
    const data = members.map(m => ({
      id: crypto.randomUUID(),
      teamId: m.teamId,
      userId: m.userId,
      userType: m.userType,
      role: m.role,
      status: m.status,
      invitedBy: m.invitedBy || null,
      joinedAt: new Date()
    }))
    return prisma.teamMember.createMany({ data })
  }

  /**
   * 更新成员记录
   */
  async updateMember(id: string, data: {
    role?: MemberRole
    status?: MemberStatus
  }) {
    return prisma.teamMember.update({
      where: { id },
      data
    })
  }

  /**
   * 更新成员状态
   */
  async updateMemberStatus(id: string, status: MemberStatus) {
    return prisma.teamMember.update({
      where: { id },
      data: { status, joinedAt: new Date() }
    })
  }

  /**
   * 条件更新成员状态（并发安全）
   * 只有当前状态为 pending 时才更新，返回受影响的行数
   * 用于处理审批时的竞态条件
   */
  async updateMemberStatusIfPending(id: string, status: MemberStatus): Promise<number> {
    const result = await prisma.teamMember.updateMany({
      where: { id, status: 'pending' },
      data: { status, joinedAt: new Date() }
    })
    return result.count
  }

  /**
   * 更新成员角色
   */
  async updateMemberRole(id: string, role: MemberRole) {
    return prisma.teamMember.update({
      where: { id },
      data: { role }
    })
  }

  /**
   * 删除成员记录
   */
  async deleteMember(id: string) {
    return prisma.teamMember.delete({
      where: { id }
    })
  }

  /**
   * 条件删除成员记录（并发安全）
   * 只有当前状态为 pending 时才删除，返回受影响的行数
   * 用于处理拒绝申请时的竞态条件
   */
  async deleteMemberIfPending(id: string): Promise<number> {
    const result = await prisma.teamMember.deleteMany({
      where: { id, status: 'pending' }
    })
    return result.count
  }

  /**
   * 批量删除成员
   */
  async deleteMembers(where: Record<string, unknown>) {
    return prisma.teamMember.deleteMany({ where })
  }

  /**
   * Upsert 成员记录
   */
  async upsertMember(params: {
    teamId: string
    userId: string
    userType: MemberType
    create: {
      role: MemberRole
      status: MemberStatus
      invitedBy?: string
    }
    update: {
      status: MemberStatus
      invitedBy?: string
    }
  }) {
    return prisma.teamMember.upsert({
      where: {
        teamId_userId_userType: {
          teamId: params.teamId,
          userId: params.userId,
          userType: params.userType
        }
      },
      create: {
        id: crypto.randomUUID(),
        teamId: params.teamId,
        userId: params.userId,
        userType: params.userType,
        role: params.create.role,
        status: params.create.status,
        invitedBy: params.create.invitedBy || null,
        joinedAt: new Date()
      },
      update: {
        status: params.update.status,
        invitedBy: params.update.invitedBy || null,
        joinedAt: new Date()
      }
    })
  }

  // ==================== 加入申请 ====================

  /**
   * 查找加入申请
   */
  async findJoinRequest(params: { teamId: string; userId: string }) {
    return prisma.teamJoinRequest.findUnique({
      where: {
        teamId_userId: params
      }
    })
  }

  /**
   * 根据ID查找加入申请
   */
  async findJoinRequestById(id: string) {
    return prisma.teamJoinRequest.findUnique({
      where: { id }
    })
  }

  /**
   * 创建加入申请
   */
  async createJoinRequest(data: {
    teamId: string
    userId: string
    message?: string
  }) {
    return prisma.teamJoinRequest.create({
      data: {
        id: crypto.randomUUID(),
        teamId: data.teamId,
        userId: data.userId,
        message: data.message
      }
    })
  }

  /**
   * 更新加入申请状态
   */
  async updateJoinRequest(id: string, data: {
    status: 'approved' | 'rejected'
    processedAt: Date
    processedBy: string
  }) {
    return prisma.teamJoinRequest.update({
      where: { id },
      data
    })
  }

  /**
   * 条件更新加入申请状态（并发安全）
   * 只有当前状态为 pending 时才更新，返回受影响的行数
   * 用于处理审批时的竞态条件
   */
  async updateJoinRequestIfPending(id: string, data: {
    status: 'approved' | 'rejected'
    processedAt: Date
    processedBy: string
  }): Promise<number> {
    const result = await prisma.teamJoinRequest.updateMany({
      where: { id, status: 'pending' },
      data
    })
    return result.count
  }

  /**
   * 查找团队的加入申请列表
   */
  async findJoinRequests(teamId: string) {
    return prisma.teamJoinRequest.findMany({
      where: { teamId, status: 'pending' },
      include: {
        Student: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  // ==================== 审计日志 ====================

  /**
   * 记录团队操作审计日志
   */
  async logOperation(params: TeamOperationLogParams) {
    try {
      await prisma.teamOperationLog.create({
        data: {
          id: crypto.randomUUID(),
          teamId: params.teamId,
          operatorId: params.operatorId,
          operatorType: params.operatorType,
          action: params.action,
          targetId: params.targetId,
          targetType: params.targetType,
          oldValue: params.oldValue,
          newValue: params.newValue,
          metadata: params.metadata ? JSON.stringify(params.metadata) : null
        }
      })
    } catch (error) {
      logger.error('team_operation_log_error', error, {
        action: 'log_team_operation',
        metadata: { teamId: params.teamId, action: params.action }
      })
    }
  }

  // ==================== 事务支持 ====================

  /**
   * 执行事务
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn)
  }

  // ==================== 用户查询 ====================

  /**
   * 查找教师
   */
  async findTeacher(id: string) {
    return prisma.teacher.findUnique({
      where: { id },
      select: { id: true, name: true, avatar: true, title: true, schoolId: true }
    })
  }

  /**
   * 查找学生
   */
  async findStudent(id: string) {
    return prisma.student.findUnique({
      where: { id },
      select: { id: true, name: true, avatar: true, rating: true, enrollmentYear: true, schoolId: true }
    })
  }

  /**
   * 查找用户
   */
  async findUser(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: { Teacher: true, Student: true }
    })
  }

  /**
   * 查找用户头像
   */
  async findUserAvatar(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true }
    })
  }

  /**
   * 批量查找教师
   */
  async findTeachers(ids: string[]) {
    return prisma.teacher.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, avatar: true, title: true, schoolId: true }
    })
  }

  /**
   * 批量查找学生
   */
  async findStudents(ids: string[]) {
    return prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, avatar: true, rating: true, enrollmentYear: true, schoolId: true }
    })
  }

  /**
   * 查找可邀请的成员
   */
  async findAvailableMembers(params: {
    schoolId: string
    excludeTeacherIds: string[]
    excludeStudentIds: string[]
    keyword?: string
    type?: MemberType
  }) {
    const result: { students: unknown[]; teachers: unknown[] } = {
      students: [],
      teachers: []
    }

    // 搜索学生
    if (!params.type || params.type === 'student') {
      const students = await prisma.student.findMany({
        where: {
          schoolId: params.schoolId,
          id: { notIn: params.excludeStudentIds },
          ...(params.keyword && { name: { contains: params.keyword } })
        },
        select: { id: true, name: true, avatar: true },
        take: 20
      })
      const studentIds = students.filter(s => s.id).map(s => s.id!)
      const studentUsers = studentIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, username: true, avatar: true } })
        : []
      const studentUserMap = new Map(studentUsers.map(u => [u.id, u]))
      result.students = students.map(s => {
        const user = s.id ? studentUserMap.get(s.id) : undefined
        return {
          id: s.id,
          name: s.name,
          avatar: user?.avatar || s.avatar,
          username: user?.username || ''
        }
      })
    }

    // 搜索教师
    if (!params.type || params.type === 'teacher') {
      const teachers = await prisma.teacher.findMany({
        where: {
          schoolId: params.schoolId,
          id: { notIn: params.excludeTeacherIds },
          ...(params.keyword && { name: { contains: params.keyword } })
        },
        select: { id: true, name: true, avatar: true },
        take: 20
      })
      const teacherIds = teachers.map(t => t.id)
      const teacherUsers = teacherIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, username: true, avatar: true } })
        : []
      const teacherUserMap = new Map(teacherUsers.map(u => [u.id, u]))
      result.teachers = teachers.map(t => {
        const user = teacherUserMap.get(t.id)
        return {
          id: t.id,
          name: t.name,
          avatar: user?.avatar || t.avatar,
          username: user?.username || ''
        }
      })
    }

    return result
  }

  /**
   * 根据用户名查找用户
   */
  async findUserByUsername(username: string) {
    return prisma.user.findUnique({
      where: { username },
      include: { Student: true, Teacher: true }
    })
  }
}

// 导出单例
export const teamRepository = new TeamRepository()