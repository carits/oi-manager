import { publicErrorMessage } from '@/lib/humanErrors'
import { useEffect, useState, useCallback } from 'react'
import { listContestSubmissions } from './contestApi'
import type { SubmissionRow } from '../model/types'

export function useContestSubmissions(
  contestId: string,
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
      const data = await listContestSubmissions(contestId, {
        page: submissionsPage,
        pageSize: 50,
        problemId: filterProblemId || undefined,
        username: filterUsername || undefined,
        result: filterResult || undefined,
        language: filterLanguage || undefined,
      }, signal)

      setSubmissions(data.submissions)
      setSubmissionsTotal(data.total)
    } catch (loadError) {
      if (signal?.aborted) return
      setError(publicErrorMessage(loadError, '评测记录获取失败'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [
    contestId,
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
