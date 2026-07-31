/**
 * Team Module - Type Definitions
 * 团队模块类型定义
 */

import type { UserRole, JwtPayload } from '@oi-manager/shared'

// ==================== 基础类型 ====================

/** 成员类型 */
export type MemberType = 'teacher' | 'student'

/** 成员角色 */
export type MemberRole = 'owner' | 'admin' | 'member'

/** 成员状态 */
export type MemberStatus = 'pending' | 'active'

/** 团队所属的学生使用场景 */
export type TeamScope = 'campus' | 'personal'

// ==================== 数据库模型类型 ====================

/** 团队成员基础信息 */
export interface TeamMemberBase {
  id: string
  teamId: string
  userId: string
  userType: MemberType
  role: MemberRole
  status: MemberStatus
  joinedAt: Date
  invitedBy: string | null
}

/** 团队基础信息 */
export interface TeamBase {
  id: string
  name: string
  avatar: string | null
  description: string | null
  announcement: string | null
  schoolId: string
  scope: TeamScope
  isPublic: boolean
  createdAt: Date
  updatedAt: Date
}

/** 学校基础信息 */
export interface SchoolBase {
  id: string
  name: string
  educationSystem?: string | null
  schoolType?: string | null
}

// ==================== DTO 类型 ====================

/** 创建团队 DTO */
export interface CreateTeamDTO {
  id?: string
  name: string
  description?: string
  isPublic?: boolean
}

/** 更新团队 DTO */
export interface UpdateTeamDTO {
  name?: string
  description?: string
  isPublic?: boolean
}

/** 邀请成员 DTO */
export interface InviteMembersDTO {
  members?: Array<{ userId: string; userType: MemberType; role?: MemberRole }>
  usernames?: string[]
  role?: MemberRole
}

/** 转移团队 DTO */
export interface TransferTeamDTO {
  newOwnerId: string
  newOwnerType: MemberType
}

/** 加入申请 DTO */
export interface JoinRequestDTO {
  message?: string
}

/** 添加管理员 DTO */
export interface AddAdminDTO {
  memberId: string
  memberType: MemberType
}

/** 移除成员查询参数 */
export interface RemoveMemberQuery {
  memberType?: MemberType
}

// ==================== 查询参数类型 ====================

/** 团队列表查询参数 */
export interface TeamListQuery {
  schoolId?: string
  page?: number
  pageSize?: number
  view?: string
}

/** 可邀请成员查询参数 */
export interface AvailableMembersQuery {
  keyword?: string
  type?: MemberType
}

/** 审批请求查询参数 */
export interface RequestActionQuery {
  type: MemberType
}

// ==================== 响应类型 ====================

/** 成员详情 */
export interface MemberDetails {
  id: string
  name: string
  avatar: string | null
  username: string
  type: MemberType
  title?: string
  rating?: number
  enrollmentYear?: number
  joinedAt?: Date
}

/** 团队列表项 */
export interface TeamListItem {
  id: string
  name: string
  avatar: string | null
  description: string | null
  isPublic: boolean
  scope: TeamScope
  createdAt: Date
  school: SchoolBase
  owner: {
    id: string
    name: string
  }
  _count?: {
    members: number
    admins: number
    teacherMembers: number
  }
  memberStatus?: MemberStatus | null
  requestStatus?: string | null
}

/** 团队详情 */
export interface TeamDetail {
  id: string
  name: string
  avatar: string | null
  description: string | null
  announcement: string | null
  isPublic: boolean
  createdAt: Date
  updatedAt: Date
  school: SchoolBase
  owner: MemberDetails | null
  admins: MemberDetails[]
  teachers: Array<MemberDetails & { joinedAt: Date }>
  students: Array<MemberDetails & { joinedAt: Date }>
  pendingTeachers: Array<MemberDetails & { memberId: string; requestedAt: Date }>
}

/** 邀请列表项 */
export interface InvitationItem {
  id: string
  teamId: string
  teamName: string
  teamAvatar: string | null
  schoolName: string
  memberCount: number
  ownerName: string
  invitedBy: string
  invitedAt: Date
  role: MemberRole
  isPublic: boolean
}

