/**
 * Team Module - Service Layer
 * 团队模块业务逻辑层
 */

import logger from '../../lib/logger'
import type { JwtPayload } from '@oi-manager/shared'
import { teamRepository, TeamRepository } from './team.repository'
import { getUserName, getMemberDetails, getMemberDetailsBatch, formatTeamLimitMessage, formatNewOwnerLimitMessage, transformTeamForFrontend, transformTeamsForFrontend } from './team.utils'
import type {
  MemberType,
  MemberRole,
  MemberStatus,
  TeamAdminCheck,
  MemberRoleCheck,
  InviteMembersResult,
  TeamListItem,
  TeamDetail,
  CreateTeamDTO,
  UpdateTeamDTO,
  TransferTeamDTO,
  InviteMembersDTO,
  JoinRequestDTO
} from './team.types'

/**
 * 团队业务逻辑层
 * 负责：业务规则、事务协调、权限调用
 */
export class TeamService {
  constructor(private readonly repo: TeamRepository) {}

  // ==================== 权限检查 ====================

  /**
   * 检查用户在团队中的角色
   */
  async getMemberRole(teamId: string, user: JwtPayload): Promise<MemberRoleCheck> {
    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      return { role: null, memberId: null }
    }

    const member = await this.repo.findMember({ teamId, userId, userType })

    if (!member) {
      return { role: null, memberId: null }
    }

