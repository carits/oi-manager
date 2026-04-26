import { useEffect, useState, useCallback, useRef } from 'react'
import apiClient from '@/lib/apiClient'
import type { SubmissionRow } from '../types'

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

  const loadSubmissions = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('page', String(submissionsPage))
      params.set('pageSize', '50')
      if (filterProblemId) params.set('problemId', filterProblemId)
      if (filterUsername) params.set('username', filterUsername)
      if (filterResult) params.set('result', filterResult)
      if (filterLanguage) params.set('language', filterLanguage)
      const res = await apiClient.get<{ submissions: SubmissionRow[]; page: number; totalPages: number; total: number }>(
        `/api/trainings/${trainingId}/submissions?${params.toString()}`
      )
      if (res.success && res.data) {
        setSubmissions(res.data.submissions)
        setSubmissionsTotal(res.data.total)
      }
    } catch (error) {
      console.error('Failed to load submissions:', error)
    }
  }, [trainingId, submissionsPage, filterProblemId, filterUsername, filterResult, filterLanguage])

  // Load when tab/filters/page change
  useEffect(() => {
    if (activeTab !== 'submissions') {
      setSubmissions([])
      setSubmissionsTotal(0)
      return
    }
    loadSubmissions()
  }, [activeTab, loadSubmissions])

  // Auto-poll when queuing/judging submissions exist
  const hasPending = submissions.some(s => s.result === 'queuing' || s.result === 'judging')

  useEffect(() => {
    if (activeTab !== 'submissions' || !hasPending) return
    const timer = setInterval(loadSubmissions, 5000)
    return () => clearInterval(timer)
  }, [activeTab, hasPending, loadSubmissions])

  const resetFilters = () => {
    setFilterProblemId('')
    setFilterUsername('')
    setFilterResult('')
    setFilterLanguage('')
    setSubmissionsPage(1)
  }

  return {
    submissions, submissionsPage, submissionsTotal,
    filterProblemId, setFilterProblemId,
    filterUsername, setFilterUsername,
    filterResult, setFilterResult,
    filterLanguage, setFilterLanguage,
    setSubmissionsPage,
    resetFilters,
    detailSubmissionId, setDetailSubmissionId,
  }
}
