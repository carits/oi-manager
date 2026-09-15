'use client'

import { type CSSProperties, useMemo, useState } from 'react'
import collisionStyles from './TrainingRankTable.collision.module.css'
import unifiedStyles from './TrainingRankTable.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { Search } from 'lucide-react'
import { UserIdentityLink } from '@/features/user-profile'
import styles from '../TrainingWorkspace.module.css'

interface RankProblem {
  id: string
  alias?: string | null
  orderIndex?: number
  points?: number
}

interface ICPCProblemResult {
  solved?: boolean
  attempts?: number
  submitted?: boolean
  acceptedAtMinutes?: number | null
  isFirstAccepted?: boolean
}

interface RankProblemResult extends ICPCProblemResult {
  score?: number
}

interface RankingRow {
  userId: string
  userType?: string
  name?: string
  username?: string
  avatar?: string | null
  rank?: number
  totalScore?: number
  solvedCount?: number
  totalPenalty?: number
  problems: Record<string, RankProblemResult>
  ratingChanges?: RankingRatingChange[]
}

interface TrainingRankingData {
  hidden?: boolean
  format?: RankingFormat
  ranking?: RankingRow[]
  problems?: RankProblem[]
}

interface RankingRatingChange {
  scope: string
  track: string
  organizationName?: string | null
  ratingBefore: number
  ratingAfter: number
  appliedDelta: number
}

function ratingChangeLabel(change: RankingRatingChange) {
  return change.scope === 'ORGANIZATION'
    ? `${change.organizationName || '学校'} ${change.track}`
    : `全局 ${change.track}`
}

type RankingFormat = 'oi' | 'ioi' | 'icpc'

const RANK_COLUMN_WIDTH = 52
const SCORE_COLUMN_WIDTH = 92
const ICPC_PASSED_COLUMN_WIDTH = 72
const ICPC_PENALTY_COLUMN_WIDTH = 84
const MOBILE_RANK_COLUMN_WIDTH = 44
const MOBILE_PARTICIPANT_COLUMN_WIDTH = 176
const MOBILE_PROBLEM_COLUMN_WIDTH = 88
const DESKTOP_TABLE_MAX_WIDTH = 1200

function toExcelColumnName(index: number) {
  let result = ''
  let current = index
  while (current >= 0) {
    result = String.fromCharCode(65 + (current % 26)) + result
    current = Math.floor(current / 26) - 1
  }
  return result
}

function problemLabel(problem: RankProblem) {
  return problem.alias?.trim() || toExcelColumnName(problem.orderIndex ?? 0)
}

function scoreClass(format: RankingFormat, score: number, max: number) {
  const state = score >= max ? 'full' : score > 0 ? 'partial' : 'zero'
  if (format === 'oi') {
    if (state === 'full') return styles.oiScoreFull
    if (state === 'partial') return styles.oiScorePartial
    return styles.oiScoreZero
  }
  if (state === 'full') return styles.ioiScoreFull
  if (state === 'partial') return styles.ioiScorePartial
  return styles.ioiScoreZero
}

function describeICPCResult(label: string, result?: ICPCProblemResult) {
  const attempts = result?.attempts ?? 0
  if (!result || attempts === 0) {
    return {
      className: styles.icpcUnsubmitted,
      text: '',
      description: `${label}：未提交`,
      state: 'unsubmitted',
    }
  }

  if (!result.solved) {
    return {
      className: styles.icpcFailed,
      text: `-${attempts}`,
      description: `${label}：未通过，共 ${attempts} 次提交`,
      state: 'failed',
    }
  }

  const acceptedAtMinutes = Number.isFinite(result.acceptedAtMinutes)
    ? Math.max(0, Math.floor(result.acceptedAtMinutes as number))
    : null
  const minuteText = acceptedAtMinutes === null ? '?' : String(acceptedAtMinutes)
  const acceptedDescription = acceptedAtMinutes === null
    ? `第 ${attempts} 次提交通过，通过时间未知`
    : `第 ${attempts} 次提交，第 ${acceptedAtMinutes} 分钟通过`
  return {
    className: result.isFirstAccepted ? styles.scoreFirstAccepted : styles.icpcAccepted,
    text: `${attempts}/${minuteText}`,
    description: result.isFirstAccepted
      ? `${label}：首个通过，${acceptedDescription}`
      : `${label}：已通过，${acceptedDescription}`,
    state: result.isFirstAccepted ? 'first-accepted' : 'accepted',
  }
}

