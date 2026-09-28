// Browser authentication remains HttpOnly-cookie-only. These helpers store display preferences only.
export type SidebarPreference = 'open' | 'closed'

export function sidebarNavigationCookieName(userId: string): string {
  return `oi_sidebar_${encodeURIComponent(userId)}`
}

export function parseSidebarNavigationPreference(value?: string | null): SidebarPreference | null {
  return value === 'open' || value === 'closed' ? value : null
}

export function sidebarNavigationCookie(userId: string, open: boolean, secure: boolean): string {
  return `${sidebarNavigationCookieName(userId)}=${open ? 'open' : 'closed'}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`
}

// A user/device has one preference across personal and school workspaces.
// The optional legacy arguments keep callers source-compatible; they no longer scope the preference.
export function getSidebarNavigationPreference(userId: string, _role?: string, _context?: string): SidebarPreference | null {
  if (typeof document === 'undefined') return null
  const prefix = `${sidebarNavigationCookieName(userId)}=`
  try {
    const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix))?.slice(prefix.length)
    return parseSidebarNavigationPreference(value)
  } catch {
    return null
  }
}

export function getSidebarNavigationOpen(userId: string, role?: string, context?: string): boolean {
  return getSidebarNavigationPreference(userId, role, context) !== 'closed'
}

export function setSidebarNavigationOpen(userId: string, _role: string, _context: string, open: boolean): void {
  if (typeof document === 'undefined') return
  try {
    document.cookie = sidebarNavigationCookie(userId, open, window.location.protocol === 'https:')
  } catch {
    // A blocked cookie must not break the current interaction. The in-memory choice still works.
  }
}