/** 待处理邀请项 */
export interface PendingInviteItem {
  id: string
  type: MemberType
  role: MemberRole
  invitedAt: Date
  invitedByName: string
  user: MemberDetails | null
}

/** 加入申请项 */
export interface JoinRequestItem {
  id: string
  type: MemberType
  source: string
  message: string | null
  createdAt: Date
  user: (MemberDetails & { userType: MemberType }) | null
}

/** 邀请成员结果 */
export interface InviteMembersResult {
  invited: string[]
  notFound: string[]
  notSameSchool: string[]
  alreadyMember: string[]
}

// ==================== 权限相关类型 ====================

/** 成员角色检查结果 */
export interface MemberRoleCheck {
  role: MemberRole | null
  memberId: string | null
}

/** 团队管理员检查结果 */
export interface TeamAdminCheck {
  isOwner: boolean
  isAdmin: boolean
}

// ==================== 审计日志类型 ====================

/** 团队操作审计日志参数 */
export interface TeamOperationLogParams {
  teamId: string
  operatorId: string
  operatorType: MemberType
  action: string
  targetId?: string
  targetType?: MemberType
  oldValue?: string
  newValue?: string
  metadata?: Record<string, unknown>
}

// ==================== 业务错误类型 ====================

/** 业务错误代码 */
export type TeamErrorCode =
  | 'TEAM_NOT_FOUND'
  | 'OWNER_NOT_FOUND'
  | 'NOT_OWNER'
  | 'NOT_ADMIN'
  | 'NEW_OWNER_NOT_FOUND'
  | 'NEW_OWNER_NOT_SAME_SCHOOL'
  | 'NEW_OWNER_LIMIT_EXCEEDED'
  | 'NEW_OWNER_NOT_MEMBER'
  | 'TEAM_LIMIT_EXCEEDED'
  | 'REQUEST_NOT_FOUND'
  | 'NO_PERMISSION'
  | 'ALREADY_PROCESSED'
  | 'ALREADY_MEMBER'
  | 'HAS_PENDING_REQUEST'

/** 业务错误映射 */
export const TeamErrorMessages: Record<TeamErrorCode, { status: number; message: string }> = {
  TEAM_NOT_FOUND: { status: 404, message: '团队不存在' },
  OWNER_NOT_FOUND: { status: 400, message: '团队所有者不存在' },
  NOT_OWNER: { status: 403, message: '只有团队所有者可以执行此操作' },
  NOT_ADMIN: { status: 403, message: '只有团队所有者或管理员可以执行此操作' },
  NEW_OWNER_NOT_FOUND: { status: 404, message: '新所有者不存在' },
  NEW_OWNER_NOT_SAME_SCHOOL: { status: 400, message: '新所有者必须是本校成员' },
  NEW_OWNER_LIMIT_EXCEEDED: { status: 400, message: '新所有者创建的团队数量已达上限' },
  NEW_OWNER_NOT_MEMBER: { status: 400, message: '新所有者必须是团队成员' },
  TEAM_LIMIT_EXCEEDED: { status: 400, message: '您创建的团队数量已达上限' },
  REQUEST_NOT_FOUND: { status: 404, message: '申请不存在' },
  NO_PERMISSION: { status: 403, message: '无权操作' },
  ALREADY_PROCESSED: { status: 400, message: '该申请已处理' },
  ALREADY_MEMBER: { status: 400, message: '已是团队成员' },
  HAS_PENDING_REQUEST: { status: 400, message: '已有待处理的请求' }
}

// ==================== 工具类型 ====================

/** 用户身份信息 */
export interface UserIdentity {
  userId: string
  userType: MemberType
  schoolId: string | null
}

/** 从 JWT Payload 提取用户身份 */
export function extractUserIdentity(user: JwtPayload): UserIdentity | null {
  const userId = user.userId
  const userType = user.role === 'student' ? 'student' : 'teacher'

  if (!userId) return null

  return {
    userId,
    userType,
    schoolId: user.schoolId || null
  }
}

/** 获取用户身份（带类型保护） */
export function getUserIdentity(user: JwtPayload): { id: string; type: MemberType } | null {
  const type = user.role === 'student' ? 'student' : 'teacher'
  return { id: user.userId, type }
}
