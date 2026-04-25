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
  const [showNotePanel, setShowNotePanel] = useState(false)
  const [problemListData, setProblemListData] = useState<ProblemListEntry[]>([])
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Load training
  const loadTraining = useCallback(async () => {
    try {
      const res = await apiClient.get<TrainingInfo>(`/api/trainings/${trainingId}`)
      if (res.success && res.data) {
        setTraining(res.data)
      } else {
        setError(res.message || '加载训练失败')
        setLoading(false)
      }
    } catch {
      setError('网络错误，请稍后重试')
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
          if (res.data.length > 0 && !selectedProblemId) {
            setSelectedProblemId(res.data[0].id)
          }
        }
      } catch (error) {
        console.error('Failed to load problems:', error)
      } finally {
        setLoading(false)
      }
    }
    loadProblems()
  }, [training])

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
    setShowNotePanel(false)
  }, [selectedProblemId, trainingId])

  // Auto-save note
  useEffect(() => {
    if (!selectedProblemId || !showNotePanel) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        setNoteSaving(true)
        await apiClient.put(`/api/trainings/${trainingId}/problems/${selectedProblemId}/note`, { content: noteContent })
      } catch (error) {
        console.error('Failed to save note:', error)
      } finally {
        setNoteSaving(false)
      }
    }, 2000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [noteContent, selectedProblemId, trainingId, showNotePanel])

  // Load problem list (called externally when tab changes)
  const loadProblemListData = useCallback(async () => {
    try {
      const res = await apiClient.get<{ problems: ProblemListEntry[] }>(`/api/trainings/${trainingId}/problem-status`)
      if (res.success && res.data) {
        setProblemListData(res.data.problems)
      }
    } catch (error) {
      console.error('Failed to load problem list:', error)
    }
  }, [trainingId])

  const clearProblemListData = useCallback(() => setProblemListData([]), [])

  return {
    training, setTraining,
    problems, setProblems,
    selectedProblemId, setSelectedProblemId,
    problemDetail,
    selectedStatementId, setSelectedStatementId,
    loading, error,
    noteContent, setNoteContent,
    noteSaving,
    showNotePanel, setShowNotePanel,
    problemListData, loadProblemListData, clearProblemListData,
    refresh: loadTraining,
  }
}
