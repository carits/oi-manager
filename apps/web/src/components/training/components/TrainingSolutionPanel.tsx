'use client'

import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { Loading } from '@/components/Loading'
import { LoadError } from '@/components/ui/LoadError'
import type { TrainingInfo, TrainingProblem } from '../types'

function toExcelColumnName(index: number): string {
  let result = ''
  let i = index
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result
    i = Math.floor(i / 26) - 1
  }
  return result
}

interface SolutionData {
  content: string
  visible: boolean
  source?: 'training' | 'problem'
  solutionType?: string
  solutionPdfUrl?: string
}

interface TrainingSolutionPanelProps {
  training: TrainingInfo
  problems: TrainingProblem[]
  allSolutions: Record<string, SolutionData>
  loading: boolean
  error: string | null
  onRetry: () => void
}

export function TrainingSolutionPanel({
  training,
  problems,
  allSolutions,
  loading,
  error,
  onRetry,
}: TrainingSolutionPanelProps) {
  const trainingFinished = training.status === 'finished' || new Date() > new Date(training.endTime)
  const hideSolution = !training.solutionVisible && !trainingFinished && !training.isAdmin

  if (loading) return <Loading tip="正在加载题解..." />
  if (error) return <LoadError message={error} onRetry={onRetry} />

  return (
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem' }}>
      {hideSolution ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
          题解将在比赛结束后显示
        </div>
      ) : (
        <>
          {problems.map(p => {
            const sol = allSolutions[p.id]
            const hasPdfSolution = sol?.solutionType === 'pdf' && sol?.solutionPdfUrl
            const hasContent = sol?.content || hasPdfSolution
            if (!hasContent) return null
            return (
              <div key={p.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{toExcelColumnName(p.orderIndex)}. {p.alias || p.problemTitle || '未命名'}</span>
                  {sol?.source === 'problem' && (
                    <span style={{ fontSize: '0.75rem', background: 'var(--bg-hover)', padding: '0.15rem 0.4rem', borderRadius: '4px', color: 'var(--gray-500)' }}>
                      原题目题解
                    </span>
                  )}
                </div>
                <div>
                  {hasPdfSolution ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <a
                        href={sol!.solutionPdfUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <span>📄</span>
                        <span>查看 PDF 题解</span>
                      </a>
                    </div>
                  ) : sol?.content ? (
                    <div style={{ fontSize: '0.85rem', lineHeight: 1.6 }}><MarkdownRenderer content={sol.content} /></div>
                  ) : null}
                </div>
              </div>
            )
          })}
          {problems.every(p => {
            const sol = allSolutions[p.id]
            const hasPdfSolution = sol?.solutionType === 'pdf' && sol?.solutionPdfUrl
            return !sol?.content && !hasPdfSolution
          }) && (
            <div style={{ textAlign: 'center', color: 'var(--gray-400)' }}>暂无题解</div>
          )}
        </>
      )}
    </div>
  )
}
