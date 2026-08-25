'use client'

import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import unifiedStyles from './TrainingSolutionPanel.unified.module.css'
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
    <div className={unifiedStyles.u1}>
      {hideSolution ? (
        <div className={unifiedStyles.u2}>
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
              <div key={p.id} className={unifiedStyles.u3}>
                <div className={unifiedStyles.u4}>
                  <div className={unifiedStyles.u5}>
                  <span className={unifiedStyles.u6}>{`${trainingProblemCode(p.orderIndex)}. ${p.alias || trainingProblemSectionTitle(p)}`}</span>
                  {sol?.source === 'problem' && (
                    <span className={unifiedStyles.u7}>
                      原题目题解
                    </span>
                  )}
                  </div>
                  {training.isAdmin && sol.snapshotId && onEditSolution && <Button variant="ghost" onClick={() => onEditSolution(p, sol)} className={unifiedStyles.u8}>编辑题解</Button>}
                </div>
                <div>
                  {hasPdfSolution ? (
                    <div className={unifiedStyles.u5}>
                      <a
                        href={pdfUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={unifiedStyles.u9}
                      >
                        <span>题解</span>
                        <span>查看 PDF 题解</span>
                      </a>
                    </div>
                  ) : sol?.content ? (
                    <div className={unifiedStyles.u10}><MarkdownRenderer content={sol.content} /></div>
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
            <div className={unifiedStyles.u11}>暂无题解</div>
          )}
        </>
      )}
    </div>
  )
}
