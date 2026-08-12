'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { UserIdentityLink } from '@/components/profile/UserIdentityLink'
import styles from '../TrainingWorkspace.module.css'

function toExcelColumnName(index: number) { let result = ''; let i = index; while (i >= 0) { result = String.fromCharCode(65 + (i % 26)) + result; i = Math.floor(i / 26) - 1 } return result }
function scoreClass(score: number, max: number) { if (score >= max) return styles.scoreFull; if (score > 0) return styles.scorePartial; return styles.scoreZero }
const medalClass = [styles.medal1, styles.medal2, styles.medal3]

interface TrainingRankTableProps { rankingData: any; currentUserId?: string }
export function TrainingRankTable({ rankingData, currentUserId }: TrainingRankTableProps) {
  if (!rankingData) return <div className={styles.surface}><div className={styles.locked}><span className="resource-skeleton-line" style={{ width: '8rem' }} aria-label="内容正在准备" /></div></div>
  if (rankingData.hidden) return <div className={styles.surface}><div className={styles.locked}><strong>排名暂不可见</strong><span>OI 赛制比赛结束后公布排名</span></div></div>
  const isScoreBased = rankingData.format === 'ioi' || rankingData.format === 'oi'
  const ranking = rankingData.ranking || []; const problems = rankingData.problems || []
  const currentRank = currentUserId ? ranking.findIndex((row: any) => row.userId === currentUserId) + 1 : 0
  const [query, setQuery] = useState('')
  const visibleRanking = useMemo(() => ranking.map((row: any, index: number) => ({ row, index })).filter(({ row }: { row: any }) => {
    const value = `${row.name || ''} ${row.username || ''}`.toLocaleLowerCase()
    return !query || value.includes(query.toLocaleLowerCase())
  }), [query, ranking])
  return <div className={styles.surface}>
    <div className={styles.rankIntro}><div><strong>实时排名</strong></div><div className={styles.rankSummary}><span className={styles.summaryItem}>参赛 <strong>{ranking.length}</strong> 人</span><span className={styles.summaryItem}>题目 <strong>{problems.length}</strong> 题</span>{currentRank > 0 && <span className={styles.summaryItem}>我的名次 <strong>#{currentRank}</strong></span>}</div></div>
    <div className={styles.rankSearch}><Search size={16} aria-hidden="true" /><label className="sr-only" htmlFor="training-ranking-search">搜索参赛者</label><input id="training-ranking-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索姓名或用户名" /></div>
    <div className={styles.scroll}><table className={`${styles.table} ${styles.rankTable}`}><thead><tr><th className={styles.center}>#</th><th>姓名</th><th>用户名</th>{isScoreBased ? <><th className={styles.center}>总分</th>{problems.map((p: any) => <th className={styles.center} key={p.id}>{toExcelColumnName(p.orderIndex ?? 0)}</th>)}</> : <><th className={styles.center}>通过</th><th className={styles.center}>罚时</th>{problems.map((p: any) => <th className={styles.center} key={p.id}>{toExcelColumnName(p.orderIndex ?? 0)}</th>)}</>}</tr></thead><tbody>
      {visibleRanking.map(({ row, index }: { row: any; index: number }) => <tr key={row.userId} className={row.userId === currentUserId ? styles.rankRowCurrent : ''}><td className={`${styles.center} ${styles.rankCell} ${index < 3 ? medalClass[index] : ''}`}>{index + 1}</td><td><span className={styles.rankIdentity}><UserIdentityLink id={row.userId} userType={row.userType} name={row.name} username={row.username} avatar={row.avatar} avatarOnly size={32} /><UserIdentityLink id={row.userId} userType={row.userType} name={row.name} username={row.username} currentSuffix={row.userId === currentUserId ? '（我）' : ''} /></span></td><td className={styles.muted}><UserIdentityLink id={row.userId} userType={row.userType} username={row.username} /></td>{isScoreBased ? <><td className={`${styles.center} ${styles.numeric}`}><strong>{row.totalScore}</strong></td>{problems.map((p: any) => { const score = row.problems[p.id]?.score ?? 0; return <td className={`${styles.center} ${styles.numeric} ${scoreClass(score, p.points ?? 100)}`} key={p.id}>{score}</td> })}</> : <><td className={`${styles.center} ${styles.numeric}`}><strong>{row.solvedCount}</strong></td><td className={`${styles.center} ${styles.numeric} ${styles.muted}`}>{row.totalPenalty}</td>{problems.map((p: any) => { const pd = row.problems[p.id]; const resultClass = pd?.isFirstAccepted ? styles.scoreFirstAccepted : pd?.solved ? styles.scoreFull : pd?.attempts > 0 ? styles.scorePartial : styles.scoreZero; return <td className={`${styles.center} ${resultClass}`} key={p.id} title={pd?.isFirstAccepted ? '本题首个通过' : undefined}>{pd?.solved ? <span className={styles.icpcSolved}>+{pd.attempts > 1 && <small>({pd.attempts - 1})</small>}{pd.isFirstAccepted && <span className={styles.firstAcceptedMark}>首 A</span>}</span> : pd?.attempts > 0 ? `-${pd.attempts}` : '-'}</td> })}</>}</tr>)}
      {visibleRanking.length === 0 && <tr><td colSpan={Math.max(problems.length + 4, 4)} className={styles.empty}>{ranking.length === 0 ? '暂无排名数据' : '没有符合搜索条件的参赛者'}</td></tr>}
    </tbody></table></div>
  </div>
}
