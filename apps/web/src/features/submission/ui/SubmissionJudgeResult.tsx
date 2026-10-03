'use client'

import { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { judgeResultLabel } from '@/lib/judge-constants'
import unifiedStyles from './SubmissionJudgeResult.unified.module.css'
import { Button } from '@/components/ui/Button'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import {
  buildJudgeResultRows,
  firstFailedCaseIndex,
  formatJudgeMemory,
  type JudgeCaseResult,
  type JudgeSubtaskResult,
} from '../model/judge-result'

interface SubmissionJudgeResultProps {
  judgeMode?: 'acm' | 'oi'
  result: string | null
  score?: number | null
  cases?: JudgeCaseResult[] | null
  subtasks?: JudgeSubtaskResult[] | null
  hidden?: boolean
}

const CASE_TONE: Record<string, { mark: string; tone: 'accepted' | 'skipped' }> = {
  Accepted: { mark: '✓', tone: 'accepted' },
  accepted: { mark: '✓', tone: 'accepted' },
  Skipped: { mark: '–', tone: 'skipped' },
  skipped: { mark: '–', tone: 'skipped' },
}

function verdictLabel(result: string | null): string {
  return judgeResultLabel(result)
}

export function SubmissionJudgeResult({
  judgeMode = 'acm',
  result,
  score,
  cases,
  subtasks,
  hidden,
}: SubmissionJudgeResultProps) {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  if (hidden) return null
  const rows = buildJudgeResultRows(judgeMode, cases, subtasks)
  const failedIndex = firstFailedCaseIndex(cases)
  const testCaseCount = rows.filter(row => row.kind === 'case').length

  return (
    <section aria-label="评测详情" className={unifiedStyles.u1}>
      <div className={unifiedStyles.u2}>
        <div className={unifiedStyles.summaryInfo}>
          {judgeMode === 'oi' && score != null && (
            <strong className={score >= 100 ? unifiedStyles.scoreFull : unifiedStyles.scorePartial}>{score} / 100</strong>
          )}
          <strong>{verdictLabel(result)}</strong>
          {judgeMode === 'acm' && failedIndex >= 0 && <span className={unifiedStyles.u3}>失败测试点 #{failedIndex + 1}</span>}
        </div>
        {testCaseCount > 0 && (
          <Button
            size="sm"
            variant="text"
            icon={expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded(current => !current)}
            className={unifiedStyles.disclosureButton}
          >
            {expanded ? `收起测试点（${testCaseCount}）` : `详细测试点（${testCaseCount}）`}
          </Button>
        )}
      </div>
      {testCaseCount > 0 && expanded && <div id={detailId} className={unifiedStyles.u4}>
        <TableRoot className={unifiedStyles.u5}>
          <TableHead>
            <TableRow className={unifiedStyles.u6}>
              <TableHeaderCell className={unifiedStyles.headerCell}>#</TableHeaderCell>
              <TableHeaderCell className={unifiedStyles.headerCell}>状态</TableHeaderCell>
              {judgeMode === 'oi' && <TableHeaderCell className={unifiedStyles.headerCellRight}>得分</TableHeaderCell>}
              <TableHeaderCell className={unifiedStyles.headerCellRight}>用时</TableHeaderCell>
              <TableHeaderCell className={unifiedStyles.headerCellRight}>内存</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, rowIndex) => {
              if (row.kind === 'subtask') {
                return (
                  <TableRow key={`subtask-${row.subtask.id}-${rowIndex}`} className={unifiedStyles.u7}>
                    <TableCell colSpan={judgeMode === 'oi' ? 5 : 4} className={unifiedStyles.u8}>
                      子任务 {row.subtask.id}
                      <span className={unifiedStyles.u9}>{row.subtask.cases?.length || 0} 个测试点</span>
                      <span className={unifiedStyles.u10}>{row.subtask.score} 分</span>
                    </TableCell>
                  </TableRow>
                )
              }
              const tone = CASE_TONE[row.testCase.result] || { mark: '✕', tone: 'failed' as const }
              return (
                <TableRow key={`case-${row.index}-${rowIndex}`} className={unifiedStyles.u11}>
                  <TableCell className={unifiedStyles.bodyCell}>{row.index + 1}</TableCell>
                  <TableCell className={unifiedStyles.bodyCell}>
                    <span className={unifiedStyles[`tone_${tone.tone}`]}>{tone.mark}</span>
                    <span className={unifiedStyles.u12}>{verdictLabel(row.testCase.result)}</span>
                  </TableCell>
                  {judgeMode === 'oi' && <TableCell className={unifiedStyles.bodyCellScore}>{row.testCase.score ?? '-'}</TableCell>}
                  <TableCell className={unifiedStyles.bodyCellRight}>{row.testCase.time != null ? `${row.testCase.time} ms` : '-'}</TableCell>
                  <TableCell className={unifiedStyles.bodyCellRight}>{formatJudgeMemory(row.testCase.memory)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </TableRoot>
      </div>}
    </section>
  )
}
