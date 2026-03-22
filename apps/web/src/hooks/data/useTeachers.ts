'use client'

import { useList, ListResponse } from './useList'
import { UseFetchResult } from './useFetch'

export interface Teacher {
  id: string
  userId: string
  name: string
  schoolId: string | null
  title: string | null
  phone: string | null
  createdAt: string
  user: {
    username: string
    role: string
    status: string
  }
  school?: {
    id: string
    name: string
  } | null
}

export function useTeachers(filters?: Record<string, any>, sessionKey?: string | null): UseFetchResult<ListResponse<Teacher>> {
  return useList<Teacher>('/api/teachers', filters, sessionKey)
}
