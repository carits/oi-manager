'use client'

import useSWR from 'swr'
import type { TeamSummary } from '@oi-manager/contracts'
import { listTeams, type TeamListQuery } from '../api/teamApi'

export type Team = TeamSummary

export interface TeamsQueryParams {
  page?: number
  pageSize?: number
  teacherId?: string
  studentId?: string
  schoolId?: string
  view?: 'mine' | 'all'
}

export function useTeams(filters?: TeamListQuery | null, sessionKey?: string | null) {
  const enabled = Boolean(filters && sessionKey)
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ['teams', filters, sessionKey] : null,
    () => listTeams(filters!),
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  )
  return {
    data: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refetch: async () => { await mutate() },
  }
}

