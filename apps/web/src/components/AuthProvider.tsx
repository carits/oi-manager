'use client'

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react'
import { getToken, getRole, getUserId, clearAuth, setToken, setRole, setUserId, setSchoolId, setSchoolName, setTeacherId, setStudentId, setAdminId } from '@/lib/auth'
import { ENV } from '@/config/env'

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
}

interface LoginResult {
  success: boolean
  message?: string
}

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (username: string, password: string, role: string) => Promise<LoginResult>
  logout: () => void
  refreshUser: () => Promise<void>
  isAuthenticated: boolean
  sessionKey: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // 基于登录身份生成 sessionKey，用于数据隔离
  const sessionKey = useMemo(() => {
    if (!user) return null
    return `${user.role}:${user.userId}:${user.teacherId || user.studentId || user.adminId || ''}`
  }, [user])

  const fetchUserData = async () => {
    const token = getToken()
    if (!token) return null

    try {
      const res = await fetch(`${ENV.API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()

      if (data.success) {
        const userData = {
          userId: data.data.userId,
          username: data.data.username,
          role: data.data.role,
          avatar: data.data.avatar,
          phone: data.data.phone,
          email: data.data.email,
          bio: data.data.bio,
          profile: data.data.profile,
          teacherId: data.data.teacherId,
          studentId: data.data.studentId,
          adminId: data.data.adminId,
          schoolId: data.data.schoolId,
          schoolName: data.data.schoolName
        }
        setUser(userData)
        setSchoolId(data.data.schoolId || null)
        setSchoolName(data.data.schoolName || null)
        setTeacherId(data.data.teacherId || null)
        setAdminId(data.data.adminId || null)
        return userData
      } else {
        // 只有在 401/403 等认证失败时才清除认证状态
        // 其他错误（如服务器错误）保留认证状态，让用户可以重试
        if (res.status === 401 || res.status === 403) {
          clearAuth()
        }
        return null
      }
    } catch {
      // 网络错误时不清除认证状态，保留 localStorage 中的 token
      // 用户可能是网络波动，刷新后可以恢复
      return null
    }
  }

  useEffect(() => {
    // 检查本地存储的 token
    const token = getToken()
    const role = getRole()
    const userId = getUserId()

    if (token && role && userId) {
      fetchUserData().finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (username: string, password: string, role: string): Promise<LoginResult> => {
    try {
      const res = await fetch(`${ENV.API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      })

      const data = await res.json()

      if (data.success) {
        const { token, userId, role: userRole, username: userName, avatar, teacherId, studentId, adminId, schoolId } = data.data
        setToken(token)
        setRole(userRole)
        setUserId(userId)
        setTeacherId(teacherId || null)
        setStudentId(studentId || null)
        setAdminId(adminId || null)
        setSchoolId(schoolId || null)
        setUser({ userId, username: userName, role: userRole, avatar, teacherId, studentId, adminId, schoolId })
        return { success: true }
      }
      return { success: false, message: data.message }
    } catch (error) {
      return { success: false, message: '网络错误，请稍后重试' }
    }
  }

  const logout = () => {
    clearAuth()
    setUser(null)
    window.location.href = '/login'
  }

  const refreshUser = async () => {
    await fetchUserData()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refreshUser,
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
