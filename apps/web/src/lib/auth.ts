// 浏览器认证仅使用 HttpOnly Cookie；本文件只保存无敏感性的侧栏偏好。

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
