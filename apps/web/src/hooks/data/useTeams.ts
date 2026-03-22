'use client'

import { useList, ListResponse } from './useList'
import { UseFetchResult } from './useFetch'

export interface Team {
  id: string
  name: string
  avatar?: string | null
  description: string | null
  announcement?: string | null
  schoolId: string
  ownerId: string
  isPublic: boolean
  createdAt: string
  school: {
    id: string
    name: string
  }
  owner: {
    id: string
    name: string
    title?: string | null
  }
  _count?: {
    members: number
    teacherMembers?: number
    admins?: number
  }
  requestStatus?: string | null // 学生端申请状态
}

export interface TeamsQueryParams {
  page?: number
  pageSize?: number
  teacherId?: string
  studentId?: string
  schoolId?: string
  view?: 'mine' | 'all'
}

export function useTeams(filters?: Record<string, any> | null, sessionKey?: string | null): UseFetchResult<ListResponse<Team>> {
  return useList<Team>('/api/teams', filters, sessionKey)
}