const medalClass = [styles.medal1, styles.medal2, styles.medal3]

function rankingColumnWidths(format: RankingFormat, problemCount: number) {
  const participantWidth = problemCount <= 3 ? 272 : problemCount <= 5 ? 256 : problemCount <= 8 ? 240 : 224
  const minimumProblemWidth = problemCount <= 3 ? 112 : problemCount <= 5 ? 104 : 88
  const summaryWidth = format === 'icpc'
    ? ICPC_PASSED_COLUMN_WIDTH + ICPC_PENALTY_COLUMN_WIDTH
    : SCORE_COLUMN_WIDTH
  return {
    participantWidth,
    tableMinWidth: RANK_COLUMN_WIDTH + participantWidth + summaryWidth + problemCount * minimumProblemWidth,
    mobileTableWidth: MOBILE_RANK_COLUMN_WIDTH
      + MOBILE_PARTICIPANT_COLUMN_WIDTH
      + summaryWidth
      + problemCount * MOBILE_PROBLEM_COLUMN_WIDTH,
  }
}

interface TrainingRankTableProps {
  rankingData: TrainingRankingData | null
  currentUserId?: string
  canViewOtherSubmissions?: boolean
  onOpenSubmissions?: (context: RankingSubmissionContext) => void
}

export interface RankingSubmissionContext {
  userId: string
  userName?: string
  username?: string
  trainingProblemId: string
  problemAlias: string
}

