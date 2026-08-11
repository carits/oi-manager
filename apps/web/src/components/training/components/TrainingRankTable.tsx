'use client'

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
  return <div className={styles.surface}>
    <div className={styles.rankIntro}><div><strong>实时排名</strong></div><div className={styles.rankSummary}><span className={styles.summaryItem}>参赛 <strong>{ranking.length}</strong> 人</span><span className={styles.summaryItem}>题目 <strong>{problems.length}</strong> 题</span>{currentRank > 0 && <span className={styles.summaryItem}>我的名次 <strong>#{currentRank}</strong></span>}</div></div>
    <div className={styles.scroll}><table className={`${styles.table} ${styles.rankTable}`}><thead><tr><th className={styles.center}>#</th><th>姓名</th><th>用户名</th>{isScoreBased ? <><th className={styles.center}>总分</th>{problems.map((p: any) => <th className={styles.center} key={p.id}>{toExcelColumnName(p.orderIndex ?? 0)}</th>)}</> : <><th className={styles.center}>通过</th><th className={styles.center}>罚时</th>{problems.map((p: any) => <th className={styles.center} key={p.id}>{toExcelColumnName(p.orderIndex ?? 0)}</th>)}</>}</tr></thead><tbody>
      {ranking.map((row: any, idx: number) => <tr key={row.userId} className={row.userId === currentUserId ? styles.rankRowCurrent : ''}><td className={`${styles.center} ${styles.rankCell} ${idx < 3 ? medalClass[idx] : ''}`}>{idx + 1}</td><td><UserIdentityLink id={row.userId} userType={row.userType} name={row.name} username={row.username} /></td><td className={styles.muted}><UserIdentityLink id={row.userId} userType={row.userType} username={row.username} /></td>{isScoreBased ? <><td className={`${styles.center} ${styles.numeric}`}><strong>{row.totalScore}</strong></td>{problems.map((p: any) => { const score = row.problems[p.id]?.score ?? 0; return <td className={`${styles.center} ${styles.numeric} ${scoreClass(score, p.points ?? 100)}`} key={p.id}>{score}</td> })}</> : <><td className={`${styles.center} ${styles.numeric}`}><strong>{row.solvedCount}</strong></td><td className={`${styles.center} ${styles.numeric} ${styles.muted}`}>{row.totalPenalty}</td>{problems.map((p: any) => { const pd = row.problems[p.id]; return <td className={`${styles.center} ${pd?.solved ? styles.scoreFull : pd?.attempts > 0 ? styles.scorePartial : styles.scoreZero}`} key={p.id}>{pd?.solved ? <>+{pd.attempts > 1 && <small>({pd.attempts - 1})</small>}</> : pd?.attempts > 0 ? `-${pd.attempts}` : '-'}</td> })}</>}</tr>)}
      {ranking.length === 0 && <tr><td colSpan={Math.max(problems.length + 4, 4)} className={styles.empty}>暂无排名数据</td></tr>}
    </tbody></table></div>
  </div>
}
