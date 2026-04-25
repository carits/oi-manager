'use client'

import { useState, useCallback } from 'react'
import apiClient from '@/lib/apiClient'
import { useQuery } from '../useQuery'

export interface TeamMember {
  id: string
  name: string
  username?: string
  avatar?: string | null
  joinedAt?: string | null
}

export interface TeamAdmin {
  id: string
  name: string
  username?: string
  avatar?: string | null
  adminType?: string
  type?: string
}

export interface TeamDetail {
  id: string
  name: string
  avatar?: string | null
  description?: string | null
  announcement?: string | null
  isPublic: boolean
  ownerType?: string
  requestStatus?: string | null
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

export interface JoinRequest {
  id: string
  type?: 'student' | 'teacher'
  source?: string
  message?: string | null
  createdAt: string
  user?: {
    id: string
    name: string
    username?: string
    avatar?: string | null
    userType?: string
  } | null
  student?: {
    id: string
    name: string
    username?: string
    avatar?: string | null
  }
}

export interface UseTeamDetailResult {
  team: TeamDetail | null
  loading: boolean
  error: string | null
  joinRequests: JoinRequest[]
  refetch: () => Promise<void>
  fetchJoinRequests: () => Promise<void>
}

export function useTeamDetail(
  teamId: string | null,
  autoFetch: boolean = true,
  sessionKey?: string | null
): UseTeamDetailResult {
  const enabled = autoFetch && !!teamId && !!sessionKey
  const { data: team, error, isLoading, mutate } = useQuery<TeamDetail>(
    enabled ? `/api/teams/${teamId}` : null
  )

  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])

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

  return {
    team: team ?? null,
    loading: isLoading,
    error: error?.message || null,
    joinRequests,
    refetch: async () => { await mutate() },
    fetchJoinRequests,
  }
}
