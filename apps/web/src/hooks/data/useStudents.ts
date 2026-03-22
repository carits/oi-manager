'use client'

import { useList, ListResponse } from './useList'
import { UseFetchResult } from './useFetch'

export interface Student {
  id: string
  userId: string | null
  name: string
  gender: string | null
  schoolId: string | null
  headTeacherId: string | null
  enrollmentYear: number | null
  rating: number
  createdAt: string
  user?: {
    username: string
    status: string
  } | null
  school?: {
    id: string
    name: string
    educationSystem?: string | null
    schoolType?: string | null
  } | null
  teams?: Array<{
    team: {
      id: string
      name: string
    }
  }>
  headTeacher?: {
    id: string
    name: string
  } | null
}

export function useStudents(filters?: Record<string, any>, sessionKey?: string | null): UseFetchResult<ListResponse<Student>> {
  return useList<Student>('/api/students', filters, sessionKey)
}