export function TrainingRankTable({ rankingData, currentUserId, canViewOtherSubmissions = false, onOpenSubmissions }: TrainingRankTableProps) {
  const [query, setQuery] = useState('')
  const ranking = rankingData?.ranking || []
  const problems: RankProblem[] = rankingData?.problems || []
  const format: RankingFormat = rankingData?.format === 'oi' || rankingData?.format === 'ioi'
    ? rankingData.format
    : 'icpc'
  const isScoreBased = format !== 'icpc'
  const currentRank = currentUserId
    ? ranking.find((row) => row.userId === currentUserId)?.rank || ranking.findIndex((row) => row.userId === currentUserId) + 1
    : 0
  const visibleRanking = useMemo(
    () => ranking
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const value = `${row.name || ''} ${row.username || ''}`.toLocaleLowerCase()
        return !query || value.includes(query.toLocaleLowerCase())
      }),
    [query, ranking],
  )

  if (!rankingData) {
    return <div className={styles.surface}><div className={styles.locked}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div></div>
  }
  if (rankingData.hidden) {
    return <div className={styles.surface}><div className={styles.locked}><strong>排名暂不可见</strong><span>OI 赛制比赛结束后公布排名</span></div></div>
  }

  const columnCount = problems.length + (isScoreBased ? 3 : 4)
  const columnWidths = rankingColumnWidths(format, problems.length)
  const tableStyle = {
    '--rank-table-max-width': `${DESKTOP_TABLE_MAX_WIDTH}px`,
    '--rank-table-min-width': `${columnWidths.tableMinWidth}px`,
    '--rank-mobile-table-width': `${columnWidths.mobileTableWidth}px`,
    '--rank-participant-width': `${columnWidths.participantWidth}px`,
  } as CSSProperties

  return (
    <div className={styles.surface}>
      <div className={styles.rankIntro}>
        <div><strong>实时排名</strong></div>
        <div className={styles.rankSummary}>
          <span><strong>{ranking.length}</strong> 人参赛</span>
          <span aria-hidden="true">·</span>
          <span><strong>{problems.length}</strong> 道题</span>
          {currentRank > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>我的排名 <strong>{currentRank}</strong></span>
            </>
          )}
        </div>
      </div>
      <div className={styles.rankToolbar}>
        <div className={styles.rankSearch}>
          <Search size={16} aria-hidden="true" />
          <label className="sr-only" htmlFor="training-ranking-search">搜索参赛者</label>
          <Input
            id="training-ranking-search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索姓名或用户名"
          />
        </div>
      </div>
      <div className={styles.scroll} data-testid="training-ranking-scroll">
        <TableRoot
          aria-label="比赛排名"
          className={`${styles.table} ${styles.rankTable}`}
          data-ranking-format={format}
          style={tableStyle}
        >
          <colgroup>
            <col className={styles.rankPositionColumn} />
            <col className={styles.rankParticipantColumn} />
            <col className={isScoreBased ? styles.rankScoreColumn : styles.rankPassedColumn} />
            {format === 'icpc' && <col className={styles.rankPenaltyColumn} />}
            {problems.map(problem => <col className={styles.rankProblemColumn} key={problem.id} />)}
          </colgroup>
          <TableHead>
            <TableRow>
              <TableHeaderCell className={`${styles.center} ${styles.rankStickyPosition}`} scope="col">#</TableHeaderCell>
              <TableHeaderCell className={styles.rankStickyParticipant} scope="col">参赛者</TableHeaderCell>
              <TableHeaderCell className={styles.center} scope="col">{isScoreBased ? '总分' : '通过'}</TableHeaderCell>
              {format === 'icpc' && <TableHeaderCell className={styles.center} scope="col">罚时</TableHeaderCell>}
              {problems.map(problem => (
                <TableHeaderCell
                  className={`${styles.center} ${styles.rankProblemHeader}`}
                  data-problem-column="true"
                  key={problem.id}
                  scope="col"
                >
                  <span className={styles.rankProblemLabel}>{problemLabel(problem)}</span>
                  {isScoreBased && (
                    <span className={styles.rankProblemPoints}>{problem.points ?? 100} 分</span>
                  )}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRanking.map(({ row, index }) => (
              <TableRow key={row.userId} className={row.userId === currentUserId ? styles.rankRowCurrent : ''}>
                <TableCell className={`${styles.center} ${styles.rankCell} ${styles.rankMetaCell} ${styles.rankStickyPosition} ${(row.rank || index + 1) <= 3 ? medalClass[(row.rank || index + 1) - 1] : ''}`}>{row.rank || index + 1}</TableCell>
                <TableCell className={`${styles.rankParticipantCell} ${styles.rankMetaCell} ${styles.rankStickyParticipant}`}>
                  <span className={styles.rankIdentity}>
                    <UserIdentityLink id={row.userId} userType={row.userType} name={row.name} username={row.username} avatar={row.avatar} avatarOnly size={32} />
                    <span className={styles.rankIdentityText} title={row.username ? `${row.name || row.username}（${row.username}）` : row.name}>
                      <UserIdentityLink
                        id={row.userId}
                        userType={row.userType}
                        name={row.name}
                        username={row.username}
                        currentSuffix={row.userId === currentUserId ? '（我）' : ''}
                        className={unifiedStyles.u1}
                      />
                      {row.username && row.username !== row.name && (
                        <span className={styles.rankUsername}>{row.username}</span>
                      )}
                      {row.ratingChanges?.map((change: RankingRatingChange) => (
                        <span className={styles.rankRatingChange} key={`${change.scope}:${change.track}:${change.organizationName || ''}`}>
                          {ratingChangeLabel(change)}：{change.ratingBefore} → {change.ratingAfter}（{change.appliedDelta >= 0 ? '+' : ''}{change.appliedDelta}）
                        </span>
                      ))}
                    </span>
                  </span>
                </TableCell>
                {isScoreBased ? (
                  <>
                    <TableCell className={`${styles.center} ${styles.numeric} ${format === 'ioi' ? styles.ioiTotalScore : styles.oiTotalScore}`}><strong>{row.totalScore}</strong></TableCell>
                    {problems.map(problem => {
                      const problemResult = row.problems[problem.id]
                      const score = problemResult?.score ?? 0
                      const maxScore = problem.points ?? 100
                      const canOpen = Boolean(onOpenSubmissions && problemResult?.submitted && (canViewOtherSubmissions || row.userId === currentUserId))
                      const open = () => { if (canOpen) onOpenSubmissions?.({ userId: row.userId, userName: row.name, username: row.username, trainingProblemId: problem.id, problemAlias: problemLabel(problem) }) }
                      return (
                        <TableCell
                          aria-label={canOpen ? `${problemLabel(problem)}：${score} 分，满分 ${maxScore} 分，点击查看提交记录` : `${problemLabel(problem)}：${score} 分，满分 ${maxScore} 分`}
                          data-score-state={score >= maxScore ? 'full' : score > 0 ? 'partial' : 'zero'}
                          data-clickable={canOpen || undefined}
                          onClick={open}
                          onKeyDown={event => { if (canOpen && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }}
                          role={canOpen ? 'button' : undefined}
                          tabIndex={canOpen ? 0 : undefined}
                          title={canOpen ? `${problemLabel(problem)}：${score} / ${maxScore} 分，点击查看提交记录` : `${problemLabel(problem)}：${score} / ${maxScore} 分`}
                          className={`${styles.center} ${styles.numeric} ${styles.rankScoreCell} ${scoreClass(format, score, maxScore)} ${canOpen ? styles.rankInteractiveCell : ''}`}
                          key={problem.id}
                        >
                          {score}
                        </TableCell>
                      )
                    })}
                  </>
                ) : (
                  <>
                    <TableCell className={`${styles.center} ${styles.numeric}`}><strong>{row.solvedCount}</strong></TableCell>
                    <TableCell className={`${styles.center} ${styles.numeric} ${styles.muted}`}>{row.totalPenalty}</TableCell>
                    {problems.map(problem => {
                      const problemResult = row.problems[problem.id]
                      const presentation = describeICPCResult(problemLabel(problem), problemResult)
                      const canOpen = Boolean(onOpenSubmissions && problemResult?.submitted && (canViewOtherSubmissions || row.userId === currentUserId))
                      const open = () => { if (canOpen) onOpenSubmissions?.({ userId: row.userId, userName: row.name, username: row.username, trainingProblemId: problem.id, problemAlias: problemLabel(problem) }) }
                      return (
                        <TableCell
                          aria-label={canOpen ? `${presentation.description}，点击查看提交记录` : presentation.description}
                          className={`${styles.center} ${styles.numeric} ${styles.icpcResultCell} ${presentation.className} ${canOpen ? styles.rankInteractiveCell : ''}`}
                          data-problem-column="true"
                          data-result={presentation.state}
                          data-clickable={canOpen || undefined}
                          onClick={open}
                          onKeyDown={event => { if (canOpen && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }}
                          role={canOpen ? 'button' : undefined}
                          tabIndex={canOpen ? 0 : undefined}
                          title={canOpen ? `${presentation.description}，点击查看提交记录` : presentation.description}
                          key={problem.id}
                        >
                          {presentation.text}
                        </TableCell>
                      )
                    })}
                  </>
                )}
              </TableRow>
            ))}
            {visibleRanking.length === 0 && (
              <TableRow><TableCell colSpan={columnCount} className={styles.empty}>{ranking.length === 0 ? '暂无排名数据' : '没有符合搜索条件的参赛者'}</TableCell></TableRow>
            )}
          </TableBody>
        </TableRoot>
      </div>
    </div>
  )
}
