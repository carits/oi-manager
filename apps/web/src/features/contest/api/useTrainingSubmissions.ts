import { useEffect, useState, useCallback } from 'react'
import apiClient from '@/lib/apiClient'
import type { SubmissionRow } from '../model/types'

export function useTrainingSubmissions(
  trainingId: string,
  activeTab: string,
) {
  const [filterProblemId, setFilterProblemId] = useState('')
  const [filterUsername, setFilterUsername] = useState('')
  const [filterResult, setFilterResult] = useState('')
  const [filterLanguage, setFilterLanguage] = useState('')
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [submissionsPage, setSubmissionsPage] = useState(1)
  const [submissionsTotal, setSubmissionsTotal] = useState(0)
  const [detailSubmissionId, setDetailSubmissionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSubmissions = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(submissionsPage))
      params.set('pageSize', '50')
      if (filterProblemId) params.set('problemId', filterProblemId)
      if (filterUsername) params.set('username', filterUsername)
      if (filterResult) params.set('result', filterResult)
      if (filterLanguage) params.set('language', filterLanguage)

      const data = await apiClient.query<{
        submissions: SubmissionRow[]
        page: number
        totalPages: number
        total: number
      }>(
        `/api/trainings/${trainingId}/submissions?${params.toString()}`,
        { signal },
      )

      setSubmissions(data.submissions)
      setSubmissionsTotal(data.total)
    } catch (loadError) {
      if (signal?.aborted) return
      setError(loadError instanceof Error ? loadError.message : '评测记录获取失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [
    trainingId,
    submissionsPage,
    filterProblemId,
    filterUsername,
    filterResult,
    filterLanguage,
  ])

  useEffect(() => {
    if (activeTab !== 'submissions') return
    const controller = new AbortController()
    void loadSubmissions(controller.signal)
    return () => controller.abort()
  }, [activeTab, loadSubmissions])

  const hasPending = submissions.some(
    submission => submission.result === 'queuing' || submission.result === 'judging',
  )

  useEffect(() => {
    if (activeTab !== 'submissions' || !hasPending) return
    const timer = window.setInterval(() => {
      void loadSubmissions()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [activeTab, hasPending, loadSubmissions])

  const resetFilters = () => {
    setFilterProblemId('')
    setFilterUsername('')
    setFilterResult('')
    setFilterLanguage('')
    setSubmissionsPage(1)
  }

  return {
    submissions,
    submissionsPage,
    submissionsTotal,
    filterProblemId,
    setFilterProblemId,
    filterUsername,
    setFilterUsername,
    filterResult,
    setFilterResult,
    filterLanguage,
    setFilterLanguage,
    setSubmissionsPage,
    resetFilters,
    loading,
    error,
    retry: loadSubmissions,
    detailSubmissionId,
    setDetailSubmissionId,
  }
}
