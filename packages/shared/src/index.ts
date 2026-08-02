// 用户角色
export type UserRole = 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student'

export type WorkspaceMode = 'work' | 'personal'
export type ResourceScope = 'campus' | 'personal'
export type ProblemLibraryScope = 'platform' | 'school'
export type ProblemStatus = 'draft' | 'published' | 'archived'

// 简化的角色类型（用于权限判断）
export type SimpleRole = 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student'

// 学校状态
export type SchoolStatus = 'active' | 'disabled'

// 教师状态
export type TeacherStatus = 'active' | 'disabled'

// 负责人转移结果
export type PrincipalTransferResult = 'success' | 'failed'

// 考试类型
export type ExamType = 'weekly' | 'monthly' | 'topic' | 'mock'

// 里程碑类型
export type MilestoneType = 'entry' | 'upgrade' | 'award' | 'contest' | 'goal'

// 文件类型
export type FileType = 'statement' | 'ranklist' | 'editorial' | 'solution' | 'slides'

// 任务状态
export type TaskStatus = 'pending' | 'done' | 'review'

// JWT Payload
export interface JwtPayload {
  userId: string
  role: UserRole
  username: string
  teacherId?: string // 教师ID（teacher/school_principal 角色才有）
  studentId?: string // 学生ID（student 角色才有）
  adminId?: string // 管理员ID（super_admin/platform_admin 角色才有）
  schoolId?: string // 学校ID（教师或学生所属学校）
  workspaceMode?: WorkspaceMode
  /** @deprecated Use workspaceMode. Kept while old sessions are migrated. */
  studentMode?: ResourceScope
}

// API 响应类型
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: string
}

// 分页参数
export interface PaginationParams {
  page?: number
  pageSize?: number
}

// 用户登录请求
export interface LoginRequest {
  username: string
  password: string
  role: UserRole | 'admin' | 'teacher' // 'admin'/'teacher' 是登录入口类型，非数据库角色
  workspaceMode?: WorkspaceMode
  /** @deprecated Use workspaceMode. */
  mode?: ResourceScope
}

// 用户登录响应
export interface LoginResponse {
  token: string
  userId: string
  role: UserRole
  username: string
  teacherId?: string
  studentId?: string
  adminId?: string
  schoolId?: string
  workspaceMode: WorkspaceMode
  /** @deprecated Use workspaceMode. */
  studentMode?: ResourceScope
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

// 指定负责人请求
export interface SetPrincipalRequest {
  teacherId: string
}

// 负责人转移请求
export interface TransferPrincipalRequest {
  newPrincipalTeacherId: string
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

// ========== 日志 DTO ==========

// 负责人转移日志
export interface PrincipalTransferLog {
  id: string
  schoolId: string
  schoolName: string
  oldPrincipalTeacherId: string | null
  oldPrincipalTeacherName: string | null
  newPrincipalTeacherId: string
  newPrincipalTeacherName: string
  operatorUserId: string
  operatorUsername: string
  result: PrincipalTransferResult
  message?: string
  createdAt: string
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
  role?: UserRole
  status?: 'active' | 'disabled'
  schoolId?: string
  keyword?: string
  page?: number
  pageSize?: number
}

// 用户详情响应
export interface UserDetailResponse {
  id: string
  username: string
  role: UserRole
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
    schoolId?: string
    schoolName?: string
    teamId?: string
    teamName?: string
  }
}

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
