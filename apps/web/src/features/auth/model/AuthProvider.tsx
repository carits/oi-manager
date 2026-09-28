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
import { AUTH_UNAUTHORIZED_EVENT, ORGANIZATION_UNAVAILABLE_EVENT } from '@/lib/apiClient'
import type { CurrentAccount, WorkspaceSummary } from '@oi-manager/contracts'
import {
  loadCurrentAccount,
  loginAccount,
  logoutAccount,
} from '../api/authApi'

export type AuthUser = CurrentAccount

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
  prepareWorkspaceTransition: (workspace: WorkspaceSummary) => Promise<void>
  activateOrganization: (workspace: WorkspaceSummary) => void
  isAuthenticated: boolean
  sessionKey: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

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
    const handleUnauthorized = () => {
      if (!user) return
      void mutateCache(() => true, undefined, { revalidate: false })
      setUser(null)
      setStatus('anonymous')
      const target = `${window.location.pathname}${window.location.search}`
      window.location.assign(`/login?next=${encodeURIComponent(target)}`)
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [mutateCache, user])

  useEffect(() => {
    const handleUnavailableOrganization = (event: Event) => {
      void mutateCache(() => true, undefined, { revalidate: false })
      setUser(current => current ? {
        ...current,
        organizationId: undefined,
        organizationName: undefined,
        organizationMembershipId: undefined,
        organizationRole: undefined,
      } : null)
      const detail = event instanceof CustomEvent ? event.detail as { code?: unknown } : undefined
      const reason = typeof detail?.code === 'string' ? detail.code : 'UNKNOWN'
      window.location.assign(`/identity?organizationUnavailable=1&reason=${encodeURIComponent(reason)}`)
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
    void loadCurrentAccount(organizationId).then(nextUser => {
      if (cancelled) return
      setUser(nextUser)
      setStatus('authenticated')
      }).catch(() => {
      if (!cancelled) setStatus('degraded')
    })
    return () => { cancelled = true }
  }, [pathname, user?.userId, user?.organizationId, user?.organizationRole])


  const login = async (
    username: string,
    password: string,
  ): Promise<LoginResult> => {
    const result = await loginAccount(username, password)

    if (!result.ok) {
      return { success: false, message: result.error.message }
    }

    const nextUser = result.data
    setUser(nextUser)
    setStatus('authenticated')
    await mutateCache(() => true, undefined, { revalidate: false })
    return { success: true }
  }

  const logout = async () => {
    const result = await logoutAccount()
    if (!result.ok) {
      setStatus('degraded')
      return
    }
    await mutateCache(() => true, undefined, { revalidate: false })
    setUser(null)
    setStatus('anonymous')
    window.location.assign('/login')
  }

  const refreshUser = async () => {
    try {
      const nextUser = await loadCurrentAccount()
      setUser(nextUser)
      setStatus('authenticated')
    } catch {
      setStatus('degraded')
    }
  }


  const prepareWorkspaceTransition = useCallback(async (workspace: WorkspaceSummary) => {
    const organizationId = workspace.type === 'organization' ? workspace.organizationId : undefined
    const nextUser = await loadCurrentAccount(organizationId, { suppressOrganizationUnavailableEvent: true })
    if (!user || nextUser.userId !== user.userId) throw new Error('工作区账号身份已变化，请刷新后重试')
    if (workspace.type === 'organization') {
      if (!workspace.organizationId || nextUser.organizationId !== workspace.organizationId || !nextUser.organizationRole) {
        throw new Error('目标学校成员身份已失效，请刷新工作区列表')
      }
    } else if (workspace.type === 'personal' && nextUser.organizationId) {
      throw new Error('个人空间身份确认失败，请重试')
    }
    // Remove old workspace snapshots only after target authorization is confirmed.
    await mutateCache(() => true, undefined, { revalidate: false })
  }, [mutateCache, user])

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
      prepareWorkspaceTransition,
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
