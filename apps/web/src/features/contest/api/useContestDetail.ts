import { useEffect, useState, useRef, useCallback } from 'react'
import apiClient from '@/lib/apiClient'
import { useResource } from '@/hooks/useResource'
import type { ResourceState } from '@/lib/resource'
import type { ContestInfo, ContestProblem, ProblemDetail, ProblemListEntry } from '../model/types'

interface ContestOverview {
  contest: ContestInfo
  problems: ContestProblem[]
  problemStatus: ProblemListEntry[]
}

export function useContestDetail(
  contestId: string,
  activeTab: string,
  sessionKey: string | null,
) {
  const [selectedProblemId, setSelectedProblemIdState] = useState<string | null>(null)
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [noteContent, setNoteContent] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteEditMode, setNoteEditMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [editModeActive, setEditModeActive] = useState(false)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastNoteProblemIdRef = useRef<string | null>(null)
  const lastNoteContentRef = useRef('')
  const loadedNoteProblemIdRef = useRef<string | null>(null)
  const lastSavedNoteContentRef = useRef('')

  // Contest record state
  const [recordContent, setRecordContent] = useState('')
  const [recordSaving, setRecordSaving] = useState(false)
  const [recordEditMode, setRecordEditMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [recordLoaded, setRecordLoaded] = useState(false)
  const lastSavedRecordContentRef = useRef('')
  const [noteLastSaved, setNoteLastSaved] = useState<Date | null>(null)
  const [recordLastSaved, setRecordLastSaved] = useState<Date | null>(null)
  const recordSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  const overviewResource = useResource<ContestOverview>(
    `/api/contests/${contestId}/overview`,
    {
      sessionKey,
      keepPreviousData: false,
      isEmpty: () => false,
      dedupingInterval: 30000,
    },
  )
  const overview =
    overviewResource.data ??
    (overviewResource.state.state === 'error'
      ? overviewResource.state.previousData
      : undefined)
  const contest = overview?.contest ?? null
  const problems = overview?.problems ?? []
  const loading = overviewResource.state.state === 'pending'
  const error =
    overviewResource.state.state === 'error' && !overviewResource.state.previousData
      ? overviewResource.state.error.userMessage
      : null
  const refreshError =
    overviewResource.state.state === 'error' && overviewResource.state.previousData
      ? overviewResource.state.error
      : null
  const problemListData = overview?.problemStatus ?? []
  const problemListState: ResourceState<ProblemListEntry[]> = refreshError
    ? {
        state: 'error',
        error: refreshError,
        previousData: problemListData,
      }
    : loading
      ? { state: 'pending' }
      : problemListData.length === 0
        ? { state: 'empty' }
        : {
            state: 'ready',
            data: problemListData,
            refreshing: overviewResource.isValidating,
          }

  useEffect(() => {
    setSelectedProblemIdState(current =>
      current && problems.some(problem => problem.id === current)
        ? current
        : problems[0]?.id ?? null,
    )
  }, [problems])

  const problemDetailResource = useResource<ProblemDetail>(
    selectedProblemId && contest && activeTab === 'problems'
      ? `/api/contests/${contestId}/problems/${selectedProblemId}/detail`
      : null,
    {
      sessionKey,
      keepPreviousData: false,
      isEmpty: () => false,
      dedupingInterval: 30000,
    },
  )
  const problemDetail =
    problemDetailResource.data ??
    (problemDetailResource.state.state === 'error'
      ? problemDetailResource.state.previousData ?? null
      : null)

  // Initialize the problem workspace once. Revalidation must not overwrite a
  // locally edited note that has not been saved yet.
  useEffect(() => {
    if (
      !problemDetail ||
      !selectedProblemId ||
      loadedNoteProblemIdRef.current === selectedProblemId
    ) {
      return
    }

    const visibleStatements = problemDetail.statements || []
    if (visibleStatements.length > 0) {
      const savedKey = localStorage.getItem(`contest-stmt-pref-${contestId}-${selectedProblemId}`)
      const savedStatement = savedKey
        ? visibleStatements.find(statement => statement.id === savedKey)
        : null
      const preferredStatement =
        savedStatement ||
        visibleStatements.find(statement => statement.isDefault) ||
        visibleStatements.find(
          statement => statement.format === 'markdown' && statement.language === 'zh',
        ) ||
        visibleStatements[0]
      setSelectedStatementId(preferredStatement.id)
    } else {
      setSelectedStatementId(null)
    }

    const content = problemDetail.noteContent || ''
    loadedNoteProblemIdRef.current = selectedProblemId
    lastSavedNoteContentRef.current = content
    lastNoteProblemIdRef.current = selectedProblemId
    lastNoteContentRef.current = content
    setNoteContent(content)
  }, [problemDetail, selectedProblemId])

  // Auto-save note (immediately save old content when switching problems)
  useEffect(() => {
    if (!selectedProblemId || loadedNoteProblemIdRef.current !== selectedProblemId) return

    lastNoteProblemIdRef.current = selectedProblemId
    lastNoteContentRef.current = noteContent
    if (noteContent === lastSavedNoteContentRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        setNoteSaving(true)
        const result = await apiClient.mutate(
          `/api/contests/${contestId}/problems/${selectedProblemId}/note`,
          'PUT',
          { content: noteContent },
        )
        if (!result.ok) throw result.error
        lastSavedNoteContentRef.current = noteContent
        setNoteLastSaved(new Date())
      } catch (error) {
        console.error('Failed to save note:', error)
      } finally {
        setNoteSaving(false)
      }
    }, 2000)

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [noteContent, selectedProblemId, contestId])

  // Load contest record when contest is contest type
  useEffect(() => {
    if (!contest || contest.type !== 'contest' || recordLoaded) return
    const loadRecord = async () => {
      try {
      const data = await apiClient.query<{ content: string }>(`/api/contests/${contestId}/record`)
      const content = data.content || ''
      lastSavedRecordContentRef.current = content
      setRecordContent(content)
      } catch (error) {
        console.error('Failed to load contest record:', error)
      } finally {
        setRecordLoaded(true)
      }
    }
    loadRecord()
  }, [contest, contestId, recordLoaded])

  // Auto-save contest record
  useEffect(() => {
    if (!recordLoaded) return
    if (recordContent === lastSavedRecordContentRef.current) return
    if (recordSaveTimerRef.current) clearTimeout(recordSaveTimerRef.current)
    recordSaveTimerRef.current = setTimeout(async () => {
      try {
        setRecordSaving(true)
        const result = await apiClient.mutate(
          `/api/contests/${contestId}/record`,
          'PUT',
          { content: recordContent },
        )
        if (!result.ok) throw result.error
        lastSavedRecordContentRef.current = recordContent
      } catch (error) {
        console.error('Failed to save contest record:', error)
      } finally {
        setRecordSaving(false)
        setRecordLastSaved(new Date())
      }
    }, 2000)
    return () => { if (recordSaveTimerRef.current) clearTimeout(recordSaveTimerRef.current) }
  }, [recordContent, contestId, recordLoaded])

  const setSelectedProblemId = useCallback((nextProblemId: string | null) => {
    const previousProblemId = selectedProblemId
    const hasUnsavedNote =
      previousProblemId &&
      loadedNoteProblemIdRef.current === previousProblemId &&
      noteContent !== lastSavedNoteContentRef.current

    if (hasUnsavedNote) {
      void apiClient.mutate(
        `/api/contests/${contestId}/problems/${previousProblemId}/note`,
        'PUT',
        { content: noteContent },
      )
    }

    loadedNoteProblemIdRef.current = null
    setSelectedProblemIdState(nextProblemId)
  }, [noteContent, selectedProblemId, contestId])

  // Manual save note (immediately save without waiting for debounce)
  const saveNoteNow = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pid = lastNoteProblemIdRef.current || selectedProblemId
    const content = lastNoteContentRef.current || noteContent
    if (!pid) return
    try {
      setNoteSaving(true)
      await apiClient.put(`/api/contests/${contestId}/problems/${pid}/note`, { content })
      setNoteLastSaved(new Date())
    } catch (error) {
      console.error('Failed to save note:', error)
    } finally {
      setNoteSaving(false)
    }
  }, [selectedProblemId, noteContent, contestId])

  // Manual save contest record
  const saveRecordNow = useCallback(async () => {
    if (recordSaveTimerRef.current) {
      clearTimeout(recordSaveTimerRef.current)
      recordSaveTimerRef.current = null
    }
    try {
      setRecordSaving(true)
      const result = await apiClient.mutate(
        `/api/contests/${contestId}/record`,
        'PUT',
        { content: recordContent },
      )
      if (!result.ok) throw result.error
      lastSavedRecordContentRef.current = recordContent
      setRecordLastSaved(new Date())
    } catch (error) {
      console.error('Failed to save contest record:', error)
    } finally {
      setRecordSaving(false)
    }
  }, [recordContent, contestId])

  return {
    contest,
    problems,
    selectedProblemId, setSelectedProblemId,
    problemDetail,
    selectedStatementId, setSelectedStatementId,
    problemDetailState: problemDetailResource.state,
    retryProblemDetail: problemDetailResource.retry,
    loading, error,
    refreshError,
    noteContent, setNoteContent,
    noteSaving, noteLastSaved,
    noteEditMode, setNoteEditMode,
    editModeActive, setEditModeActive,
    recordContent, setRecordContent,
    recordSaving, recordLastSaved,
    recordEditMode, setRecordEditMode,
    problemListData,
    problemListState,
    loadProblemListData: overviewResource.retry,
    saveNoteNow, saveRecordNow,
    refresh: overviewResource.retry,
  }
}
