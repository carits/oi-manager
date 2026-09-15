'use client'

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { getTeamDetail, listTeamJoinRequests } from '../api/teamApi'
import type { TeamDetail, TeamJoinRequest } from '@oi-manager/contracts'

export type { TeamDetail } from '@oi-manager/contracts'
export type JoinRequest = TeamJoinRequest

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
  const { data: team, error, isLoading, mutate } = useSWR<TeamDetail>(
    enabled ? ['team-detail', teamId, sessionKey] : null,
    () => getTeamDetail(teamId!),
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  )

  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])

  const fetchJoinRequests = useCallback(async () => {
    if (!teamId || !sessionKey) return
    try {
      setJoinRequests(await listTeamJoinRequests(teamId))
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
