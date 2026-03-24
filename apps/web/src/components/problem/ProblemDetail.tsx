'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import apiClient from '@/lib/apiClient'

interface Problem {
  id: string
  problemCode: string
  title: string
  description: string | null
  statementType: string
  statementPdfUrl: string | null
  solutionType: string
  solutionMarkdown: string | null
  solutionPdfUrl: string | null
  solutionVisible: boolean
  difficulty: string | null
  timeLimit: number | null
  memoryLimit: number | null
  status: string
  visibility: string
  ownerType: string
  ownerName: string
  ojBindings: string | null
  createdAt: string
}

interface OjBinding {
  platform: string
  problemId: string
}

interface Attachment {
  id: string
  problemId: string
  fileName: string
  fileSize: number
  fileUrl: string
  description: string | null
  uploadedAt: string
}

const OJ_PLATFORMS: Record<string, string> = {
  luogu: '洛谷',
  codeforces: 'CodeForces',
  atcoder: 'AtCoder',
  loj: 'LOJ',
  poj: 'POJ',
  hdu: 'HDU',
  spoj: 'SPOJ',
  uva: 'UVa',
  vijos: 'Vijos',
  bzoj: 'BZOJ',
  gym: 'Gym',
  other: '其他'
}

const getOjProblemUrl = (platform: string, problemId: string): string => {
  switch (platform) {
    case 'luogu': return `https://www.luogu.com.cn/problem/${problemId}`
    case 'codeforces': return `https://codeforces.com/problemset/problem/${problemId.replace(/([A-Za-z])/, '/$1')}`
    case 'atcoder': return `https://atcoder.jp/contests/${problemId.toLowerCase().replace(/([a-z]+)(\d+)/, '$1$2/tasks/$1_$2')}`
    case 'loj': return `https://loj.ac/p/${problemId}`
    case 'poj': return `http://poj.org/problem?id=${problemId}`
    case 'hdu': return `http://acm.hdu.edu.cn/showproblem.php?pid=${problemId}`
    case 'spoj': return `https://www.spoj.com/problems/${problemId}`
    case 'uva': return `https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=${problemId}`
    case 'vijos': return `https://vijos.org/p/${problemId}`
    case 'bzoj': return `https://www.lydsy.com/JudgeOnline/problem.php?id=${problemId}`
    default: return '#'
  }
}

const getPdfUrl = (path: string | null) => {
  if (!path) return null
  const filename = path.split('/').pop()
  return `/api/problems/pdf/${filename}`
}

interface ProblemDetailProps {
  role: 'teacher' | 'student' | 'admin'
  problemId: string
}

