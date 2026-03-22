'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import apiClient from '@/lib/apiClient'

/**
 * 团队成员
 */
export interface TeamMember {
  id: string
  name: string
  username?: string
  avatar?: string | null
  joinedAt?: string | null
}

/**
 * 团队管理员
 */
export interface TeamAdmin {
  id: string
  name: string
  username?: string
  avatar?: string | null
  adminType?: string
  type?: string
}

/**
 * 团队数据结构
 */
export interface TeamDetail {
  id: string
  name: string
  avatar?: string | null
  description?: string | null
  announcement?: string | null
  isPublic: boolean
  ownerType?: string  // 兼容旧格式
  requestStatus?: string | null  // 申请状态：'pending' | null
  school: { id: string; name: string }
  owner: { id: string; name: string; username?: string; avatar?: string | null; type?: string } | null
  admins: TeamAdmin[]
  students: TeamMember[]
  teachers?: TeamMember[]
  pendingTeachers?: Array<{
    id: string
    memberId: string
    name: string
    username?: string
    avatar?: string | null
    requestedAt?: string | null
  }>
}

/**
 * 加入申请（支持新格式和旧格式）
 */
export interface JoinRequest {
  id: string
  type?: 'student' | 'teacher'
  source?: string
  message?: string | null
  createdAt: string
  // 新格式：user 字段
  user?: {
    id: string
    name: string
    username?: string
    avatar?: string | null
    userType?: string
  } | null
  // 旧格式：student 字段（兼容）
  student?: {
    id: string
    name: string
    username?: string
    avatar?: string | null
  }
}

/**
 * useTeamDetail 返回值
 */
export interface UseTeamDetailResult {
  team: TeamDetail | null
  loading: boolean
  error: string | null
  joinRequests: JoinRequest[]
  refetch: () => Promise<void>
  fetchJoinRequests: () => Promise<void>
}

/**
 * 获取团队详情的 Hook
 *
 * @param teamId 团队ID
 * @param autoFetch 是否自动获取，默认true
 * @param sessionKey 会话标识，用于数据隔离
 */
export function useTeamDetail(
  teamId: string | null,
  autoFetch: boolean = true,
  sessionKey?: string | null
): UseTeamDetailResult {
  const [team, setTeam] = useState<TeamDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchTeam = useCallback(async () => {
    // 取消之前的请求
    abortControllerRef.current?.abort()

    if (!teamId || !sessionKey) {
      setLoading(false)
      setTeam(null)  // sessionKey 变化时清空数据
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      setLoading(true)
      setError(null)
      const result = await apiClient.get<TeamDetail>(`/api/teams/${teamId}`, {
        signal: controller.signal
      })

      if (result.success) {
        setTeam(result.data ?? null)
      } else {
        setError(result.message || '获取团队信息失败')
      }
    } catch (err: unknown) {
      // 忽略取消的请求
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('Failed to fetch team:', err)
      setError('获取团队信息失败')
    } finally {
      setLoading(false)
    }
  }, [teamId, sessionKey])

  const fetchJoinRequests = useCallback(async () => {
    if (!teamId || !sessionKey) return

    try {
      const result = await apiClient.get<JoinRequest[]>(`/api/teams/${teamId}/join-requests`)
      if (result.success) {
        setJoinRequests(result.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch join requests:', err)
    }
  }, [teamId, sessionKey])

  useEffect(() => {
    if (autoFetch && teamId) {
      fetchTeam()
    }
    return () => abortControllerRef.current?.abort()
  }, [teamId, autoFetch, fetchTeam])

  return {
    team,
    loading,
    error,
    joinRequests,
    refetch: fetchTeam,
    fetchJoinRequests
  }
}