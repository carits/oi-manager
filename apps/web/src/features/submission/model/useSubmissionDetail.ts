'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/apiClient'
import { getSubmissionDetail } from '../api/submissionApi'
import { shouldPollSubmissionDetail, shouldRetrySubmissionPoll } from './submission-polling'
import type { SubmissionDetailDto } from './submission-detail.types'

export interface SubmissionDetailLoadError {
  message: string
  status?: number
  code?: string
  requestId?: string
  retryable: boolean
}

function normalizeError(error: unknown): SubmissionDetailLoadError {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      status: error.status,
      code: error.code,
      requestId: error.requestId,
      retryable: shouldRetrySubmissionPoll(error),
    }
  }
  return {
    message: error instanceof Error ? error.message : '评测详情获取失败',
    retryable: shouldRetrySubmissionPoll(error),
  }
}

export function useSubmissionDetail(input: {
  submissionId: number | null
  trainingId?: number
  enabled?: boolean
  onSettled?: () => void
}) {
  const { submissionId, trainingId, enabled = true, onSettled } = input
  const [detail, setDetail] = useState<SubmissionDetailDto | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<SubmissionDetailLoadError | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const previousPollingRef = useRef(false)
  const mountedRef = useRef(true)

  const clearPending = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const fetchDetail = useCallback(async (initial = false) => {
    if (!enabled || !submissionId) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    if (initial) setLoading(true)

    try {
      const data = await getSubmissionDetail(submissionId, trainingId, controller.signal)
      if (!mountedRef.current || controller.signal.aborted) return
      setDetail(data)
      setError(null)

      const polling = shouldPollSubmissionDetail(data)
      if (previousPollingRef.current && !polling) onSettled?.()
      previousPollingRef.current = polling
      if (polling) pollTimerRef.current = setTimeout(() => void fetchDetail(false), 2000)

    } catch (loadError) {
      if (!mountedRef.current || controller.signal.aborted) return
      const normalized = normalizeError(loadError)
      setError(normalized)
      if (normalized.retryable && previousPollingRef.current) {
        pollTimerRef.current = setTimeout(() => void fetchDetail(false), 2000)
      } else if (!normalized.retryable) {
        setDetail(null)
        previousPollingRef.current = false
      }
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false)
    }
  }, [enabled, onSettled, submissionId, trainingId])

  useEffect(() => {
    mountedRef.current = true
    clearPending()
    setDetail(null)
    setError(null)
    previousPollingRef.current = false
    if (enabled && submissionId) void fetchDetail(true)
    else setLoading(false)
    return () => {
      mountedRef.current = false
      clearPending()
    }
  }, [clearPending, enabled, fetchDetail, submissionId])

  return {
    detail,
    loading,
    error,
    retry: () => void fetchDetail(true),
  }
}

