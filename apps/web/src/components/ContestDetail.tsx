// 共用的比赛详情组件

import { useEffect, useState } from 'react'
import { getAuthHeaders } from '@/lib/auth'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'
import { ENV } from '@/config/env'

export interface Resource {
  id: string
  fileName: string
  fileType: string
  fileUrl: string
  fileFormat: string
  uploadedAt: string
  contestProblemId: string | null
}

export interface ContestProblem {
  id: string
  orderIndex: number
  title: string | null
  ojName: string | null
  problemId: string | null
  isCustom: boolean
  difficulty: string | null
  points: number | null
  statementType: 'none' | 'markdown' | 'pdf'
  statementMarkdown: string | null
  solutionType?: 'none' | 'markdown' | 'pdf'
  solutionMarkdown?: string | null
  solutionVisible?: boolean
}

export interface Contest {
  id: string
  title: string
  description: string | null
  contestDate: string
  status: string
  type: string
  countRating: boolean
  scope: string
  problems?: ContestProblem[]
  resources?: Resource[]
}

export interface RanklistEntry {
  rank: number
  username: string
  totalScore: number
  problemScores: { [key: string]: number }
}

export interface ContestDetailProps {
  contestId: string
  currentUserId?: string | null
  isTeacher?: boolean  // 教师端显示管理按钮
}

