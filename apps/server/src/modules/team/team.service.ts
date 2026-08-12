import crypto from 'crypto'
/**
 * Team Module - Service Layer
 * 团队模块业务逻辑层
 */

import logger from '../../lib/logger'
import { paginatedResponse } from '../../lib/pagination'
import type { JwtPayload } from '@oi-manager/shared'
import { teamRepository, TeamRepository } from './team.repository'
import { getUserName, getUserNames, getMemberDetails, getMemberDetailsBatch, formatMemberForScope, formatTeamLimitMessage, formatNewOwnerLimitMessage, transformTeamForFrontend, transformTeamsForFrontend } from './team.utils'
import { getMembershipType, isPersonalMode } from '../../middleware/auth'
import { notificationService } from '../notification/notification.service'
import type {
  MemberType,
  MemberRole,
  MemberStatus,
  TeamScope,
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

  getScopeForUser(user: JwtPayload): TeamScope {
    return isPersonalMode(user) ? 'personal' : 'campus'
  }

  async assertTeamScope(teamId: string, user: JwtPayload) {
    const team = await this.repo.findById(teamId)
    if (!team) {
      throw new Error('TEAM_NOT_FOUND')
    }
    if (team.scope !== this.getScopeForUser(user)) {
      throw new Error('TEAM_SCOPE_MISMATCH')
    }
    return team
  }

  /**
   * 检查用户在团队中的角色
   */
  async getMemberRole(teamId: string, user: JwtPayload): Promise<MemberRoleCheck> {
    const userId = user.userId
    const userType = getMembershipType(user)

    if (!userId) {
      return { role: null, memberId: null }
    }

    const team = await this.repo.findById(teamId)
    if (!team || team.scope !== this.getScopeForUser(user)) {
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
    if (this.getScopeForUser(user) !== 'campus') {
      throw new Error('TEAM_SCOPE_MISMATCH')
    }
    const teams = await this.repo.findBySchool(schoolId)

    // 批量加载所有者信息
    const ownerInfos = teams.map(team => {
      const owner = team.TeamMember[0]
      return owner ? { teamId: team.id, id: owner.userId, userType: owner.userType } : null
    }).filter(Boolean) as Array<{ teamId: string; id: string; userType: string }>

    const teacherIds = ownerInfos.filter(o => o.userType === 'teacher').map(o => o.id)
    const studentIds = ownerInfos.filter(o => o.userType === 'student').map(o => o.id)

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

    // 如果是学生，检查申请状态（统一从 TeamMember 查询）
    if (user.role === 'student') {
      const memberRecords = await this.repo.findMembersByUser(user.userId, 'student')

      // 区分：已加入(active)、邀请(pending + invitedBy!=null)、申请(pending + invitedBy==null)
      const requestMap = new Map(
        memberRecords
          .filter(m => m.status === 'pending' && !m.invitedBy)
          .map(m => [m.teamId, 'pending'])
      )
      const memberMap = new Map(
        memberRecords
          .filter(m => m.status === 'active')
          .map(m => [m.teamId, 'active'])
      )

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
  async getStudentTeams(studentId: string, user: JwtPayload) {
    const scope = this.getScopeForUser(user)
    const membershipType = getMembershipType(user)
    const memberRecords = await this.repo.findMembersByUser(studentId, membershipType, undefined, scope)
    logger.info('getStudentTeams_debug', { studentId, memberCount: memberRecords.length } as any)

    // 批量加载团队信息
    const teamIds = memberRecords.map(r => r.teamId)
    const teams = await Promise.all(teamIds.map(id => this.repo.findById(id)))
    const scopedTeams = teams.filter(team => team?.scope === scope)
    const teamMap = new Map(scopedTeams.map(t => [t!.id, t!]))

    // 批量加载所有者信息
    const ownerInfos: Array<{ teamId: string; userId: string; userType: string }> = []
    for (const team of scopedTeams) {
      const owner = team!.TeamMember.find(m => m.role === 'owner')
      if (owner) {
        ownerInfos.push({ teamId: team!.id, userId: owner.userId, userType: owner.userType })
      }
    }

    const teacherIds = ownerInfos.filter(o => o.userType === 'teacher').map(o => o.userId)
    const studentIds = ownerInfos.filter(o => o.userType === 'student').map(o => o.userId)
    const userIds = ownerInfos.filter(o => o.userType === 'user').map(o => o.userId)

    const [teachers, students, userNameMap] = await Promise.all([
      this.repo.findTeachers(teacherIds),
      this.repo.findStudents(studentIds),
      getUserNames(userIds, 'user')
    ])

    const teacherNameMap = new Map(teachers.map(t => [
      t.id,
      scope === 'personal' ? t.User.username : t.name
    ]))
    const studentNameMap = new Map(students.map(s => [
      s.id,
      scope === 'personal' ? s.User.username : s.name
    ]))

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
            : owner.userType === 'student'
              ? studentNameMap.get(owner.userId)
              : userNameMap.get(owner.userId)) || '未知'
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
    skip: number
    view?: string
    user: JwtPayload
  }) {
    const { schoolId, page, pageSize, skip, view, user } = params

    const userId = user.userId
    const userType = getMembershipType(user)

    const scope = this.getScopeForUser(user)
    const where: Record<string, unknown> = { scope }
    if (scope === 'campus') {
      const effectiveSchoolId = user.schoolId || schoolId
      if (effectiveSchoolId) where.schoolId = effectiveSchoolId
    }

    // 构建过滤条件
    if (view === 'mine') {
      if (!userId || userId === 'undefined' || userId === 'null') {
        return paginatedResponse([], 0, page, pageSize)
      }

      const myTeamIds = await this.repo.findUserTeamIds(userId, userType, 'active', scope)
      where.id = { in: myTeamIds }
    } else if (scope === 'campus' && schoolId && !view) {
      // 学校团队页面：显示该学校的所有团队
    } else {
      // 全部团队：只显示公有，且排除自己已加入的
      where.isPublic = true

      if (userId && userId !== 'undefined' && userId !== 'null') {
        const myTeamIds = await this.repo.findUserTeamIds(userId, userType, 'active', scope)
        if (myTeamIds.length > 0) {
          where.id = { notIn: myTeamIds }
        }
      }
    }

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
    const userIds = ownerInfos.filter(o => o.userType === 'user').map(o => o.userId)

    const [teachers, students, userNameMap] = await Promise.all([
      this.repo.findTeachers(teacherIds),
      this.repo.findStudents(studentIds),
      getUserNames(userIds, 'user')
    ])

    const teacherNameMap = new Map(teachers.map(t => [
      t.id,
      scope === 'personal' ? t.User.username : t.name
    ]))
    const studentNameMap = new Map(students.map(s => [
      s.id,
      scope === 'personal' ? s.User.username : s.name
    ]))

    // 组装结果
    const teamsWithOwner = allTeams.map(team => {
      const owner = team.TeamMember.find(m => m.role === 'owner')
      const ownerName = owner
        ? (owner.userType === 'teacher'
            ? teacherNameMap.get(owner.userId)
            : owner.userType === 'student'
              ? studentNameMap.get(owner.userId)
              : userNameMap.get(owner.userId)) || '未知'
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

    return paginatedResponse(teamsWithOwner.map(transformTeamForFrontend), total, page, pageSize)
  }

  // ==================== 团队详情 ====================

  /**
   * 获取团队详情
   */
  async getTeamDetail(teamId: string, user: JwtPayload) {
    const team = await this.assertTeamScope(teamId, user)
    const scope = team.scope as TeamScope

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

    // 查询所有待处理的申请（TeamMember status=pending, invitedBy=null）
    const pendingRequests = await this.repo.findMembers(teamId, { status: 'pending' })
      .then(ms => ms.filter(m => !m.invitedBy))

    // 批量获取所有成员详情（4 次查询替代 N×2 次）
    const allMembers = [
      ...(owner ? [{ userId: owner.userId, userType: owner.userType as MemberType, role: 'owner' as const, joinedAt: owner.joinedAt, id: '' }] : []),
      ...admins.map(a => ({ userId: a.userId, userType: a.userType as MemberType, role: 'admin' as const, joinedAt: a.joinedAt, id: '' })),
      ...members.map(m => ({ userId: m.userId, userType: m.userType as MemberType, role: 'member' as const, joinedAt: m.joinedAt, id: m.id })),
      ...pendingRequests.map(m => ({ userId: m.userId, userType: m.userType as MemberType, role: 'pending' as const, joinedAt: m.joinedAt, id: m.id })),
    ]
    const detailsMap = await getMemberDetailsBatch(allMembers)

    const rawOwnerInfo = owner ? detailsMap.get(`${owner.userType}:${owner.userId}`) ?? null : null
    const ownerInfo = rawOwnerInfo ? formatMemberForScope(rawOwnerInfo, scope) : null

    const adminsInfo = admins
      .map(a => detailsMap.get(`${a.userType}:${a.userId}`))
      .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
      .map(detail => formatMemberForScope(detail, scope))

    const teachersInfo = members
      .filter(m => m.userType === 'teacher')
      .map(m => { const d = detailsMap.get(`teacher:${m.userId}`); return d ? { ...formatMemberForScope(d, scope), joinedAt: m.joinedAt } : null })

    const studentsInfo = members
      .filter(m => m.userType === 'student')
      .map(m => { const d = detailsMap.get(`student:${m.userId}`); return d ? { ...formatMemberForScope(d, scope), joinedAt: m.joinedAt } : null })

    const usersInfo = members
      .filter(m => m.userType === 'user')
      .map(m => { const d = detailsMap.get(`user:${m.userId}`); return d ? { ...formatMemberForScope(d, scope), joinedAt: m.joinedAt } : null })

    const pendingRequestsInfo = pendingRequests.map(m => {
      const d = detailsMap.get(`${m.userType}:${m.userId}`)
      return d ? { ...formatMemberForScope(d, scope), memberId: m.id, requestedAt: m.joinedAt } : null
    })

    return transformTeamForFrontend({
      ...team,
      owner: ownerInfo,
      admins: adminsInfo,
      teachers: teachersInfo.filter(Boolean),
      students: [...studentsInfo, ...usersInfo].filter(Boolean),
      pendingRequests: pendingRequestsInfo.filter(Boolean)
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
    const scope = this.getScopeForUser(user)
    const maxTeams = scope === 'personal' ? 5 : fullUser.Teacher ? 50 : 5

    if (scope === 'personal') {
      ownerId = fullUser.id
      ownerType = 'user'
    } else if (fullUser.Teacher) {
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

    if (scope === 'campus' && !schoolId) {
      throw new Error('NO_SCHOOL')
    }

    // 使用事务创建团队和所有者成员记录
    const team = await this.repo.transaction(async (tx) => {
      // 在事务内检查数量限制
      const existingTeams = await tx.teamMember.count({
        where: {
          userId: ownerId,
          userType: ownerType,
          role: 'owner',
          Team: { scope }
        }
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
          scope,
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
    const team = await this.assertTeamScope(teamId, user)
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
    const ownerDetails = ownerMember
      ? await getMemberDetails(ownerMember.userId, ownerMember.userType as MemberType)
      : null
    const ownerName = ownerDetails
      ? formatMemberForScope(ownerDetails, team.scope as TeamScope).name
      : '未知'

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
    const memberCount = await this.repo.countMembers(teamId, user.userId)
    if (memberCount > 0) {
      throw new Error('HAS_OTHER_MEMBERS')
    }

    await this.repo.delete(teamId)

    // 记录审计日志
    const callerId = user.userId
    const callerType = getMembershipType(user)
    await this.repo.logOperation({
      teamId,
      operatorId: callerId,
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

    const team = await this.assertTeamScope(teamId, user)

    const invitedBy = user.userId

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
        if (typeof member === 'object') {
          const id = member.userId
          const type = member.userType
          if (id && type) {
            targetMembers.push({ id, type })
          }
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

        if (team.scope === 'personal') {
          if (foundUser.status !== 'active' || !foundUser.PersonalProfile) {
            result.notFound.push(trimmedUsername)
            continue
          }
          targetMembers.push({ id: foundUser.id, type: 'user' })
        } else if (foundUser.Student) {
          if (team.scope === 'campus' && foundUser.Student.schoolId !== team.schoolId) {
            result.notSameSchool.push(trimmedUsername)
            continue
          }
          targetMembers.push({ id: foundUser.Student.id, type: 'student' })
        } else if (foundUser.Teacher) {
          if (team.scope === 'campus' && foundUser.Teacher.schoolId !== team.schoolId) {
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
        : memberType === 'student'
          ? await this.repo.findStudent(memberId)
          : await this.repo.findUser(memberId)

      if (!memberUser || (team.scope === 'campus' && memberUser.schoolId !== team.schoolId)) {
        result.notSameSchool.push(memberId)
        continue
      }

      // 创建邀请
      const invitation = await this.repo.createMember({
        teamId,
        userId: memberId,
        userType: memberType,
        role: dto.role === 'admin' ? 'admin' : 'member',
        status: 'pending',
        invitedBy
      })
      await notificationService.createTeamInvitation({
        recipientId: memberId,
        scope: team.scope as TeamScope,
        invitationId: invitation.id,
        teamId,
        teamName: team.name,
        inviterId: invitedBy,
        inviterType: getMembershipType(user) as MemberType
      })
      result.invited.push(memberId)
    }

    // 记录邀请审计日志
    if (result.invited.length > 0) {
      const callerId = user.userId
      const callerType = getMembershipType(user)
      await this.repo.logOperation({
        teamId,
        operatorId: callerId,
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

    const team = await this.assertTeamScope(teamId, user)

    const result = {
      added: [] as string[],
      alreadyMember: [] as string[],
      notSameSchool: [] as string[]
    }

    // 分离学生和教师
    const studentIds = members.filter(m => m.type === 'student').map(m => m.id)
    const teacherIds = members.filter(m => m.type === 'teacher').map(m => m.id)
    const userIds = members.filter(m => m.type === 'user').map(m => m.id)

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
    const users = userIds.length > 0
      ? await this.repo.findUsersByIds(userIds)
      : []

    const studentMap = new Map(students.map(s => [s.id, s]))
    const teacherMap = new Map(teachers.map(t => [t.id, t]))
    const userMap = new Map(users.map(candidate => [candidate.id, candidate]))

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
        : memberType === 'teacher'
          ? teacherMap.get(memberId)
          : userMap.get(memberId)

      if (!memberUser || (team.scope === 'campus' && memberUser.schoolId !== team.schoolId)) {
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
        invitedBy: user.userId
      })
      result.added.push(memberId)
    }

    // 批量创建成员
    if (membersToCreate.length > 0) {
      await this.repo.createMembers(membersToCreate)
    }

    // 记录审计日志
    if (result.added.length > 0) {
      const callerId = user.userId
      const callerType = getMembershipType(user)
      await this.repo.logOperation({
        teamId,
        operatorId: callerId,
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
    const callerId = user.userId
    const callerType = getMembershipType(user)
    await this.repo.logOperation({
      teamId,
      operatorId: callerId,
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
    const callerId = user.userId
    const callerType = getMembershipType(user)
    await this.assertTeamScope(teamId, user)

    await this.repo.transaction(async (tx) => {
      // 1. 获取团队信息
      const currentTeam = await tx.team.findUnique({
        where: { id: teamId },
        select: { schoolId: true, scope: true }
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

      if (
        (currentTeam.scope === 'personal' && dto.newOwnerType !== 'user') ||
        (currentTeam.scope === 'campus' && dto.newOwnerType === 'user')
      ) {
        throw new Error('NEW_OWNER_SCOPE_MISMATCH')
      }

      // 3. 验证新所有者是否存在且属于本校
      const newOwnerUser = dto.newOwnerType === 'teacher'
        ? await tx.teacher.findUnique({ where: { id: dto.newOwnerId }, select: { id: true, schoolId: true } })
        : dto.newOwnerType === 'student'
          ? await tx.student.findUnique({ where: { id: dto.newOwnerId }, select: { id: true, schoolId: true } })
          : await tx.user.findFirst({
              where: {
                id: dto.newOwnerId,
                status: 'active',
                PersonalProfile: { isNot: null }
              },
              select: { id: true, schoolId: true }
            })
      if (!newOwnerUser) {
        throw new Error('NEW_OWNER_NOT_FOUND')
      }
      if (currentTeam.scope === 'campus' && newOwnerUser.schoolId !== currentTeam.schoolId) {
        throw new Error('NEW_OWNER_NOT_SAME_SCHOOL')
      }

      // 4. 检查新所有者团队数量限制
      const existingTeams = await tx.teamMember.count({
        where: {
          userId: dto.newOwnerId,
          userType: dto.newOwnerType,
          role: 'owner',
          Team: { scope: currentTeam.scope }
        }
      })
      const maxTeams = currentTeam.scope === 'personal' || dto.newOwnerType === 'student' ? 5 : 50
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
          id: crypto.randomUUID(),
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
    const userId = user.userId
    const userType = getMembershipType(user)

    if (!userId) {
      throw new Error('IDENTITY_NOT_FOUND')
    }

    const team = await this.assertTeamScope(teamId, user)

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

    // 统一创建 pending 状态的 TeamMember 记录（不再区分教师/学生）
    const request = await this.repo.createMember({
      teamId,
      userId,
      userType,
      role: 'member',
      status: 'pending'
    })
    const administrators = await this.repo.findMembers(teamId, { status: 'active' })
    const recipientIds = administrators
      .filter(member => member.role === 'owner' || member.role === 'admin')
      .map(member => member.userId)
      .filter(id => id !== userId)
    await notificationService.createTeamJoinRequest({
      recipientIds,
      scope: team.scope as TeamScope,
      requestId: request.id,
      teamId,
      teamName: team.name,
      applicantId: userId,
      applicantType: userType as MemberType
    })
    return request
  }

  /**
   * 退出团队
   */
  async leaveTeam(teamId: string, user: JwtPayload) {
    const userId = user.userId
    const userType = getMembershipType(user)

    if (!userId) {
      throw new Error('IDENTITY_NOT_FOUND')
    }

    await this.assertTeamScope(teamId, user)

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
