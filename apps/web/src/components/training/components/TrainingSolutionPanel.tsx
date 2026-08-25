'use client'

import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { Button } from '@/components/ui/Button'
import type { TrainingInfo, TrainingProblem } from '../types'
import { trainingProblemCode, trainingProblemSectionTitle } from '../problem-label'

interface SolutionData {
  content: string
  visible: boolean
  source?: 'training' | 'problem'
  solutionType?: string
  solutionPdfUrl?: string
  fileUrl?: string | null
  format?: string
  snapshotId?: string
}

interface TrainingSolutionPanelProps {
  training: TrainingInfo
  problems: TrainingProblem[]
  allSolutions: Record<string, SolutionData>
  onEditSolution?: (problem: TrainingProblem, solution: SolutionData) => void
}

export function TrainingSolutionPanel({ training, problems, allSolutions, onEditSolution }: TrainingSolutionPanelProps) {
  const trainingFinished = training.status === 'finished' || new Date() > new Date(training.endTime)
  const hideSolution = !training.solutionVisible && !trainingFinished && !training.isAdmin

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
            const pdfUrl = sol?.fileUrl || sol?.solutionPdfUrl
            const hasPdfSolution = (sol?.format === 'pdf' || sol?.solutionType === 'pdf') && pdfUrl
            const hasContent = sol?.content || hasPdfSolution
            if (!hasContent) return null
            return (
              <div key={p.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{`${trainingProblemCode(p.orderIndex)}. ${p.alias || trainingProblemSectionTitle(p)}`}</span>
                  {sol?.source === 'problem' && (
                    <span style={{ fontSize: '0.75rem', background: 'var(--bg-hover)', padding: '0.15rem 0.4rem', borderRadius: '4px', color: 'var(--gray-500)' }}>
                      原题目题解
                    </span>
                  )}
                  </div>
                  {training.isAdmin && sol.snapshotId && onEditSolution && <Button variant="ghost" onClick={() => onEditSolution(p, sol)} style={{ padding: '0.4rem 0.7rem', border: '1px solid var(--primary)', borderRadius: '6px', background: 'white', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}>编辑题解</Button>}
                </div>
                <div>
                  {hasPdfSolution ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <a
                        href={pdfUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <span>题解</span>
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
            const hasPdfSolution = (sol?.format === 'pdf' || sol?.solutionType === 'pdf') && (sol?.fileUrl || sol?.solutionPdfUrl)
            return !sol?.content && !hasPdfSolution
          }) && (
            <div style={{ textAlign: 'center', color: 'var(--gray-400)' }}>暂无题解</div>
          )}
        </>
      )}
    </div>
  )
}
