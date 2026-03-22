'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAuthHeaders } from '@/lib/auth'

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
 */
export function useTeamDetail(
  teamId: string | null,
  autoFetch: boolean = true
): UseTeamDetailResult {
  const [team, setTeam] = useState<TeamDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])

  const fetchTeam = useCallback(async () => {
    if (!teamId) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`http://localhost:3001/api/teams/${teamId}`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        setTeam(data.data)
      } else {
        setError(data.message || '获取团队信息失败')
      }
    } catch (err) {
      console.error('Failed to fetch team:', err)
      setError('获取团队信息失败')
    } finally {
      setLoading(false)
    }
  }, [teamId])

  const fetchJoinRequests = useCallback(async () => {
    if (!teamId) return

    try {
      const res = await fetch(`http://localhost:3001/api/teams/${teamId}/join-requests`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        setJoinRequests(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch join requests:', err)
    }
  }, [teamId])

  useEffect(() => {
    if (autoFetch && teamId) {
      fetchTeam()
    }
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