export function ProblemDetail({ role, problemId }: ProblemDetailProps) {
  const router = useRouter()
  const { user } = useAuth()
  const [problem, setProblem] = useState<Problem | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'statement' | 'solution' | 'attachments'>('statement')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)

  // 获取路径前缀
  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }
  const pathPrefix = getPathPrefix()

  useEffect(() => {
    fetchProblem()
  }, [problemId])

  useEffect(() => {
    if (activeTab === 'attachments') {
      fetchAttachments()
    }
  }, [activeTab, problemId])

  const fetchProblem = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<Problem>(`/api/problems/${problemId}`)
      if (result.success && result.data) {
        setProblem(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch problem:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttachments = async () => {
    try {
      setAttachmentsLoading(true)
      const result = await apiClient.get<Attachment[]>(`/api/problems/${problemId}/attachments`)
      if (result.success && result.data) {
        setAttachments(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch attachments:', error)
    } finally {
      setAttachmentsLoading(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const handleDelete = async () => {
    if (!problem) return
    if (!confirm('确定要删除这道题目吗？')) return

    try {
      const result = await apiClient.delete(`/api/problems/${problemId}`)
      if (result.success) {
        router.push(`${pathPrefix}/problems`)
      }
    } catch (error) {
      console.error('Failed to delete problem:', error)
    }
  }

  // 判断是否有编辑/删除权限
  const canModify = () => {
    if (!problem || !user) return false
    // 管理员可以修改所有题目
    if (role === 'admin') return true
    // 私有题目，所有者可以修改
    if (problem.visibility === 'private') {
      // 检查是否是所有者
      if (role === 'student' && problem.ownerType === 'student') return true
      if ((role === 'teacher') && problem.ownerType === 'teacher') return true
    }
    return false
  }

  const getDifficultyColor = (difficulty: string | null) => {
    switch (difficulty) {
      case '简单': return '#10b981'
      case '中等': return '#f59e0b'
      case '困难': return '#ef4444'
      default: return 'var(--gray-500)'
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        加载中...
      </div>
    )
  }

  if (!problem) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        题目不存在
      </div>
    )
  }

  const ojBindings: OjBinding[] = problem.ojBindings ? JSON.parse(problem.ojBindings) : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem' }}>
        {/* 返回按钮 */}
        <button
          onClick={() => router.push(`${pathPrefix}/problems`)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.875rem'
          }}
        >
          ← 返回列表
        </button>

        {/* 题目头部 */}
        <div style={{
          background: 'white',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          padding: '1.5rem',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--primary)', fontWeight: 500 }}>{problem.problemCode}</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>{problem.title}</span>
              </div>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                {problem.difficulty && (
                  <span style={{ color: getDifficultyColor(problem.difficulty) }}>{problem.difficulty}</span>
                )}
                {problem.timeLimit && <span>时间限制: {problem.timeLimit}ms</span>}
                {problem.memoryLimit && <span>空间限制: {problem.memoryLimit}MB</span>}
                <span style={{
                  padding: '0.125rem 0.5rem',
                  borderRadius: '4px',
                  background: problem.visibility === 'public' ? '#dbeafe' : 'var(--gray-100)',
                  color: problem.visibility === 'public' ? '#3b82f6' : 'var(--gray-600)'
                }}>
                  {problem.visibility === 'public' ? '公共' : '私有'}
                </span>
              </div>
            </div>
            {canModify() && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => router.push(`${pathPrefix}/problems/${problemId}/edit`)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid var(--border)',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={handleDelete}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid #ef4444',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    color: '#ef4444'
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>

          {/* OJ 绑定 */}
          {ojBindings.length > 0 && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginRight: '0.5rem' }}>OJ链接:</span>
              {ojBindings.map((binding, index) => (
                <a
                  key={index}
                  href={getOjProblemUrl(binding.platform, binding.problemId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    marginRight: '0.5rem',
                    color: 'var(--primary)',
                    textDecoration: 'none',
                    fontSize: '0.875rem'
                  }}
                >
                  [{OJ_PLATFORMS[binding.platform] || binding.platform} {binding.problemId}]
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setActiveTab('statement')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'statement' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'statement' ? 'var(--primary)' : 'var(--gray-500)'
              }}
            >
              题面
            </button>
            <button
              onClick={() => setActiveTab('solution')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'solution' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'solution' ? 'var(--primary)' : 'var(--gray-500)'
              }}
            >
              题解
            </button>
            <button
              onClick={() => setActiveTab('attachments')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'attachments' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'attachments' ? 'var(--primary)' : 'var(--gray-500)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
            >
              附件
              {attachments.length > 0 && (
                <span style={{
                  background: 'var(--primary)',
                  color: 'white',
                  fontSize: '0.75rem',
                  padding: '0.125rem 0.375rem',
                  borderRadius: '10px',
                  minWidth: '18px',
                  textAlign: 'center'
                }}>
                  {attachments.length}
                </span>
              )}
            </button>
          </div>

          {/* 思路记录按钮 */}
          <button
            onClick={() => router.push(`${pathPrefix}/problems/${problemId}/note`)}
            style={{
              padding: '0.5rem 1rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '-1px'
            }}
          >
            ✏️ 写思路
          </button>
        </div>

        {/* 内容区域 */}
        <div style={{
          background: 'white',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          padding: '1.5rem'
        }}>
          {activeTab === 'statement' && (
            <>
              {problem.statementType === 'pdf' && problem.statementPdfUrl ? (
                <iframe
                  src={getPdfUrl(problem.statementPdfUrl) || ''}
                  style={{ width: '100%', height: '600px', border: 'none' }}
                />
              ) : problem.statementType === 'markdown' && problem.description ? (
                <MarkdownRenderer content={problem.description} />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>
                  暂无题面内容
                </div>
              )}
            </>
          )}

          {activeTab === 'solution' && (
            <>
              {!problem.solutionVisible && problem.visibility === 'public' && role === 'student' ? (
                <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>
                  题解暂未公开
                </div>
              ) : problem.solutionType === 'pdf' && problem.solutionPdfUrl ? (
                <iframe
                  src={getPdfUrl(problem.solutionPdfUrl) || ''}
                  style={{ width: '100%', height: '600px', border: 'none' }}
                />
              ) : problem.solutionType === 'markdown' && problem.solutionMarkdown ? (
                <MarkdownRenderer content={problem.solutionMarkdown} />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>
                  暂无题解内容
                </div>
              )}
            </>
          )}

          {activeTab === 'attachments' && (
            <>
              {attachmentsLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>
                  加载中...
                </div>
              ) : attachments.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>
                  暂无附件
                </div>
              ) : (
                <div>
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        borderBottom: '1px solid var(--border)',
                        '&:last-child': { borderBottom: 'none' }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1.25rem' }}>📎</span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{attachment.fileName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                            {formatFileSize(attachment.fileSize)}
                            {attachment.description && ` · ${attachment.description}`}
                          </div>
                        </div>
                      </div>
                      <a
                        href={`${process.env.NEXT_PUBLIC_API_URL}${attachment.fileUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '0.375rem 0.75rem',
                          background: 'var(--primary)',
                          color: 'white',
                          borderRadius: '4px',
                          textDecoration: 'none',
                          fontSize: '0.875rem'
                        }}
                      >
                        下载
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}