'use client'

import { useList, ListResponse } from './useList'
import { UseFetchResult } from './useFetch'

export interface School {
  id: string
  name: string
  region: string | null
  schoolType: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  status: string
  createdAt: string
  principal?: {
    id: string
    name: string
    user: { username: string }
  } | null
}

export function useSchools(filters?: Record<string, any>, sessionKey?: string | null): UseFetchResult<ListResponse<School>> {
  return useList<School>('/api/platform/organizations', filters, sessionKey)
}