export function useContestDetail({ contestId }: { contestId: string }) {
  const [contest, setContest] = useState<Contest | null>(null)
  const [problems, setProblems] = useState<ContestProblem[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [ranklist, setRanklist] = useState<RanklistEntry[]>([])
  const [selectedProblem, setSelectedProblem] = useState<ContestProblem | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchContestDetail = async () => {
    try {
      const res = await fetch(`${ENV.API_URL}/api/contests/${contestId}`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) {
        setContest(data.data)
        const sortedProblems = (data.data.problems || []).sort((a: any, b: any) => a.orderIndex - b.orderIndex)
        setProblems(sortedProblems)
        setResources(data.data.resources || [])
        if (sortedProblems.length > 0) {
          setSelectedProblem(sortedProblems[0])
        }
      }
    } catch (err) {
      console.error('加载比赛详情失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchRanklist = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/contests/${contestId}/results`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) {
        // 转换数据格式
        const entries = (data.data || []).map((entry: any, idx: number) => ({
          rank: idx + 1,
          username: entry.student?.username || entry.studentName || 'Unknown',
          totalScore: entry.score || entry.totalScore || 0,
          problemScores: entry.scores || {}
        }))
        // 按总分排序（分数高的在前）
        entries.sort((a: RanklistEntry, b: RanklistEntry) => b.totalScore - a.totalScore)
        // 重新计算排名
        entries.forEach((entry: RanklistEntry, idx: number) => {
          entry.rank = idx + 1
        })
        setRanklist(entries)
      }
    } catch (err) {
      console.error('加载排行榜失败:', err)
    }
  }

  useEffect(() => {
    if (contestId) {
      fetchContestDetail()
    }
  }, [contestId])

  return { contest, problems, resources, ranklist, selectedProblem, setSelectedProblem, loading, refetch: fetchContestDetail, fetchRanklist }
}

// 映射序号 A, B, C...
export function getProblemLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

// 题目表格组件
export function ProblemTable({
  problems,
  selectedProblem,
  onSelect,
  isCreator,
  onEdit,
  onDelete,
  onPractice
}: {
  problems: ContestProblem[]
  selectedProblem: ContestProblem | null
  onSelect: (problem: ContestProblem) => void
  isCreator?: boolean
  onEdit?: (problem: ContestProblem) => void
  onDelete?: (problemId: string) => void
  onPractice?: (problem: ContestProblem) => void
}) {
  return (
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--gray-50)' }}>
            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>#</th>
            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>类型</th>
            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>题目</th>
            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>OJ</th>
            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>分值</th>
            {(isCreator || onPractice) && (
              <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>操作</th>
            )}
          </tr>
        </thead>
        <tbody>
          {problems.length === 0 ? (
            <tr>
              <td colSpan={(isCreator || onPractice) ? 6 : 5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>暂无题目</td>
            </tr>
          ) : (
            problems.map((problem, idx) => (
              <tr
                key={problem.id}
                onClick={() => onSelect(problem)}
                style={{
                  cursor: 'pointer',
                  background: selectedProblem?.id === problem.id ? 'var(--gray-50)' : 'white',
                  borderTop: '1px solid var(--border)'
                }}
              >
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500 }}>{getProblemLabel(idx)}</td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                  {problem.isCustom ? (
                    <span style={{ padding: '0.125rem 0.375rem', borderRadius: '4px', fontSize: '0.75rem', background: '#dbeafe', color: '#1e40af' }}>自定义</span>
                  ) : (
                    <span style={{ padding: '0.125rem 0.375rem', borderRadius: '4px', fontSize: '0.75rem', background: 'var(--gray-100)', color: 'var(--gray-600)' }}>外部</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--primary)', fontWeight: 500 }}>
                    {problem.isCustom ? problem.title : `${problem.ojName} ${problem.problemId}`}
                  </span>
                </td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>{problem.ojName || '-'}</td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>{problem.points || '-'}</td>
                {(isCreator || onPractice) && (
                  <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                    {onPractice && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onPractice(problem) }}
                        style={{
                          padding: '0.25rem 0.75rem',
                          background: 'var(--primary)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: 500
                        }}
                      >
                        ✏️ 思路记录
                      </button>
                    )}
                    {isCreator && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); onEdit?.(problem) }} style={{ color: 'var(--primary)', marginRight: '0.5rem', marginLeft: onPractice ? '0.5rem' : 0 }}>编辑</button>
                        <button onClick={(e) => { e.stopPropagation(); onDelete?.(problem.id) }} style={{ color: 'var(--error)' }}>删除</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// 题目详情组件
export function ProblemDetail({
  problem,
  problems,
  showPoints = true
}: {
  problem: ContestProblem
  problems: ContestProblem[]
  showPoints?: boolean
}) {
  return (
    <div style={{ marginTop: '1.5rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem' }}>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
        {getProblemLabel(problems.findIndex(p => p.id === problem.id))}. {problem.isCustom ? problem.title : `${problem.ojName} ${problem.problemId}`}
        {showPoints && problem.points && <span style={{ marginLeft: '0.5rem', color: 'var(--gray-500)', fontWeight: 400 }}>({problem.points}分)</span>}
      </h3>

      {problem.statementType === 'markdown' && problem.statementMarkdown ? (
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeKatex, rehypeRaw]}
            components={{
              h1: ({node, ...props}) => <h1 style={{ fontSize: '1.25rem', marginTop: '1rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }} {...props} />,
              h2: ({node, ...props}) => <h2 style={{ fontSize: '1.1rem', marginTop: '1rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }} {...props} />,
              h3: ({node, ...props}) => <h3 style={{ fontSize: '1rem', marginTop: '0.75rem', marginBottom: '0.5rem', fontWeight: 600 }} {...props} />,
              p: ({node, ...props}) => <p style={{ marginBottom: '0.75rem', lineHeight: 1.7 }} {...props} />,
              ul: ({node, ...props}) => <ul style={{ paddingLeft: '1.5rem', marginBottom: '0.75rem' }} {...props} />,
              ol: ({node, ...props}) => <ol style={{ paddingLeft: '1.5rem', marginBottom: '0.75rem' }} {...props} />,
              li: ({node, ...props}) => <li style={{ marginBottom: '0.25rem' }} {...props} />,
              code: ({node, ...props}) => <code style={{ background: 'var(--gray-100)', padding: '0.125rem 0.375rem', borderRadius: '3px', fontFamily: 'monospace', fontSize: '0.875em' }} {...props} />,
              pre: ({node, ...props}) => <pre style={{ background: 'var(--gray-100)', padding: '0.75rem', borderRadius: '6px', overflow: 'auto', marginBottom: '0.75rem' }} {...props} />,
              table: ({node, ...props}) => <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '0.75rem' }} {...props} />,
              th: ({node, ...props}) => <th style={{ border: '1px solid var(--border)', padding: '0.375rem', background: 'var(--gray-50)', textAlign: 'left' }} {...props} />,
              td: ({node, ...props}) => <td style={{ border: '1px solid var(--border)', padding: '0.375rem' }} {...props} />,
            }}
          >
            {problem.statementMarkdown}
          </ReactMarkdown>
        </div>
      ) : problem.statementType === 'pdf' ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
          <p>该题目为 PDF 格式，请在「资料下载」中下载查看</p>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
          暂无题目描述
        </div>
      )}
    </div>
  )
}

// 资料表格组件
export function ResourceTable({
  resources,
  problems,
  isCreator,
  onDelete
}: {
  resources: Resource[]
  problems: ContestProblem[]
  isCreator?: boolean
  onDelete?: (resourceId: string) => void
}) {
  return (
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)' }}>
      {resources.length === 0 ? (
        <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>暂无资料</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--gray-50)' }}>
              <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>文件名</th>
              <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>类型</th>
              <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>格式</th>
              <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>关联</th>
              <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>上传时间</th>
              {isCreator && (
                <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>操作</th>
              )}
            </tr>
          </thead>
          <tbody>
            {resources.map(resource => (
              <tr key={resource.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                  <a href={`${ENV.API_URL}${resource.fileUrl}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                    {resource.fileName}
                  </a>
                </td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                  {resource.fileType === 'statement' ? '题面' : resource.fileType === 'solution' ? '题解' : '其他'}
                </td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                  <span style={{ padding: '0.125rem 0.375rem', borderRadius: '4px', fontSize: '0.75rem', background: resource.fileFormat === 'markdown' ? '#dbeafe' : 'var(--gray-100)', color: resource.fileFormat === 'markdown' ? '#1e40af' : 'var(--gray-600)' }}>
                    {resource.fileFormat === 'markdown' ? 'Markdown' : 'PDF'}
                  </span>
                </td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                  {resource.contestProblemId ? (
                    <span style={{ color: 'var(--primary)' }}>题目 #{problems.find(p => p.id === resource.contestProblemId)?.orderIndex || '?'}</span>
                  ) : (
                    <span style={{ color: 'var(--gray-500)' }}>整场</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>{new Date(resource.uploadedAt).toLocaleString()}</td>
                {isCreator && (
                  <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                    <button onClick={() => onDelete?.(resource.id)} style={{ color: 'var(--error)' }}>删除</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// 排行榜组件
export function RanklistTable({
  ranklist,
  problems
}: {
  ranklist: RanklistEntry[]
  problems: ContestProblem[]
}) {
  // 获取分数颜色
  const getScoreColor = (score: number) => {
    if (score === 100) return '#16a34a' // 绿色 - 满分
    if (score === 0) return '#ef4444'   // 红色 - 未通过
    if (score > 0) return '#f59e0b'      // 橙色 - 部分得分
    return 'var(--gray-400)'              // 灰色 - 未作答
  }

  return (
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      {ranklist.length === 0 ? (
        <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>暂无排名数据</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)' }}>
                <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500, width: '60px' }}>排名</th>
                <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>选手</th>
                <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500, width: '80px' }}>总分</th>
                {problems.map((problem, idx) => (
                  <th key={problem.id} style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 500, minWidth: '50px' }}>
                    {getProblemLabel(idx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranklist.map((entry) => (
                <tr key={entry.username} style={{ borderTop: '1px solid var(--border)', background: entry.rank <= 3 ? '#fefce8' : 'white' }}>
                  <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: entry.rank <= 3 ? 600 : 400 }}>
                    {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : entry.rank}
                  </td>
                  <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500 }}>{entry.username}</td>
                  <td style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--primary)' }}>{entry.totalScore}</td>
                  {problems.map((problem) => {
                    const score = entry.problemScores[problem.id] || 0
                    return (
                      <td
                        key={problem.id}
                        style={{
                          padding: '0.5rem 0.75rem',
                          textAlign: 'center',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          color: getScoreColor(score)
                        }}
                      >
                        {score}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
