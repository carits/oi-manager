'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { UserIdentityLink } from '@/components/profile/UserIdentityLink'
import styles from '../TrainingWorkspace.module.css'

interface RankProblem {
  id: string
  alias?: string | null
  orderIndex?: number
  points?: number
}

interface ICPCProblemResult {
  solved: boolean
  attempts: number
  acceptedAtMinutes?: number | null
  isFirstAccepted: boolean
}

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

function scoreClass(score: number, max: number) {
  if (score >= max) return styles.scoreFull
  if (score > 0) return styles.scorePartial
  return styles.scoreZero
}

function describeICPCResult(label: string, result?: ICPCProblemResult) {
  if (!result || result.attempts === 0) {
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
      text: `-${result.attempts}`,
      description: `${label}：未通过，共 ${result.attempts} 次提交`,
      state: 'failed',
    }
  }

  const acceptedAtMinutes = Number.isFinite(result.acceptedAtMinutes)
    ? Math.max(0, Math.floor(result.acceptedAtMinutes as number))
    : null
  const minuteText = acceptedAtMinutes === null ? '?' : String(acceptedAtMinutes)
  const acceptedDescription = acceptedAtMinutes === null
    ? `第 ${result.attempts} 次提交通过，通过时间未知`
    : `第 ${result.attempts} 次提交，第 ${acceptedAtMinutes} 分钟通过`
  return {
    className: result.isFirstAccepted ? styles.scoreFirstAccepted : styles.icpcAccepted,
    text: `${result.attempts}/${minuteText}`,
    description: result.isFirstAccepted
      ? `${label}：首个通过，${acceptedDescription}`
      : `${label}：已通过，${acceptedDescription}`,
    state: result.isFirstAccepted ? 'first-accepted' : 'accepted',
  }
}

const medalClass = [styles.medal1, styles.medal2, styles.medal3]

interface TrainingRankTableProps {
  rankingData: any
  currentUserId?: string
}

export function TrainingRankTable({ rankingData, currentUserId }: TrainingRankTableProps) {
  const [query, setQuery] = useState('')
  const ranking = rankingData?.ranking || []
  const problems: RankProblem[] = rankingData?.problems || []
  const isScoreBased = rankingData?.format === 'ioi' || rankingData?.format === 'oi'
  const currentRank = currentUserId
    ? ranking.findIndex((row: any) => row.userId === currentUserId) + 1
    : 0
  const visibleRanking = useMemo(
    () => ranking
      .map((row: any, index: number) => ({ row, index }))
      .filter(({ row }: { row: any }) => {
        const value = `${row.name || ''} ${row.username || ''}`.toLocaleLowerCase()
        return !query || value.includes(query.toLocaleLowerCase())
      }),
    [query, ranking],
  )

  if (!rankingData) {
    return <div className={styles.surface}><div className={styles.locked}><span className="resource-skeleton-line" style={{ width: '8rem' }} aria-label="内容正在准备" /></div></div>
  }
  if (rankingData.hidden) {
    return <div className={styles.surface}><div className={styles.locked}><strong>排名暂不可见</strong><span>OI 赛制比赛结束后公布排名</span></div></div>
  }

  const columnCount = problems.length + (isScoreBased ? 3 : 4)
  const minimumTableWidth = 56 + 240 + (isScoreBased ? 80 : 176) + problems.length * 104

  return (
    <div className={styles.surface}>
      <div className={styles.rankIntro}>
        <div><strong>实时排名</strong></div>
        <div className={styles.rankSummary}>
          <span className={styles.summaryItem}>参赛 <strong>{ranking.length}</strong> 人</span>
          <span className={styles.summaryItem}>题目 <strong>{problems.length}</strong> 题</span>
          {currentRank > 0 && <span className={styles.summaryItem}>我的名次 <strong>#{currentRank}</strong></span>}
        </div>
      </div>
      <div className={styles.rankSearch}>
        <Search size={16} aria-hidden="true" />
        <label className="sr-only" htmlFor="training-ranking-search">搜索参赛者</label>
        <input
          id="training-ranking-search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索姓名或用户名"
        />
      </div>
      <div className={styles.scroll} data-testid="training-ranking-scroll">
        <table
          aria-label="比赛排名"
          className={`${styles.table} ${styles.rankTable}`}
          style={{ minWidth: `${minimumTableWidth}px` }}
        >
          <colgroup>
            <col className={styles.rankPositionColumn} />
            <col className={styles.rankParticipantColumn} />
            <col className={styles.rankPassedColumn} />
            {!isScoreBased && <col className={styles.rankPenaltyColumn} />}
            {problems.map(problem => <col className={styles.rankProblemColumn} key={problem.id} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={styles.center} scope="col">#</th>
              <th scope="col">参赛者</th>
              <th className={styles.center} scope="col">{isScoreBased ? '总分' : '通过'}</th>
              {!isScoreBased && <th className={styles.center} scope="col">罚时</th>}
              {problems.map(problem => (
                <th
                  className={`${styles.center} ${styles.rankProblemHeader}`}
                  data-problem-column="true"
                  key={problem.id}
                  scope="col"
                >
                  {problemLabel(problem)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRanking.map(({ row, index }: { row: any; index: number }) => (
              <tr key={row.userId} className={row.userId === currentUserId ? styles.rankRowCurrent : ''}>
                <td className={`${styles.center} ${styles.rankCell} ${styles.rankMetaCell} ${index < 3 ? medalClass[index] : ''}`}>{index + 1}</td>
                <td className={`${styles.rankParticipantCell} ${styles.rankMetaCell}`}>
                  <span className={styles.rankIdentity}>
                    <UserIdentityLink id={row.userId} userType={row.userType} name={row.name} username={row.username} avatar={row.avatar} avatarOnly size={32} />
                    <UserIdentityLink
                      id={row.userId}
                      userType={row.userType}
                      name={row.name}
                      username={row.username}
                      showUsername
                      currentSuffix={row.userId === currentUserId ? '（我）' : ''}
                      style={{ display: 'grid', alignItems: 'start', gap: '2px' }}
                    />
                  </span>
                </td>
                {isScoreBased ? (
                  <>
                    <td className={`${styles.center} ${styles.numeric} ${styles.rankMetaCell}`}><strong>{row.totalScore}</strong></td>
                    {problems.map(problem => {
                      const score = row.problems[problem.id]?.score ?? 0
                      return <td className={`${styles.center} ${styles.numeric} ${scoreClass(score, problem.points ?? 100)}`} key={problem.id}>{score}</td>
                    })}
                  </>
                ) : (
                  <>
                    <td className={`${styles.center} ${styles.numeric} ${styles.rankMetaCell}`}><strong>{row.solvedCount}</strong></td>
                    <td className={`${styles.center} ${styles.numeric} ${styles.muted} ${styles.rankMetaCell}`}>{row.totalPenalty}</td>
                    {problems.map(problem => {
                      const presentation = describeICPCResult(problemLabel(problem), row.problems[problem.id])
                      return (
                        <td
                          aria-label={presentation.description}
                          className={`${styles.center} ${styles.numeric} ${styles.icpcResultCell} ${presentation.className}`}
                          data-problem-column="true"
                          data-result={presentation.state}
                          key={problem.id}
                          title={presentation.description}
                        >
                          {presentation.text}
                        </td>
                      )
                    })}
                  </>
                )}
              </tr>
            ))}
            {visibleRanking.length === 0 && (
              <tr><td colSpan={columnCount} className={styles.empty}>{ranking.length === 0 ? '暂无排名数据' : '没有符合搜索条件的参赛者'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
