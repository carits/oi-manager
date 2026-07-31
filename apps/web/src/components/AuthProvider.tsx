'use client'

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react'
import { getToken, getRole, getUserId, clearAuth, setToken, setRole, setUserId, setSchoolId, setSchoolName, setStudentMode, setLastStudentMode } from '@/lib/auth'
import apiClient from '@/lib/apiClient'

interface AuthUser {
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

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  authError: string | null
  login: (username: string, password: string, role: string, mode?: 'campus' | 'personal') => Promise<LoginResult>
  logout: () => void
  refreshUser: () => Promise<void>
  switchMode: (mode: 'campus' | 'personal') => Promise<void>
  isAuthenticated: boolean
  sessionKey: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  // 服务端和客户端第一次渲染必须一致，登录状态统一在挂载后验证。
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  // 基于登录身份生成 sessionKey，用于数据隔离
  const sessionKey = useMemo(() => {
    if (!user) return null
    return `${user.role}:${user.userId}`
  }, [user])

  const fetchUserData = async () => {
    const token = getToken()
    if (!token) {
      setAuthError(null)
      return null
    }

    setAuthError(null)
    const res = await apiClient.get<AuthUser>('/api/auth/me')

    if (res.success && res.data) {
      const userData = {
        userId: res.data.userId,
        username: res.data.username,
        role: res.data.role,
        avatar: res.data.avatar,
        phone: res.data.phone,
        email: res.data.email,
        bio: res.data.bio,
        profile: res.data.profile,
        schoolId: res.data.schoolId,
        schoolName: res.data.schoolName,
        studentMode: res.data.studentMode
      }
      setUser(userData)
      setSchoolId(res.data.schoolId || null)
      setSchoolName(res.data.schoolName || null)
      setStudentMode(res.data.studentMode || null)
      if (res.data.studentMode) {
        setLastStudentMode(res.data.studentMode)
      }
      return userData
    }

    // 只有认证失效时才清除本地状态；网络波动和服务端错误允许重试。
    if (res.status === 401 || res.status === 403) {
      clearAuth()
      setUser(null)
      return null
    }

    setAuthError(res.message || '登录状态验证失败，请重新加载')
    return null
  }

  useEffect(() => {
    const token = getToken()
    const role = getRole()
    const userId = getUserId()

    if (token && role && userId) {
      fetchUserData().finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (username: string, password: string, role: string, mode?: 'campus' | 'personal'): Promise<LoginResult> => {
    const res = await apiClient.post<{
      token: string
      userId: string
      role: string
      username: string
      avatar?: string | null
      schoolId?: string
      studentMode?: 'campus' | 'personal'
    }>('/api/auth/login', { username, password, role, mode })

    if (res.success && res.data) {
      const { token, userId, role: userRole, username: userName, avatar, schoolId, studentMode } = res.data
      setToken(token)
      setRole(userRole)
      setUserId(userId)
      setSchoolId(schoolId || null)
      setStudentMode(studentMode || null)
      if (studentMode) {
        setLastStudentMode(studentMode)
      }
      setAuthError(null)
      setUser({ userId, username: userName, role: userRole, avatar, schoolId, studentMode: studentMode || undefined })
      return { success: true }
    }
    return { success: false, message: res.message || '登录失败，请稍后重试' }
  }

  const logout = () => {
    clearAuth()
    setUser(null)
    window.location.href = '/login'
  }

  const switchMode = async (mode: 'campus' | 'personal') => {
    const token = getToken()
    if (!token) return

    const res = await apiClient.post<{ token: string; studentMode: 'campus' | 'personal' }>(
      '/api/auth/switch-mode',
      { mode }
    )

    if (res.success && res.data) {
      setToken(res.data.token)
      setStudentMode(res.data.studentMode)
      setLastStudentMode(res.data.studentMode)
      setUser(prev => prev ? { ...prev, studentMode: res.data!.studentMode } : null)
    }
  }

  const refreshUser = async () => {
    setLoading(true)
    try {
      await fetchUserData()
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        login,
        logout,
        refreshUser,
        switchMode,
        isAuthenticated: !!user,
        sessionKey
      }}
    >
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
