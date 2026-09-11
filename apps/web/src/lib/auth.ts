// 浏览器仅缓存全局认证标识与导航折叠状态。组织上下文完全来自 URL 和服务端成员关系。

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
  if (adminId) localStorage.setItem(ADMIN_ID_KEY, adminId)
  else localStorage.removeItem(ADMIN_ID_KEY)
}

export function clearAuth(): void {
  ;[TOKEN_KEY, ROLE_KEY, USER_ID_KEY, ADMIN_ID_KEY].forEach(key => localStorage.removeItem(key))
}

function sidebarNavigationKey(userId: string, role: string, context: string): string {
  return `sidebarNavigation:${role}:${userId}:${context}`
}

export function getSidebarNavigationPreference(userId: string, role: string, context: string): 'open' | 'closed' | null {
  if (typeof window === 'undefined') return null
  const value = localStorage.getItem(sidebarNavigationKey(userId, role, context))
  return value === 'open' || value === 'closed' ? value : null
}

export function getSidebarNavigationOpen(userId: string, role: string, context: string): boolean {
  return getSidebarNavigationPreference(userId, role, context) === 'open'
}

export function setSidebarNavigationOpen(userId: string, role: string, context: string, open: boolean): void {
  localStorage.setItem(sidebarNavigationKey(userId, role, context), open ? 'open' : 'closed')
}

export function isAuthenticated(): boolean { return !!getToken() }
export function hasRole(role: string): boolean { return getRole() === role }
export function isAdmin(role: string | null): boolean { return role === 'super_admin' || role === 'platform_admin' }
export function isSuperAdmin(role: string | null): boolean { return role === 'super_admin' }
export function getAuthHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
