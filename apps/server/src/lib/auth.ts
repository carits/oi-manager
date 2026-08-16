// 认证工具函数

const TOKEN_KEY = 'token'
const ROLE_KEY = 'role'
const USER_ID_KEY = 'userId'
const ADMIN_ID_KEY = 'adminId'

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
  localStorage.removeItem(ADMIN_ID_KEY)
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
