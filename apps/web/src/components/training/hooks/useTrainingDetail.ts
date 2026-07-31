import { useEffect, useState, useRef, useCallback } from 'react'
import apiClient from '@/lib/apiClient'
import type { TrainingInfo, TrainingProblem, ProblemDetail, ProblemListEntry } from '../types'

export function useTrainingDetail(trainingId: string) {
  const [training, setTraining] = useState<TrainingInfo | null>(null)
  const [problems, setProblems] = useState<TrainingProblem[]>([])
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null)
  const [problemDetail, setProblemDetail] = useState<ProblemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [noteContent, setNoteContent] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteEditMode, setNoteEditMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [editModeActive, setEditModeActive] = useState(false)
  const [problemListData, setProblemListData] = useState<ProblemListEntry[]>([])
  const [problemListLoading, setProblemListLoading] = useState(false)
  const [problemListError, setProblemListError] = useState<string | null>(null)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastNoteProblemIdRef = useRef<string | null>(null)
  const lastNoteContentRef = useRef('')

  // Contest record state
  const [recordContent, setRecordContent] = useState('')
  const [recordSaving, setRecordSaving] = useState(false)
  const [recordEditMode, setRecordEditMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [recordLoaded, setRecordLoaded] = useState(false)
  const [noteLastSaved, setNoteLastSaved] = useState<Date | null>(null)
  const [recordLastSaved, setRecordLastSaved] = useState<Date | null>(null)
  const recordSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Load training
  const loadTraining = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await apiClient.get<TrainingInfo>(`/api/trainings/${trainingId}`)
    if (res.success && res.data) {
      setTraining(res.data)
    } else {
      setTraining(null)
      setError(res.message || '加载训练失败')
      setLoading(false)
    }
  }, [trainingId])

  useEffect(() => { loadTraining() }, [loadTraining])

  // Load problems after training
  useEffect(() => {
    if (!training) return
    const loadProblems = async () => {
      try {
        const res = await apiClient.get<TrainingProblem[]>(`/api/trainings/${trainingId}/problems`)
        if (res.success && res.data) {
          setProblems(res.data)
          if (res.data.length > 0) {
            setSelectedProblemId(current => current || res.data![0].id)
          }
        } else {
          setProblems([])
          setError(res.message || '加载题目列表失败')
        }
      } finally {
        setLoading(false)
      }
    }
    loadProblems()
  }, [training, trainingId])

  // Load problem detail + note
  useEffect(() => {
    if (!selectedProblemId || !training) return
    const loadDetailAndNote = async () => {
      try {
        const [detailRes, noteRes] = await Promise.all([
          apiClient.get<ProblemDetail>(`/api/trainings/${trainingId}/problems/${selectedProblemId}/detail`),
          apiClient.get<{ content: string }>(`/api/trainings/${trainingId}/problems/${selectedProblemId}/note`),
        ])
        if (detailRes.success && detailRes.data) {
          setProblemDetail(detailRes.data)
          const visibleStatements = (detailRes.data.statements || []).filter(s => true)
          if (visibleStatements.length > 0) {
            const savedKey = localStorage.getItem(`training-stmt-pref-${selectedProblemId}`)
            const savedStmt = savedKey
              ? visibleStatements.find(s => `${s.format}-${s.language || 'unknown'}` === savedKey)
              : null
            if (savedStmt) {
              setSelectedStatementId(savedStmt.id)
            } else {
              const zhStatement = visibleStatements.find(s => s.format === 'markdown' && s.language === 'zh')
              setSelectedStatementId(zhStatement?.id || visibleStatements[0].id)
            }
          } else {
            setSelectedStatementId(null)
          }
        }
        if (noteRes.success && noteRes.data) {
          setNoteContent(noteRes.data.content || '')
        }
      } catch (error) {
        console.error('Failed to load problem detail/note:', error)
      }
    }
    loadDetailAndNote()
  }, [selectedProblemId, trainingId])

  // Auto-save note (immediately save old content when switching problems)
  useEffect(() => {
    if (!selectedProblemId) return

    // When switching problems, immediately save the old problem's content
    if (lastNoteProblemIdRef.current && lastNoteProblemIdRef.current !== selectedProblemId && lastNoteContentRef.current) {
      apiClient.put(`/api/trainings/${trainingId}/problems/${lastNoteProblemIdRef.current}/note`, { content: lastNoteContentRef.current }).catch(error => {
        console.error('Failed to save note on switch:', error)
      })
    }

    lastNoteProblemIdRef.current = selectedProblemId
    lastNoteContentRef.current = noteContent

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        setNoteSaving(true)
        await apiClient.put(`/api/trainings/${trainingId}/problems/${selectedProblemId}/note`, { content: noteContent })
        setNoteLastSaved(new Date())
      } catch (error) {
        console.error('Failed to save note:', error)
      } finally {
        setNoteSaving(false)
      }
    }, 2000)

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [noteContent, selectedProblemId, trainingId])

  // Load contest record when training is contest type
  useEffect(() => {
    if (!training || training.type !== 'contest' || recordLoaded) return
    const loadRecord = async () => {
      try {
        const res = await apiClient.get<{ content: string }>(`/api/trainings/${trainingId}/record`)
        if (res.success && res.data) {
          setRecordContent(res.data.content || '')
        }
      } catch (error) {
        console.error('Failed to load contest record:', error)
      } finally {
        setRecordLoaded(true)
      }
    }
    loadRecord()
  }, [training, trainingId, recordLoaded])

  // Auto-save contest record
  useEffect(() => {
    if (!recordLoaded) return
    if (recordSaveTimerRef.current) clearTimeout(recordSaveTimerRef.current)
    recordSaveTimerRef.current = setTimeout(async () => {
      try {
        setRecordSaving(true)
        await apiClient.put(`/api/trainings/${trainingId}/record`, { content: recordContent })
      } catch (error) {
        console.error('Failed to save contest record:', error)
      } finally {
        setRecordSaving(false)
        setRecordLastSaved(new Date())
      }
    }, 2000)
    return () => { if (recordSaveTimerRef.current) clearTimeout(recordSaveTimerRef.current) }
  }, [recordContent, trainingId, recordLoaded])

  // Load problem list (called externally when tab changes)
  const loadProblemListData = useCallback(async () => {
    setProblemListLoading(true)
    setProblemListError(null)
    const res = await apiClient.get<{ problems: ProblemListEntry[] }>(`/api/trainings/${trainingId}/problem-status`)
    if (res.success && res.data) {
      setProblemListData(res.data.problems)
    } else {
      setProblemListError(res.message || '加载题目状态失败')
    }
    setProblemListLoading(false)
  }, [trainingId])

  const clearProblemListData = useCallback(() => {
    setProblemListData([])
    setProblemListLoading(false)
    setProblemListError(null)
  }, [])

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
      await apiClient.put(`/api/trainings/${trainingId}/problems/${pid}/note`, { content })
      setNoteLastSaved(new Date())
    } catch (error) {
      console.error('Failed to save note:', error)
    } finally {
      setNoteSaving(false)
    }
  }, [selectedProblemId, noteContent, trainingId])

  // Manual save contest record
  const saveRecordNow = useCallback(async () => {
    if (recordSaveTimerRef.current) {
      clearTimeout(recordSaveTimerRef.current)
      recordSaveTimerRef.current = null
    }
    try {
      setRecordSaving(true)
      await apiClient.put(`/api/trainings/${trainingId}/record`, { content: recordContent })
      setRecordLastSaved(new Date())
    } catch (error) {
      console.error('Failed to save contest record:', error)
    } finally {
      setRecordSaving(false)
    }
  }, [recordContent, trainingId])

  return {
    training, setTraining,
    problems, setProblems,
    selectedProblemId, setSelectedProblemId,
    problemDetail,
    selectedStatementId, setSelectedStatementId,
    loading, error,
    noteContent, setNoteContent,
    noteSaving, noteLastSaved,
    noteEditMode, setNoteEditMode,
    editModeActive, setEditModeActive,
    recordContent, setRecordContent,
    recordSaving, recordLastSaved,
    recordEditMode, setRecordEditMode,
    problemListData, problemListLoading, problemListError,
    loadProblemListData, clearProblemListData,
    saveNoteNow, saveRecordNow,
    refresh: loadTraining,
  }
}
