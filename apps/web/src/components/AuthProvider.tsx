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
import { accountClient, organizationClient, AUTH_UNAUTHORIZED_EVENT, ORGANIZATION_UNAVAILABLE_EVENT } from '@/lib/apiClient'
import { clearAuth, clearLegacyBrowserToken, setAdminId, setRole, setUserId } from '@/lib/auth'
import { getRoleHome } from '@/lib/roleAccess'
import type { AccountRole, LegacyUserRole, OrganizationMembershipRole, WorkspaceSummary } from '@oi-manager/contracts'

export interface AuthUser {
  userId: string
  organizationId?: string
  organizationName?: string
  organizationMembershipId?: string
  username: string
  /** Context role retained for compatibility while callers migrate. */
  role: LegacyUserRole
  accountRole: AccountRole
  avatar?: string | null
  phone?: string | null
  email?: string | null
  bio?: string | null
  profile?: unknown
  adminId?: string
  /** 当前 URL 所在校园的成员身份；校园身份不再从全局账号角色推断。 */
  organizationRole?: OrganizationMembershipRole
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
  login: (username: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  activateOrganization: (workspace: WorkspaceSummary) => void
  isAuthenticated: boolean
  sessionKey: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function storeAccountMetadata(user: AuthUser): void {
  setRole(user.accountRole)
  setUserId(user.userId)
  setAdminId(user.adminId || null)
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
    () => user ? `${user.accountRole}:${user.organizationId || 'personal'}:${user.organizationRole || 'user'}:${user.userId}` : null,
    [user],
  )

  useEffect(() => {
    clearLegacyBrowserToken()
    if (initialUser) storeAccountMetadata(initialUser)
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

  useEffect(() => {
    const handleUnavailableOrganization = () => {
      void mutateCache(() => true, undefined, { revalidate: false })
      setUser(current => current ? {
        ...current,
        organizationId: undefined,
        organizationName: undefined,
        organizationMembershipId: undefined,
        organizationRole: undefined,
      } : null)
      window.location.assign('/identity?organizationUnavailable=1')
    }
    window.addEventListener(ORGANIZATION_UNAVAILABLE_EVENT, handleUnavailableOrganization)
    return () => window.removeEventListener(ORGANIZATION_UNAVAILABLE_EVENT, handleUnavailableOrganization)
  }, [mutateCache])

  useEffect(() => {
    if (!user) return
    const organizationId = pathname.match(/^\/org\/([^/]+)/)?.[1]
    const contextMatches = organizationId
      ? user.organizationId === organizationId && Boolean(user.organizationRole)
      : !user.organizationId
    if (contextMatches) return

    let cancelled = false
    const contextClient = organizationId ? organizationClient(organizationId) : accountClient
    void contextClient.query<AuthUser>('/api/auth/me', {
      retry: false,
    }).then(nextUser => {
      if (cancelled) return
      setUser(nextUser)
      setStatus('authenticated')
      storeAccountMetadata(nextUser)
    }).catch(() => {
      if (!cancelled) setStatus('degraded')
    })
    return () => { cancelled = true }
  }, [pathname, user?.userId, user?.organizationId, user?.organizationRole])


  const login = async (
    username: string,
    password: string,
  ): Promise<LoginResult> => {
    const result = await accountClient.mutate<AuthUser>(
      '/api/auth/login',
      'POST',
      { username, password },
    )

    if (!result.ok) {
      return { success: false, message: result.error.message }
    }

    const nextUser = result.data
    setUser(nextUser)
    setStatus('authenticated')
    await mutateCache(() => true, undefined, { revalidate: false })
    storeAccountMetadata(nextUser)
    return { success: true }
  }

  const logout = async () => {
    const result = await accountClient.mutate('/api/auth/logout', 'POST')
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
      const nextUser = await accountClient.query<AuthUser>('/api/auth/me', { retry: false })
      setUser(nextUser)
      setStatus('authenticated')
      storeAccountMetadata(nextUser)
    } catch {
      setStatus('degraded')
    }
  }


  const activateOrganization = useCallback((workspace: WorkspaceSummary) => {
    if (workspace.type !== 'organization' || !workspace.organizationId) return
    setUser(current => current && current.organizationId === workspace.organizationId && current.organizationRole === workspace.memberRole
      ? current
      : current ? {
        ...current,
        organizationId: workspace.organizationId,
        organizationName: workspace.organizationName,
        organizationMembershipId: workspace.organizationMembershipId,
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
