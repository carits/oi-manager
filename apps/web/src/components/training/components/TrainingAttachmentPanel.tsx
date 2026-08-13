'use client'

import type { TrainingProblem, Attachment } from '../types'

function toExcelColumnName(index: number): string {
  let result = ''
  let i = index
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result
    i = Math.floor(i / 26) - 1
  }
  return result
}

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
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem' }}>
      {problems.map(p => {
        const atts = allAttachments[p.id] || []
        if (atts.length === 0) return null
        return (
          <div key={p.id} style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: '0.5rem' }}>{`${toExcelColumnName(p.orderIndex ?? 0)}. ${p.alias || p.problemTitle || '未命名题目'}`}</div>
            {atts.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--gray-100)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>附件</span>
                  <span>{a.fileName}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>{formatFileSize(a.fileSize)}</span>
                </div>
                <button
                  onClick={() => onDownload(a)}
                  style={{ padding: '0.25rem 0.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  下载
                </button>
              </div>
            ))}
          </div>
        )
      })}
      {Object.keys(allAttachments).length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--gray-400)' }}>暂无附件</div>
      )}
    </div>
  )
}
