'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSWRConfig } from 'swr'
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
} from '@/lib/auth'

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
  studentMode?: 'campus' | 'personal'
}

interface LoginResult {
  success: boolean
  message?: string
}

type AuthStatus = 'authenticated' | 'anonymous' | 'degraded'

interface AuthContextType {
  user: AuthUser | null
  status: AuthStatus
  loading: boolean
  login: (username: string, password: string, role: string, mode?: 'campus' | 'personal') => Promise<LoginResult>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  switchMode: (mode: 'campus' | 'personal') => Promise<void>
  isAuthenticated: boolean
  sessionKey: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function storeCompatibilityMetadata(user: AuthUser): void {
  setRole(user.role)
  setUserId(user.userId)
  setSchoolId(user.schoolId || null)
  setSchoolName(user.schoolName || null)
  setTeacherId(user.teacherId || null)
  setStudentId(user.studentId || null)
  setAdminId(user.adminId || null)
  setStudentMode(user.studentMode || null)
  if (user.studentMode) setLastStudentMode(user.studentMode)
}

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode
  initialUser?: AuthUser | null
}) {
  const { mutate: mutateCache } = useSWRConfig()
  const [user, setUser] = useState<AuthUser | null>(initialUser)
  const [status, setStatus] = useState<AuthStatus>(
    initialUser ? 'authenticated' : 'anonymous',
  )

  const sessionKey = useMemo(
    () => user ? `${user.role}:${user.userId}:${user.studentMode || ''}` : null,
    [user],
  )

  useEffect(() => {
    if (initialUser) storeCompatibilityMetadata(initialUser)
  }, [initialUser])

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
    role: string,
    mode?: 'campus' | 'personal',
  ): Promise<LoginResult> => {
    const result = await apiClient.mutate<AuthUser & { token?: string }>(
      '/api/auth/login',
      'POST',
      { username, password, role, mode },
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

  const switchMode = async (mode: 'campus' | 'personal') => {
    const result = await apiClient.mutate<{ studentMode: 'campus' | 'personal' }>(
      '/api/auth/switch-mode',
      'POST',
      { mode },
    )
    if (!result.ok) return

    await mutateCache(() => true, undefined, { revalidate: false })
    setStudentMode(result.data.studentMode)
    setLastStudentMode(result.data.studentMode)
    setUser(current => current
      ? { ...current, studentMode: result.data.studentMode }
      : null)
    window.location.assign('/student')
  }

  return (
    <AuthContext.Provider value={{
      user,
      status,
      loading: false,
      login,
      logout,
      refreshUser,
      switchMode,
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
