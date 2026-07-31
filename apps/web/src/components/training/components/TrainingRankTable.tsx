'use client'

function toExcelColumnName(index: number): string {
  let result = ''
  let i = index
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result
    i = Math.floor(i / 26) - 1
  }
  return result
}

function getScoreColor(score: number, max: number): string {
  const ratio = max > 0 ? score / max : 0
  if (ratio >= 1) return 'var(--success)'
  if (ratio >= 0.5) return 'var(--warning)'
  return 'var(--error)'
}

const RANK_MEDAL_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32']

interface TrainingRankTableProps {
  rankingData: any
  currentUserId?: string
}

export function TrainingRankTable({ rankingData, currentUserId }: TrainingRankTableProps) {
  if (!rankingData) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-400)' }}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" /></div>
  }

  if (rankingData.hidden) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔒</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>排名尚未公布</div>
        <div style={{ fontSize: '0.85rem' }}>OI 赛制比赛结束后公布排名</div>
      </div>
    )
  }

  const isScoreBased = rankingData.format === 'ioi' || rankingData.format === 'oi'

  return (
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: 'var(--bg-muted)' }}>
            <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '50px' }}>#</th>
            <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '120px' }}>姓名</th>
            <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '100px' }}>用户名</th>
            {isScoreBased ? (
              <>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '70px' }}>总分</th>
                {rankingData.problems.map((p: any) => (
                  <th key={p.id} style={{ padding: '0.6rem 0.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)' }}>{toExcelColumnName(p.orderIndex ?? 0)}</th>
                ))}
              </>
            ) : (
              <>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '50px' }}>通过</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', width: '70px' }}>罚时</th>
                {rankingData.problems.map((p: any) => (
                  <th key={p.id} style={{ padding: '0.6rem 0.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)' }}>{toExcelColumnName(p.orderIndex ?? 0)}</th>
                ))}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rankingData.ranking.map((row: any, idx: number) => {
            const isCurrentUser = row.userId === currentUserId
            return (
            <tr key={row.userId} style={{ borderBottom: '1px solid #f1f5f9', background: isCurrentUser ? 'var(--info-light)' : 'transparent' }}>
              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, color: idx < 3 ? RANK_MEDAL_COLORS[idx] : 'var(--text-secondary)' }}>
                {idx + 1}
              </td>
              <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>{row.name}</td>
              <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{row.username}</td>
              {isScoreBased ? (
                <>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, fontSize: '0.95rem', color: 'var(--success)' }}>{row.totalScore}</td>
                  {rankingData.problems.map((p: any) => {
                    const pd = row.problems[p.id]
                    const maxPts = p.points ?? 100
                    const score = pd?.score ?? 0
                    const isFull = score >= maxPts
                    return (
                      <td key={p.id} style={{ padding: '0.5rem 0.5rem', textAlign: 'center', fontWeight: isFull ? 600 : 400, color: score > 0 ? getScoreColor(score, maxPts) : 'var(--border-hover)' }}>
                        {score}
                      </td>
                    )
                  })}
                </>
              ) : (
                <>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, color: 'var(--success)' }}>{row.solvedCount}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{row.totalPenalty}</td>
                  {rankingData.problems.map((p: any) => {
                    const pd = row.problems[p.id]
                    return (
                      <td key={p.id} style={{ padding: '0.5rem 0.5rem', textAlign: 'center' }}>
                        {pd?.solved ? (
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                            +{pd.attempts > 1 ? <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)' }}>({pd.attempts - 1})</span> : ''}
                          </span>
                        ) : pd?.attempts > 0 ? (
                          <span style={{ color: 'var(--error)', fontWeight: 500 }}>-{pd.attempts}</span>
                        ) : (
                          <span style={{ color: 'var(--border-hover)' }}>-</span>
                        )}
                      </td>
                    )
                  })}
                </>
              )}
            </tr>
          )
          })}
          {rankingData.ranking.length === 0 && (
            <tr>
              <td colSpan={20} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>暂无排名数据</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
