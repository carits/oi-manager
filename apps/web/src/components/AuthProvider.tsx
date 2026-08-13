'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSWRConfig } from 'swr'
import { usePathname } from 'next/navigation'
import apiClient, { AUTH_UNAUTHORIZED_EVENT } from '@/lib/apiClient'
import {
  clearAuth,
  getToken,
  setAdminId,
  setLastStudentMode,
  setRole,
  setSchoolId,
  setSchoolName,
  setStudentId,
  setStudentMode,
  setTeacherId,
  setUserId,
  getLastWorkspacePath,
  setLastWorkspaceMode,
  setLastWorkspacePath,
  setWorkspaceMode,
  setAccountWorkspaceMode,
  type WorkspaceMode,
} from '@/lib/auth'
import { getRoleHome } from '@/lib/roleAccess'
import type { WorkspaceSummary } from '@oi-manager/shared'

export interface AuthUser {
  userId: string
  username: string
  role: string
  avatar?: string | null
  phone?: string | null
  email?: string | null
  bio?: string | null
  profile?: unknown
  teacherId?: string
  studentId?: string
  adminId?: string
  schoolId?: string
  schoolName?: string
  /** 当前 URL 所在校园的成员身份；校园身份不再从全局账号角色推断。 */
  organizationRole?: 'school_principal' | 'teacher' | 'student'
  workspaceMode?: WorkspaceMode
  /** @deprecated Use workspaceMode. */
  studentMode?: 'campus' | 'personal'
}

export type { WorkspaceSummary }

interface LoginResult {
  success: boolean
  message?: string
}

type AuthStatus = 'authenticated' | 'anonymous' | 'degraded'

