'use client'

import type { ContestProblem, Attachment } from '../../model/types'
import unifiedStyles from './ContestAttachmentPanel.unified.module.css'
import { Button } from '@/components/ui/Button'
import { contestProblemCode, contestProblemSectionTitle } from '../problem-label'
import { hasContestAttachments } from '../attachment-state'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

interface ContestAttachmentPanelProps {
  problems: ContestProblem[]
  allAttachments: Record<string, Attachment[]>
  onDownload: (attachment: Attachment) => void
}

export function ContestAttachmentPanel({ problems, allAttachments, onDownload }: ContestAttachmentPanelProps) {
  return (
    <div className={unifiedStyles.u1}>
      {problems.map(p => {
        const atts = allAttachments[p.id] || []
        if (atts.length === 0) return null
        return (
          <div key={p.id} className={unifiedStyles.u2}>
            <div className={unifiedStyles.u3}>{`${contestProblemCode(p.orderIndex)}. ${p.alias || contestProblemSectionTitle(p)}`}</div>
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
      {!hasContestAttachments(allAttachments) && (
        <div className={unifiedStyles.u9}>暂无附件</div>
      )}
    </div>
  )
}
