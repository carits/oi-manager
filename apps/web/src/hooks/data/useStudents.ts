'use client'

import { useList, ListResponse } from './useList'
import { UseFetchResult } from './useFetch'

export interface Student {
  id: string
  userId: string | null
  name: string
  gender: string | null
  schoolId?: string | null
  membershipId?: string
  headTeacherId?: string | null
  headTeacherMembershipId?: string | null
  enrollmentYear: number | null
  rating: number
  status?: string
  createdAt: string
  user?: {
    username: string
    status: string
    avatar?: string | null
  } | null
  school?: {
    id: string
    name: string
    educationSystem?: string | null
    educationSystemDetail?: {
      primaryYears?: number
      middleYears?: number
      highYears?: number
    } | null
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

export interface StudentListResponse extends ListResponse<Student> {
  filters?: { grades: string[] }
}

export function useStudents(filters?: Record<string, any>, sessionKey?: string | null, endpoint = '/api/students'): UseFetchResult<StudentListResponse> {
  return useList<Student>(endpoint, filters, sessionKey) as UseFetchResult<StudentListResponse>
}