    return { role: member.role as MemberRole, memberId: member.id }
  }

  /**
   * 检查用户是否是团队管理员（所有者或管理员）
   */
  async isTeamAdmin(teamId: string, user: JwtPayload): Promise<TeamAdminCheck> {
    const { role } = await this.getMemberRole(teamId, user)
    return {
      isOwner: role === 'owner',
      isAdmin: role === 'owner' || role === 'admin'
    }
  }

  /**
   * 验证是否是团队成员
   */
  async assertTeamMember(teamId: string, user: JwtPayload): Promise<{ memberId: string } | never> {
    const { role, memberId } = await this.getMemberRole(teamId, user)
    if (!role) {
      throw new Error('NOT_MEMBER')
    }
    return { memberId: memberId! }
  }

  /**
   * 验证是否是团队管理员
   */
  async assertTeamAdmin(teamId: string, user: JwtPayload): Promise<void> {
    const { isAdmin } = await this.isTeamAdmin(teamId, user)
    if (!isAdmin) {
      throw new Error('NOT_ADMIN')
    }
  }

  /**
   * 验证是否是团队所有者
   */
  async assertTeamOwner(teamId: string, user: JwtPayload): Promise<void> {
    const { isOwner } = await this.isTeamAdmin(teamId, user)
    if (!isOwner) {
      throw new Error('NOT_OWNER')
    }
  }

  // ==================== 团队列表查询 ====================

  /**
   * 获取学校团队列表
   */
  async getSchoolTeams(schoolId: string, user: JwtPayload) {
    const teams = await this.repo.findBySchool(schoolId)

    // 批量加载所有者信息
    const ownerInfos = teams.map(team => {
      const owner = team.TeamMember[0]
      return owner ? { teamId: team.id, userId: owner.userId, userType: owner.userType } : null
    }).filter(Boolean) as Array<{ teamId: string; userId: string; userType: string }>

    const teacherIds = ownerInfos.filter(o => o.userType === 'teacher').map(o => o.userId)
    const studentIds = ownerInfos.filter(o => o.userType === 'student').map(o => o.userId)

    const [teachers, students] = await Promise.all([
      this.repo.findTeachers(teacherIds),
      this.repo.findStudents(studentIds)
    ])

    const teacherNameMap = new Map(teachers.map(t => [t.id, t.name]))
    const studentNameMap = new Map(students.map(s => [s.id, s.name]))

    // 组装结果
    let teamsWithStatus = teams.map(team => {
      const owner = team.TeamMember[0]
      const ownerName = owner
        ? (owner.userType === 'teacher'
            ? teacherNameMap.get(owner.userId)
            : studentNameMap.get(owner.userId)) || '未知'
        : '未知'

      return {
        ...team,
        owner: { id: owner?.userId || '', name: ownerName }
      }
    })

    // 如果是学生，检查申请状态
    if (user.studentId) {
      const joinRequests = await this.repo.findJoinRequests(user.studentId)
        .then(requests => requests.filter(r => teams.some(t => t.id === r.teamId)))

      const requestMap = new Map(joinRequests.map(r => [r.teamId, r.status]))

      const memberRecords = await this.repo.findMembersByUser(user.studentId, 'student')

      const memberMap = new Map(memberRecords.map(m => [m.teamId, m.status]))

      teamsWithStatus = teamsWithStatus.map(team => ({
        ...team,
        memberStatus: memberMap.get(team.id) || null,
        requestStatus: requestMap.get(team.id) || null
      }))
    }

    return teamsWithStatus.map(transformTeamForFrontend)
  }

  /**
   * 获取学生的团队列表
   */
  async getStudentTeams(studentId: string) {
    const memberRecords = await this.repo.findMembersByUser(studentId, 'student')
    logger.info('getStudentTeams_debug', { studentId, memberCount: memberRecords.length } as any)

    // 批量加载团队信息
    const teamIds = memberRecords.map(r => r.teamId)
    const teams = await Promise.all(teamIds.map(id => this.repo.findById(id)))
    const teamMap = new Map(teams.filter(Boolean).map(t => [t!.id, t!]))

    // 批量加载所有者信息
    const ownerInfos: Array<{ teamId: string; userId: string; userType: string }> = []
    for (const team of teams.filter(Boolean)) {
      const owner = team!.TeamMember.find(m => m.role === 'owner')
      if (owner) {
        ownerInfos.push({ teamId: team!.id, userId: owner.userId, userType: owner.userType })
      }
    }

    const teacherIds = ownerInfos.filter(o => o.userType === 'teacher').map(o => o.userId)
    const studentIds = ownerInfos.filter(o => o.userType === 'student').map(o => o.userId)

    const [teachers, students] = await Promise.all([
      this.repo.findTeachers(teacherIds),
      this.repo.findStudents(studentIds)
    ])

    const teacherNameMap = new Map(teachers.map(t => [t.id, t.name]))
    const studentNameMap = new Map(students.map(s => [s.id, s.name]))

    // 分类：已加入、邀请（invitedBy != null）、申请（invitedBy == null）
    const joinedTeams: Record<string, unknown>[] = []
    const pendingInvitations: Record<string, unknown>[] = []
    const pendingRequests: Record<string, unknown>[] = []

    for (const record of memberRecords) {
      const team = teamMap.get(record.teamId)
      if (!team) continue

      const owner = team.TeamMember.find(m => m.role === 'owner')
      const ownerName = owner
        ? (owner.userType === 'teacher'
            ? teacherNameMap.get(owner.userId)
            : studentNameMap.get(owner.userId)) || '未知'
        : '未知'

      const teamWithInfo = {
        ...team,
        owner: { id: owner?.userId || '', name: ownerName },
        memberRole: record.role,
        joinedAt: record.joinedAt
      }

      if (record.status === 'active') {
        joinedTeams.push(teamWithInfo)
      } else if (record.status === 'pending') {
        // 区分邀请和申请：invitedBy != null 为邀请，invitedBy == null 为申请
        if (record.invitedBy !== null) {
          // 实际邀请：管理员邀请学生加入
          pendingInvitations.push({
            ...teamWithInfo,
            invitationId: record.id,
            invitationType: record.role === 'admin' ? 'admin' : 'member'
          })
        } else {
          // 申请记录：学生主动申请加入，需要管理员审批
          pendingRequests.push({
            ...teamWithInfo,
            requestId: record.id,
            requestType: record.role === 'admin' ? 'admin' : 'member'
          })
        }
      }
    }

    return {
      joined: joinedTeams.map(transformTeamForFrontend),
      pending: pendingInvitations.map(transformTeamForFrontend),
      requests: pendingRequests.map(transformTeamForFrontend)
    }
  }

  /**
   * 获取团队列表（教师用）
   */
  async getTeamList(params: {
    schoolId?: string
    page: number
    pageSize: number
    view?: string
    user: JwtPayload
  }) {
    const { schoolId, page, pageSize, view, user } = params

    const userId = user.studentId || user.teacherId
    const userType = user.studentId ? 'student' : 'teacher'

    const where: Record<string, unknown> = {}
    if (schoolId) where.schoolId = schoolId

    // 构建过滤条件
    if (view === 'mine') {
      if (!userId || userId === 'undefined' || userId === 'null') {
        return {
          list: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0
        }
      }

      const myTeamIds = await this.repo.findUserTeamIds(userId, userType)
      where.id = { in: myTeamIds }
    } else if (schoolId && !view) {
      // 学校团队页面：显示该学校的所有团队
    } else {
      // 全部团队：只显示公有，且排除自己已加入的
      where.isPublic = true

      if (userId && userId !== 'undefined' && userId !== 'null') {
        const myTeamIds = await this.repo.findUserTeamIds(userId, userType)
        if (myTeamIds.length > 0) {
          where.id = { notIn: myTeamIds }
        }
      }
    }

    const skip = (page - 1) * pageSize

    const [allTeams, total] = await Promise.all([
      this.repo.findMany({ where, skip, take: pageSize }),
      this.repo.count(where)
    ])

    // 批量加载所有者信息
    const ownerInfos = allTeams.map(team => {
      const owner = team.TeamMember.find(m => m.role === 'owner')
      return owner ? { teamId: team.id, userId: owner.userId, userType: owner.userType } : null
    }).filter(Boolean) as Array<{ teamId: string; userId: string; userType: string }>

    const teacherIds = ownerInfos.filter(o => o.userType === 'teacher').map(o => o.userId)
    const studentIds = ownerInfos.filter(o => o.userType === 'student').map(o => o.userId)

    const [teachers, students] = await Promise.all([
      this.repo.findTeachers(teacherIds),
      this.repo.findStudents(studentIds)
    ])

    const teacherNameMap = new Map(teachers.map(t => [t.id, t.name]))
    const studentNameMap = new Map(students.map(s => [s.id, s.name]))

    // 组装结果
    const teamsWithOwner = allTeams.map(team => {
      const owner = team.TeamMember.find(m => m.role === 'owner')
      const ownerName = owner
        ? (owner.userType === 'teacher'
            ? teacherNameMap.get(owner.userId)
            : studentNameMap.get(owner.userId)) || '未知'
        : '未知'

      const adminsCount = team.TeamMember.filter(m => m.role === 'admin').length
      const teacherMembersCount = team.TeamMember.filter(
        m => m.userType === 'teacher' && m.role === 'member'
      ).length

      return {
        ...team,
        owner: { id: owner?.userId || '', name: ownerName },
        _count: {
          members: team.TeamMember.length,
          admins: adminsCount,
          teacherMembers: teacherMembersCount
        }
      }
    })

    return {
      list: teamsWithOwner.map(transformTeamForFrontend),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  // ==================== 团队详情 ====================

  /**
   * 获取团队详情
   */
  async getTeamDetail(teamId: string, user: JwtPayload) {
    const team = await this.repo.findById(teamId)

    if (!team) {
      throw new Error('TEAM_NOT_FOUND')
    }

    // 私有团队权限检查
    if (!team.isPublic) {
      const { role } = await this.getMemberRole(teamId, user)
      if (!role) {
        throw new Error('NOT_MEMBER')
      }
    }

    // 整理成员信息
    const owner = team.TeamMember.find(m => m.role === 'owner')
    const admins = team.TeamMember.filter(m => m.role === 'admin')
    const members = team.TeamMember.filter(m => m.role === 'member')

    const ownerInfo = owner ? await getMemberDetails(owner.userId, owner.userType as MemberType) : null
    const adminsInfo = await Promise.all(admins.map(a => getMemberDetails(a.userId, a.userType as MemberType)))

    const teachersInfo = await Promise.all(
      members
        .filter(m => m.userType === 'teacher')
        .map(async m => {
          const details = await getMemberDetails(m.userId, m.userType as MemberType)
          return details ? { ...details, joinedAt: m.joinedAt } : null
        })
    )

    const studentsInfo = await Promise.all(
      members
        .filter(m => m.userType === 'student')
        .map(async m => {
          const details = await getMemberDetails(m.userId, m.userType as MemberType)
          return details ? { ...details, joinedAt: m.joinedAt } : null
        })
    )

    // 查询 pending 状态的教师请求
    const pendingTeachers = await this.repo.findMembers(teamId, { status: 'pending', userType: 'teacher' })
      .then(members => members.filter(m => !m.invitedBy))

    const pendingTeachersInfo = await Promise.all(
      pendingTeachers.map(async m => {
        const details = await getMemberDetails(m.userId, m.userType as MemberType)
        return details ? { ...details, memberId: m.id, requestedAt: m.joinedAt } : null
      })
    )

    return transformTeamForFrontend({
      ...team,
      owner: ownerInfo,
      admins: adminsInfo.filter(Boolean),
      teachers: teachersInfo.filter(Boolean),
      students: studentsInfo.filter(Boolean),
      pendingTeachers: pendingTeachersInfo.filter(Boolean)
    })
  }

  // ==================== 团队创建/更新/删除 ====================

  /**
   * 创建团队
   */
  async createTeam(dto: CreateTeamDTO, user: JwtPayload) {
    const userId = user.userId

    // 获取当前用户信息
    const fullUser = await this.repo.findUser(userId)

    if (!fullUser) {
      throw new Error('USER_NOT_FOUND')
    }

    let ownerId: string
    let ownerType: MemberType
    let schoolId: string | null = null
    const maxTeams = fullUser.Teacher ? 50 : 5

    // 检查用户类型并获取学校
    if (fullUser.Teacher) {
      ownerId = fullUser.Teacher.id
      ownerType = 'teacher'
      schoolId = fullUser.Teacher.schoolId
    } else if (fullUser.Student) {
      ownerId = fullUser.Student.id
      ownerType = 'student'
      schoolId = fullUser.Student.schoolId
    } else {
      throw new Error('NOT_TEACHER_OR_STUDENT')
    }

    if (!schoolId) {
      throw new Error('NO_SCHOOL')
    }

    // 使用事务创建团队和所有者成员记录
    const team = await this.repo.transaction(async (tx) => {
      // 在事务内检查数量限制
      const existingTeams = await tx.teamMember.count({
        where: { userId: ownerId, userType: ownerType, role: 'owner' }
      })
      if (existingTeams >= maxTeams) {
        throw new Error('TEAM_LIMIT_EXCEEDED')
      }

      const newTeam = await tx.team.create({
        data: {
          id: dto.id,
          name: dto.name,
          description: dto.description,
          schoolId,
          isPublic: dto.isPublic !== undefined ? dto.isPublic : true
        },
        include: {
          School: { select: { id: true, name: true } }
        }
      })

      await tx.teamMember.create({
        data: {
          id: crypto.randomUUID(),
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

    return transformTeamForFrontend(team)
  }

  /**
   * 更新团队基本信息
   */
  async updateTeam(teamId: string, dto: UpdateTeamDTO, user: JwtPayload) {
    const { isOwner, isAdmin } = await this.isTeamAdmin(teamId, user)
    if (!isAdmin) {
      throw new Error('NOT_ADMIN')
    }

    // 只有所有者可以修改 isPublic
    if (dto.isPublic !== undefined && !isOwner) {
      throw new Error('NOT_OWNER')
    }

    const updatedTeam = await this.repo.update(teamId, {
      name: dto.name,
      description: dto.description,
      ...(dto.isPublic !== undefined && { isPublic: dto.isPublic })
    })

    // 获取所有者信息
    const ownerMember = await this.repo.findOwner(teamId)
    const ownerName = ownerMember ? await getUserName(ownerMember.userId, ownerMember.userType as MemberType) : '未知'

    return transformTeamForFrontend({ ...updatedTeam, owner: { id: ownerMember?.userId || '', name: ownerName } })
  }

  /**
   * 更新团队公告
   */
  async updateAnnouncement(teamId: string, announcement: string, user: JwtPayload) {
    await this.assertTeamAdmin(teamId, user)
    return this.repo.update(teamId, { announcement })
  }

  /**
   * 删除团队
   */
  async deleteTeam(teamId: string, user: JwtPayload) {
    await this.assertTeamOwner(teamId, user)

    // 检查是否有其他成员
    const memberCount = await this.repo.countMembers(teamId, user.teacherId || user.studentId)
    if (memberCount > 0) {
      throw new Error('HAS_OTHER_MEMBERS')
    }

    await this.repo.delete(teamId)

    // 记录审计日志
    const callerId = user.teacherId || user.studentId
    const callerType = user.teacherId ? 'teacher' : 'student'
    await this.repo.logOperation({
      teamId,
      operatorId: callerId || '',
      operatorType: callerType as MemberType,
      action: 'team_delete'
    })

    logger.audit('team_delete', {
      userId: user.userId,
      action: 'team_delete',
      target: teamId
    })
  }

  // ==================== 成员管理 ====================

  /**
   * 邀请成员
   */
  async inviteMembers(teamId: string, dto: InviteMembersDTO, user: JwtPayload) {
    await this.assertTeamAdmin(teamId, user)

    const team = await this.repo.findById(teamId)
    if (!team) {
      throw new Error('TEAM_NOT_FOUND')
    }

    const invitedBy = user.teacherId || user.studentId || ''

    const result: InviteMembersResult = {
      invited: [],
      notFound: [],
      notSameSchool: [],
      alreadyMember: []
    }

    const targetMembers: Array<{ id: string; type: MemberType }> = []

    // 处理统一的 members 参数
    if (dto.members && Array.isArray(dto.members)) {
      for (const member of dto.members) {
        if (typeof member === 'object' && member.id && member.type) {
          targetMembers.push({ id: member.id, type: member.type })
        }
      }
    }

    // 如果提供了用户名，查找对应的学生或教师
    if (dto.usernames && Array.isArray(dto.usernames) && dto.usernames.length > 0) {
      for (const username of dto.usernames) {
        const trimmedUsername = username.trim()
        if (!trimmedUsername) continue

        const foundUser = await this.repo.findUserByUsername(trimmedUsername)

        if (!foundUser) {
          result.notFound.push(trimmedUsername)
          continue
        }

        if (foundUser.Student) {
          if (foundUser.Student.schoolId !== team.schoolId) {
            result.notSameSchool.push(trimmedUsername)
            continue
          }
          targetMembers.push({ id: foundUser.Student.id, type: 'student' })
        } else if (foundUser.Teacher) {
          if (foundUser.Teacher.schoolId !== team.schoolId) {
            result.notSameSchool.push(trimmedUsername)
            continue
          }
          targetMembers.push({ id: foundUser.Teacher.id, type: 'teacher' })
        } else {
          result.notFound.push(trimmedUsername)
        }
      }
    }

    // 统一处理成员邀请
    for (const member of targetMembers) {
      const { id: memberId, type: memberType } = member

      // 检查是否已是成员
      const existing = await this.repo.findMember({ teamId, userId: memberId, userType: memberType })

      if (existing) {
        result.alreadyMember.push(memberId)
        continue
      }

      // 检查成员是否属于本校
      const memberUser = memberType === 'teacher'
        ? await this.repo.findTeacher(memberId)
        : await this.repo.findStudent(memberId)

      if (!memberUser || memberUser.schoolId !== team.schoolId) {
        result.notSameSchool.push(memberId)
        continue
      }

      // 创建邀请
      await this.repo.createMember({
        teamId,
        userId: memberId,
        userType: memberType,
        role: dto.role === 'admin' ? 'admin' : 'member',
        status: 'pending',
        invitedBy
      })
      result.invited.push(memberId)
    }

    // 记录邀请审计日志
    if (result.invited.length > 0) {
      const callerId = user.teacherId || user.studentId
      const callerType = user.teacherId ? 'teacher' : 'student'
      await this.repo.logOperation({
        teamId,
        operatorId: callerId || '',
        operatorType: callerType as MemberType,
        action: 'invite_send',
        metadata: { invitedCount: result.invited.length, role: dto.role }
      })
    }

    return result
  }

  /**
   * 直接添加成员（不需要学生确认）
   * 用于团队导入等场景，支持批量操作
   */
  async addMembersDirectly(
    teamId: string,
    members: Array<{ id: string; type: MemberType }>,
    role: MemberRole = 'member',
    user: JwtPayload
  ): Promise<{ added: string[]; alreadyMember: string[]; notSameSchool: string[] }> {
    await this.assertTeamAdmin(teamId, user)

    const team = await this.repo.findById(teamId)
    if (!team) {
      throw new Error('TEAM_NOT_FOUND')
    }

    const result = {
      added: [] as string[],
      alreadyMember: [] as string[],
      notSameSchool: [] as string[]
    }

    // 分离学生和教师
    const studentIds = members.filter(m => m.type === 'student').map(m => m.id)
    const teacherIds = members.filter(m => m.type === 'teacher').map(m => m.id)

    // 批量检查已有成员
    const existingMembers = await this.repo.findMembersByTeam(teamId)
    const existingUserIds = new Set(
      existingMembers.map(m => `${m.userId}-${m.userType}`)
    )

    // 批量获取学生和教师信息
    const students = studentIds.length > 0
      ? await this.repo.findStudentsByIds(studentIds)
      : []
    const teachers = teacherIds.length > 0
      ? await this.repo.findTeachersByIds(teacherIds)
      : []

    const studentMap = new Map(students.map(s => [s.id, s]))
    const teacherMap = new Map(teachers.map(t => [t.id, t]))

    // 收集要创建的成员
    const membersToCreate: Array<{
      teamId: string
      userId: string
      userType: MemberType
      role: MemberRole
      status: MemberStatus
      invitedBy?: string
    }> = []

    for (const member of members) {
      const { id: memberId, type: memberType } = member
      const key = `${memberId}-${memberType}`

      // 检查是否已是成员
      if (existingUserIds.has(key)) {
        result.alreadyMember.push(memberId)
        continue
      }

      // 检查成员是否属于本校
      const memberUser = memberType === 'student'
        ? studentMap.get(memberId)
        : teacherMap.get(memberId)

      if (!memberUser || memberUser.schoolId !== team.schoolId) {
        result.notSameSchool.push(memberId)
        continue
      }

      // 收集要创建的成员
      membersToCreate.push({
        teamId,
        userId: memberId,
        userType: memberType,
        role,
        status: 'active',
        invitedBy: user.teacherId || user.studentId
      })
      result.added.push(memberId)
    }

    // 批量创建成员
    if (membersToCreate.length > 0) {
      await this.repo.createMembers(membersToCreate)
    }

    // 记录审计日志
    if (result.added.length > 0) {
      const callerId = user.teacherId || user.studentId
      const callerType = user.teacherId ? 'teacher' : 'student'
      await this.repo.logOperation({
        teamId,
        operatorId: callerId || '',
        operatorType: callerType as MemberType,
        action: 'member_add',
        metadata: { addedCount: result.added.length, role, directAdd: true }
      })
    }

    return result
  }

  /**
   * 移除成员
   */
  async removeMember(teamId: string, memberId: string, memberType: MemberType | undefined, user: JwtPayload) {
    await this.assertTeamAdmin(teamId, user)

    let whereClause: Record<string, unknown>

    if (memberType) {
      whereClause = {
        teamId,
        userId: memberId,
        userType: memberType,
        role: 'member'
      }
    } else {
      whereClause = { teamId, id: memberId }
    }

    const result = await this.repo.deleteMembers(whereClause)

    if (result.count === 0) {
      throw new Error('MEMBER_NOT_FOUND')
    }

    // 记录审计日志
    const callerId = user.teacherId || user.studentId
    const callerType = user.teacherId ? 'teacher' : 'student'
    await this.repo.logOperation({
      teamId,
      operatorId: callerId || '',
      operatorType: callerType as MemberType,
      action: 'member_remove',
      targetId: memberId,
      targetType: memberType
    })
  }

  // ==================== 团队转移 ====================

  /**
   * 转移团队所有权
   */
  async transferTeam(teamId: string, dto: TransferTeamDTO, user: JwtPayload) {
    const callerId = user.teacherId || user.studentId
    const callerType = user.teacherId ? 'teacher' : 'student'
    const maxTeams = dto.newOwnerType === 'teacher' ? 50 : 5

    await this.repo.transaction(async (tx) => {
      // 1. 获取团队信息
      const currentTeam = await tx.team.findUnique({
        where: { id: teamId },
        select: { schoolId: true }
      })
      if (!currentTeam) {
        throw new Error('TEAM_NOT_FOUND')
      }

      // 2. 获取当前所有者并验证调用者身份
      const currentOwner = await tx.teamMember.findFirst({
        where: { teamId, role: 'owner' }
      })
      if (!currentOwner) {
        throw new Error('OWNER_NOT_FOUND')
      }
      if (currentOwner.userId !== callerId || currentOwner.userType !== callerType) {
        throw new Error('NOT_OWNER')
      }

      // 3. 验证新所有者是否存在且属于本校
      const newOwnerUser = dto.newOwnerType === 'teacher'
        ? await tx.teacher.findUnique({ where: { id: dto.newOwnerId }, select: { id: true, schoolId: true } })
        : await tx.student.findUnique({ where: { id: dto.newOwnerId }, select: { id: true, schoolId: true } })
      if (!newOwnerUser) {
        throw new Error('NEW_OWNER_NOT_FOUND')
      }
      if (newOwnerUser.schoolId !== currentTeam.schoolId) {
        throw new Error('NEW_OWNER_NOT_SAME_SCHOOL')
      }

      // 4. 检查新所有者团队数量限制
      const existingTeams = await tx.teamMember.count({
        where: { userId: dto.newOwnerId, userType: dto.newOwnerType, role: 'owner' }
      })
      if (existingTeams >= maxTeams) {
        throw new Error('NEW_OWNER_LIMIT_EXCEEDED')
      }

      // 5. 检查新所有者是否是团队成员
      const newOwnerMember = await tx.teamMember.findUnique({
        where: {
          teamId_userId_userType: {
            teamId,
            userId: dto.newOwnerId,
            userType: dto.newOwnerType
          }
        }
      })
      if (!newOwnerMember || newOwnerMember.status !== 'active') {
        throw new Error('NEW_OWNER_NOT_MEMBER')
      }

      // 6. 原子更新
      await tx.teamMember.update({
        where: { id: currentOwner.id },
        data: { role: 'admin' }
      })
      await tx.teamMember.update({
        where: { id: newOwnerMember.id },
        data: { role: 'owner' }
      })

      // 记录审计日志
      await tx.teamOperationLog.create({
        data: {
          teamId,
          operatorId: callerId,
          operatorType: callerType,
          action: 'ownership_transfer',
          targetId: dto.newOwnerId,
          targetType: dto.newOwnerType,
          oldValue: JSON.stringify({ oldOwnerId: callerId, oldOwnerType: callerType }),
          newValue: JSON.stringify({ newOwnerId: dto.newOwnerId, newOwnerType: dto.newOwnerType })
        }
      })
    })

    logger.audit('team_ownership_transfer', {
      userId: user.userId,
      action: 'ownership_transfer',
      target: teamId,
      metadata: { oldOwnerId: callerId, oldOwnerType: callerType, newOwnerId: dto.newOwnerId, newOwnerType: dto.newOwnerType }
    })
  }

  // ==================== 加入/退出 ====================

  /**
   * 申请加入团队
   */
  async joinRequest(teamId: string, dto: JoinRequestDTO, user: JwtPayload) {
    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      throw new Error('IDENTITY_NOT_FOUND')
    }

    const team = await this.repo.findById(teamId)

    if (!team) {
      throw new Error('TEAM_NOT_FOUND')
    }

    if (!team.isPublic) {
      throw new Error('PRIVATE_TEAM')
    }

    // 检查是否已是成员或已有待处理请求
    const existingMember = await this.repo.findMember({ teamId, userId, userType })

    if (existingMember) {
      if (existingMember.status === 'active') {
        throw new Error('ALREADY_MEMBER')
      } else {
        throw new Error('HAS_PENDING_REQUEST')
      }
    }

    // 对于学生，检查 TeamJoinRequest 表
    if (userType === 'student') {
      const existingRequest = await this.repo.findJoinRequest({ teamId, studentId: userId })

      if (existingRequest) {
        throw new Error('HAS_PENDING_REQUEST')
      }

      return this.repo.createJoinRequest({
        teamId,
        studentId: userId,
        message: dto.message
      })
    } else {
      // 教师创建 pending 状态的 TeamMember 记录
      return this.repo.createMember({
        teamId,
        userId,
        userType: 'teacher',
        role: 'member',
        status: 'pending'
      })
    }
  }

  /**
   * 退出团队
   */
  async leaveTeam(teamId: string, user: JwtPayload) {
    const userId = user.teacherId || user.studentId
    const userType = user.teacherId ? 'teacher' : 'student'

    if (!userId) {
      throw new Error('IDENTITY_NOT_FOUND')
    }

    const member = await this.repo.findMember({ teamId, userId, userType })

    if (!member) {
      throw new Error('NOT_MEMBER')
    }

    if (member.role === 'owner') {
      // 所有者：检查团队是否有其他成员
      const otherMemberCount = await this.repo.countMembers(teamId, member.userId)

      if (otherMemberCount > 0) {
        throw new Error('HAS_OTHER_MEMBERS')
      }

      // 没有其他成员，删除团队（解散）
      await this.repo.delete(teamId)
      return { message: '团队已解散' }
    } else {
      // 非所有者：删除成员记录
      await this.repo.deleteMember(member.id)
      return { message: '已退出团队' }
    }
  }
}

// 导出单例
export const teamService = new TeamService(teamRepository)