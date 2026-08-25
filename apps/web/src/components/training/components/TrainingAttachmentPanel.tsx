'use client'

import type { TrainingProblem, Attachment } from '../types'
import unifiedStyles from './TrainingAttachmentPanel.unified.module.css'
import { Button } from '@/components/ui/Button'
import { trainingProblemCode, trainingProblemSectionTitle } from '../problem-label'
import { hasTrainingAttachments } from '../attachment-state'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

interface TrainingAttachmentPanelProps {
  problems: TrainingProblem[]
  allAttachments: Record<string, Attachment[]>
  onDownload: (attachment: Attachment) => void
}

export function TrainingAttachmentPanel({ problems, allAttachments, onDownload }: TrainingAttachmentPanelProps) {
  return (
    <div className={unifiedStyles.u1}>
      {problems.map(p => {
        const atts = allAttachments[p.id] || []
        if (atts.length === 0) return null
        return (
          <div key={p.id} className={unifiedStyles.u2}>
            <div className={unifiedStyles.u3}>{`${trainingProblemCode(p.orderIndex)}. ${p.alias || trainingProblemSectionTitle(p)}`}</div>
            {atts.map(a => (
              <div key={a.id} className={unifiedStyles.u4}>
                <div className={unifiedStyles.u5}>
                  <span className={unifiedStyles.u6}>附件</span>
                  <span>{a.fileName}</span>
                  <span className={unifiedStyles.u7}>{formatFileSize(a.fileSize)}</span>
                </div>
                <Button variant="ghost"
                  onClick={() => onDownload(a)}
                  className={unifiedStyles.u8}
                >
                  下载
                </Button>
              </div>
            ))}
          </div>
        )
      })}
      {!hasTrainingAttachments(allAttachments) && (
        <div className={unifiedStyles.u9}>暂无附件</div>
      )}
    </div>
  )
}
