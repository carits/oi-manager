'use client'

import { useCallback } from 'react'
import useSWR from 'swr'
import { ProblemListContracts, type ProblemListCollection, type ProblemListCreateInput, type ProblemListQuery } from '@oi-manager/contracts'
import apiClient, { type ApiError } from '@/lib/apiClient'
import { toResourceState } from '@/lib/resource'

const encoded = (value: string) => encodeURIComponent(value)

export const listProblemLists = (query: ProblemListQuery) => {
  const params = new URLSearchParams({
    tab: query.tab,
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.teamId) params.set('teamId', query.teamId)
  return apiClient.queryContract(ProblemListContracts.list, `/api/problem-lists?${params}`)
}

export function useProblemLists(query: ProblemListQuery, sessionKey?: string | null) {
  const key = ['problem-lists', sessionKey || 'anonymous', query] as const
  const fetcher = useCallback(([, , request]: typeof key) => listProblemLists(request), [])
  const result = useSWR<ProblemListCollection, ApiError>(key, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
    shouldRetryOnError: false,
  })
  return {
    ...result,
    state: toResourceState(result, data => data.lists.length === 0),
    retry: async () => { await result.mutate() },
  }
}

export const createProblemList = (body: ProblemListCreateInput) =>
  apiClient.mutateContract(ProblemListContracts.create, '/api/problem-lists', body)

export const deleteProblemList = (problemListId: string) =>
  apiClient.mutateContract(ProblemListContracts.delete, `/api/problem-lists/${encoded(problemListId)}`, {})
