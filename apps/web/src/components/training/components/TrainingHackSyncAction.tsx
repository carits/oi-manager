'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

type Preview = {
  pending: boolean
  currentRevision: number
  latestRevision: number
  revisionDelta: number
}

export function TrainingHackSyncAction({ trainingId, trainingProblemId }: { trainingId: string; trainingProblemId: string }) {
  const toast = useToast()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let active = true
    apiClient.get<Preview>(`/api/trainings/${trainingId}/problems/${trainingProblemId}/hack-sync-preview`)
      .then(result => { if (active && result.success && result.data) setPreview(result.data) })
    return () => { active = false }
  }, [trainingId, trainingProblemId])

  if (!preview?.pending) return null

  const sync = async () => {
    setSyncing(true)
    try {
      const result = await apiClient.post<{ currentRevision: number }>(`/api/trainings/${trainingId}/problems/${trainingProblemId}/hack-sync`)
      if (!result.success) return toast.error(result.message || '\u540c\u6b65\u5931\u8d25')
      toast.success(result.message || 'Hack \u6d4b\u8bd5\u6570\u636e\u5df2\u540c\u6b65')
      setPreview(current => current ? { ...current, pending: false, currentRevision: result.data?.currentRevision ?? current.latestRevision, revisionDelta: 0 } : current)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Button variant="ghost" type="button" onClick={sync} disabled={syncing} title={`test graph revision ${preview.currentRevision} -> ${preview.latestRevision}`} style={{ padding: '0.6rem 1rem', background: '#fffbeb', color: '#92400e', border: '1px solid #f59e0b', borderRadius: '6px', cursor: syncing ? 'wait' : 'pointer', fontSize: '0.82rem', fontWeight: 600, width: '100%' }}>
      {syncing ? '\u6b63\u5728\u540c\u6b65...' : `\u540c\u6b65 Hack \u6570\u636e (${preview.revisionDelta} revision)`}
    </Button>
  )
}
