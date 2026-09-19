import type { AccountRole, OrganizationMembershipRole, WorkspaceContext } from '@oi-manager/contracts'

export * from './oj-platforms'

export type { AccountRole, OrganizationMembershipRole, WorkspaceContext }

export type ResourceScope = 'campus' | 'personal'
export type ProblemLibraryScope = 'platform' | 'school'
export type ProblemStatus = 'draft' | 'published' | 'archived'

// 学校状态
export type SchoolStatus = 'active' | 'disabled'

// 教师状态
export type TeacherStatus = 'active' | 'disabled'


// 考试类型
export type ExamType = 'weekly' | 'monthly' | 'topic' | 'mock'

// 里程碑类型
export type MilestoneType = 'entry' | 'upgrade' | 'award' | 'contest' | 'goal'

// 文件类型
export type FileType = 'statement' | 'ranklist' | 'editorial' | 'solution' | 'slides'

// 任务状态
export type TaskStatus = 'pending' | 'done' | 'review'

/** Minimal claims that may be persisted in a signed HttpOnly Cookie session. */
export interface SessionJwtPayload {
  userId: string
  /** Incremented whenever all existing sessions must be revoked. */
  sessionVersion?: number
  accountRole: AccountRole
  username: string
  workspaceMode?: 'work' | 'personal'
}

/**
 * Authenticated request identity. Organization facts are resolved from the
 * explicit request header and never persisted in a signed session.
 */
export interface JwtPayload extends SessionJwtPayload {
  /** Canonical organization identity derived from normalized RoleAssignments. */
  organizationRole?: OrganizationMembershipRole
  /** Request-scoped authorization facts derived from roles and explicit grants. */
  organizationCapabilities?: string[]
  organizationId?: string
  organizationMembershipId?: string
}

// 分页参数
export interface PaginationParams {
  page?: number
  pageSize?: number
}

// ========== 学校管理 DTO ==========

// 创建学校请求
export interface CreateSchoolRequest {
  name: string
  shortName?: string
  code?: string
  description?: string
}

// 更新学校请求
export interface UpdateSchoolRequest {
  name?: string
  shortName?: string
  code?: string
  description?: string
}

// 学校状态更新请求
export interface UpdateSchoolStatusRequest {
  status: SchoolStatus
}

// ========== 教师管理 DTO ==========

// 创建教师请求（学校负责人）
export interface CreateTeacherRequest {
  username: string
  password: string
  name: string
  phone?: string
  email?: string
  bio?: string
  title?: string
}

// 更新教师请求（学校负责人）
export interface UpdateTeacherRequest {
  name?: string
  phone?: string
  email?: string
  bio?: string
  title?: string
}

// 教师状态更新请求
export interface UpdateTeacherStatusRequest {
  status: TeacherStatus
}

// 重置密码请求
export interface ResetPasswordRequest {
  newPassword: string
}

// ========== 平台管理员 DTO ==========

// 创建平台管理员请求
export interface CreatePlatformAdminRequest {
  username: string
  password: string
  name: string
  phone?: string
  email?: string
  bio?: string
}

// 重置密码请求（管理员用）
export interface ResetUserPasswordRequest {
  userId: string
  newPassword: string
  resetMethod: 'temporary_password' | 'manual_set'
}

// 用户列表查询参数
export interface GetUsersQueryParams {
  accountRole?: AccountRole
  status?: 'active' | 'disabled'
  keyword?: string
  page?: number
  pageSize?: number
}

// 用户详情响应
export interface UserDetailResponse {
  id: string
  username: string
  accountRole: AccountRole
  status: string
  avatar?: string
  phone?: string
  email?: string
  bio?: string
  createdAt: string
  updatedAt: string
  profile?: {
    id: string
    name: string
      schoolName?: string
    teamId?: string
    teamName?: string
  }
}

export * from './judge-program-protocol'

// 全局统计数据
export interface GlobalStatsResponse {
  totalSchools: number
  totalTeachers: number
  totalStudents: number
  totalContests: number
  totalPublicContests: number
  activeUsers: number
  disabledUsers: number
  recentRegistrations: number
}

// 年级计算工具
export {
  calculateGrade,
  calculateGradeSimple,
  calculateGradeByEducationSystem,
  getAllGrades,
  getGradeSortValue,
  parseEducationSystem,
  type CalculateGradeParams
} from './utils/grade'
