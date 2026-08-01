// 认证工具函数

const TOKEN_KEY = 'token'
const ROLE_KEY = 'role'
const USER_ID_KEY = 'userId'
const SCHOOL_ID_KEY = 'schoolId'
const SCHOOL_NAME_KEY = 'schoolName'
const TEACHER_ID_KEY = 'teacherId'
const STUDENT_ID_KEY = 'studentId'
const ADMIN_ID_KEY = 'adminId'
const STUDENT_MODE_KEY = 'studentMode'
const LAST_STUDENT_MODE_KEY = 'lastStudentMode'
const WORKSPACE_MODE_KEY = 'workspaceMode'
const LAST_WORKSPACE_MODE_KEY = 'lastWorkspaceMode'

export type StudentMode = 'campus' | 'personal'
export type WorkspaceMode = 'work' | 'personal'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getRole(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ROLE_KEY)
}

export function setRole(role: string): void {
  localStorage.setItem(ROLE_KEY, role)
}

export function getUserId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(USER_ID_KEY)
}

export function setUserId(userId: string): void {
  localStorage.setItem(USER_ID_KEY, userId)
}

export function getSchoolId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SCHOOL_ID_KEY)
}

export function setSchoolId(schoolId: string | null): void {
  if (schoolId) {
    localStorage.setItem(SCHOOL_ID_KEY, schoolId)
  } else {
    localStorage.removeItem(SCHOOL_ID_KEY)
  }
}

export function getSchoolName(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SCHOOL_NAME_KEY)
}

export function setSchoolName(schoolName: string | null): void {
  if (schoolName) {
    localStorage.setItem(SCHOOL_NAME_KEY, schoolName)
  } else {
    localStorage.removeItem(SCHOOL_NAME_KEY)
  }
}

export function getTeacherId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TEACHER_ID_KEY)
}

export function setTeacherId(teacherId: string | null): void {
  if (teacherId) {
    localStorage.setItem(TEACHER_ID_KEY, teacherId)
  } else {
    localStorage.removeItem(TEACHER_ID_KEY)
  }
}

export function getStudentId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STUDENT_ID_KEY)
}

export function setStudentId(studentId: string | null): void {
  if (studentId) {
    localStorage.setItem(STUDENT_ID_KEY, studentId)
  } else {
    localStorage.removeItem(STUDENT_ID_KEY)
  }
}

export function getAdminId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ADMIN_ID_KEY)
}

export function setAdminId(adminId: string | null): void {
  if (adminId) {
    localStorage.setItem(ADMIN_ID_KEY, adminId)
  } else {
    localStorage.removeItem(ADMIN_ID_KEY)
  }
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(USER_ID_KEY)
  localStorage.removeItem(SCHOOL_ID_KEY)
  localStorage.removeItem(SCHOOL_NAME_KEY)
  localStorage.removeItem(TEACHER_ID_KEY)
  localStorage.removeItem(STUDENT_ID_KEY)
  localStorage.removeItem(ADMIN_ID_KEY)
  localStorage.removeItem(STUDENT_MODE_KEY)
  localStorage.removeItem(WORKSPACE_MODE_KEY)
  // 注意：不清除 LAST_STUDENT_MODE_KEY，以便下次登录时记住上次模式
}

export function getStudentMode(): StudentMode | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STUDENT_MODE_KEY) as StudentMode | null
}

export function setStudentMode(mode: StudentMode | null): void {
  if (mode) {
    localStorage.setItem(STUDENT_MODE_KEY, mode)
  } else {
    localStorage.removeItem(STUDENT_MODE_KEY)
  }
}

export function getLastStudentMode(): StudentMode | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(LAST_STUDENT_MODE_KEY) as StudentMode | null
}

export function setLastStudentMode(mode: StudentMode): void {
  localStorage.setItem(LAST_STUDENT_MODE_KEY, mode)
}

export function getWorkspaceMode(): WorkspaceMode | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(WORKSPACE_MODE_KEY) as WorkspaceMode | null
}

export function setWorkspaceMode(mode: WorkspaceMode | null): void {
  if (mode) localStorage.setItem(WORKSPACE_MODE_KEY, mode)
  else localStorage.removeItem(WORKSPACE_MODE_KEY)
}

export function getLastWorkspaceMode(): WorkspaceMode | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(LAST_WORKSPACE_MODE_KEY) as WorkspaceMode | null
}

export function setLastWorkspaceMode(mode: WorkspaceMode): void {
  localStorage.setItem(LAST_WORKSPACE_MODE_KEY, mode)
}

export function getAccountWorkspaceMode(username: string, role: string): WorkspaceMode | null {
  if (typeof window === 'undefined' || !username.trim()) return null
  return localStorage.getItem(`accountWorkspace:${role}:${username.trim().toLowerCase()}`) as WorkspaceMode | null
}

export function setAccountWorkspaceMode(username: string, role: string, mode: WorkspaceMode): void {
  const normalizedUsername = username.trim().toLowerCase()
  const aliases = role === 'super_admin'
    ? ['super_admin', 'admin']
    : role === 'platform_admin'
      ? ['platform_admin', 'platform-admin', 'admin']
      : role === 'school_principal'
        ? ['school_principal', 'teacher']
        : [role]
  aliases.forEach(alias => localStorage.setItem(`accountWorkspace:${alias}:${normalizedUsername}`, mode))
}

function workspacePathKey(userId: string, role: string, mode: WorkspaceMode): string {
  return `workspacePath:${role}:${userId}:${mode}`
}

export function getLastWorkspacePath(
  userId: string,
  role: string,
  mode: WorkspaceMode,
): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(workspacePathKey(userId, role, mode))
}

export function setLastWorkspacePath(
  userId: string,
  role: string,
  mode: WorkspaceMode,
  path: string,
): void {
  localStorage.setItem(workspacePathKey(userId, role, mode), path)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export function hasRole(role: string): boolean {
  return getRole() === role
}

// 检查是否为管理员（super_admin 或 platform_admin）
export function isAdmin(role: string | null): boolean {
  return role === 'super_admin' || role === 'platform_admin'
}

// 检查是否为超级管理员
export function isSuperAdmin(role: string | null): boolean {
  return role === 'super_admin'
}

// API 请求头
export function getAuthHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