interface AuthContextType {
  user: AuthUser | null
  status: AuthStatus
  loading: boolean
  login: (username: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  switchWorkspace: (mode: WorkspaceMode, targetPath?: string) => Promise<boolean>
  /** @deprecated Use switchWorkspace. */
  switchMode: (mode: 'campus' | 'personal') => Promise<boolean>
  activateOrganization: (workspace: WorkspaceSummary) => void
  isAuthenticated: boolean
  sessionKey: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function normalizeWorkspaceMode(user: AuthUser): WorkspaceMode {
  return user.workspaceMode || (user.studentMode === 'personal' ? 'personal' : 'work')
}

function storeCompatibilityMetadata(user: AuthUser): void {
  setRole(user.role)
  setUserId(user.userId)
  setSchoolId(user.schoolId || null)
  setSchoolName(user.schoolName || null)
  setTeacherId(user.teacherId || null)
  setStudentId(user.studentId || null)
  setAdminId(user.adminId || null)
  const workspaceMode = normalizeWorkspaceMode(user)
  setWorkspaceMode(workspaceMode)
  setLastWorkspaceMode(workspaceMode)
  setAccountWorkspaceMode(user.username, user.role, workspaceMode)
  const legacyMode = workspaceMode === 'personal' ? 'personal' : 'campus'
  setStudentMode(legacyMode)
  setLastStudentMode(legacyMode)
}

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode
  initialUser?: AuthUser | null
}) {
  const { mutate: mutateCache } = useSWRConfig()
  const pathname = usePathname()
  const [user, setUser] = useState<AuthUser | null>(initialUser)
  const [status, setStatus] = useState<AuthStatus>(
    initialUser ? 'authenticated' : 'anonymous',
  )

  const sessionKey = useMemo(
    () => user ? `${user.role}:${user.organizationRole || 'none'}:${user.userId}:${normalizeWorkspaceMode(user)}` : null,
    [user],
  )

  useEffect(() => {
    if (initialUser) storeCompatibilityMetadata(initialUser)
  }, [initialUser])

  useEffect(() => {
    if (!user || !pathname) return
    const mode = normalizeWorkspaceMode(user)
    const belongsToWorkspace = mode === 'personal'
      ? pathname === '/personal' || pathname.startsWith('/personal/')
      : !pathname.startsWith('/personal/') && pathname !== '/personal'
    if (belongsToWorkspace && !pathname.startsWith('/account/')) {
      setLastWorkspacePath(user.userId, user.role, mode, pathname)
    }
  }, [pathname, user])

  useEffect(() => {
    const handleUnauthorized = () => {
      if (!user) return
      void mutateCache(() => true, undefined, { revalidate: false })
      clearAuth()
      setUser(null)
      setStatus('anonymous')
      const target = `${window.location.pathname}${window.location.search}`
      window.location.assign(`/login?next=${encodeURIComponent(target)}`)
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [mutateCache, user])

  // One-time bridge for sessions created before HttpOnly cookies were introduced.
  // It never blocks the login form or protected shell.
  useEffect(() => {
    if (initialUser || !getToken()) return

    let active = true
    apiClient.mutate('/api/auth/session/migrate', 'POST')
      .then(result => {
        if (!active || !result.ok) return
        clearAuth()
        window.location.reload()
      })
      .catch(() => {
        // Keep the legacy token so the user can retry or log in normally.
      })

    return () => {
      active = false
    }
  }, [initialUser])

  const login = async (
    username: string,
    password: string,
  ): Promise<LoginResult> => {
    const result = await apiClient.mutate<AuthUser & { token?: string }>(
      '/api/auth/login',
      'POST',
      { username, password, workspaceMode: 'work' },
    )

    if (!result.ok) {
      return { success: false, message: result.error.message }
    }

    const nextUser = result.data
    setUser(nextUser)
    setStatus('authenticated')
    await mutateCache(() => true, undefined, { revalidate: false })
    storeCompatibilityMetadata(nextUser)
    return { success: true }
  }

  const logout = async () => {
    const result = await apiClient.mutate('/api/auth/logout', 'POST')
    if (!result.ok) {
      setStatus('degraded')
      return
    }
    await mutateCache(() => true, undefined, { revalidate: false })
    clearAuth()
    setUser(null)
    setStatus('anonymous')
    window.location.assign('/login')
  }

  const refreshUser = async () => {
    try {
      const nextUser = await apiClient.query<AuthUser>('/api/auth/me', { retry: false })
      setUser(nextUser)
      setStatus('authenticated')
      storeCompatibilityMetadata(nextUser)
    } catch {
      setStatus('degraded')
    }
  }

  const switchWorkspace = async (mode: WorkspaceMode, targetPath?: string) => {
    if (!user || normalizeWorkspaceMode(user) === mode) return true

    const currentMode = normalizeWorkspaceMode(user)
    setLastWorkspacePath(
      user.userId,
      user.role,
      currentMode,
      `${window.location.pathname}${window.location.search}`,
    )

    const result = await apiClient.mutate<{
      workspaceMode: WorkspaceMode
      studentMode?: 'campus' | 'personal'
    }>(
      '/api/auth/switch-workspace',
      'POST',
      { workspaceMode: mode },
    )
    if (!result.ok) return false

    await mutateCache(() => true, undefined, { revalidate: false })
    const nextMode = result.data.workspaceMode
    const legacyMode = nextMode === 'personal' ? 'personal' : 'campus'
    setWorkspaceMode(nextMode)
    setLastWorkspaceMode(nextMode)
    setAccountWorkspaceMode(user.username, user.role, nextMode)
    setStudentMode(legacyMode)
    setLastStudentMode(legacyMode)
    setUser(current => current
      ? { ...current, workspaceMode: nextMode, studentMode: legacyMode }
      : null)
    const target = targetPath || getLastWorkspacePath(user.userId, user.role, nextMode)
      || (nextMode === 'personal' ? '/personal' : getRoleHome(user.role))
    window.location.assign(target)
    return true
  }

  const switchMode = (mode: 'campus' | 'personal') =>
    switchWorkspace(mode === 'personal' ? 'personal' : 'work')

  const activateOrganization = useCallback((workspace: WorkspaceSummary) => {
    if (workspace.type !== 'organization' || !workspace.schoolId) return
    setUser(current => current && current.schoolId === workspace.schoolId && current.organizationRole === workspace.memberRole
      ? current
      : current ? {
        ...current,
        schoolId: workspace.schoolId,
        schoolName: workspace.organizationName,
        organizationRole: workspace.memberRole as 'school_principal' | 'teacher' | 'student',
      } : null)
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      status,
      loading: false,
      login,
      logout,
      refreshUser,
      switchWorkspace,
      switchMode,
      activateOrganization,
      isAuthenticated: Boolean(user),
      sessionKey,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
